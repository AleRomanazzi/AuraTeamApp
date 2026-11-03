from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.calendario import etiquetas
from apps.clientes.models import Cliente
from apps.core.permissions import es_admin, persona_de
from apps.core.utils import MES_RE

from .models import AsignacionCliente, AsignacionTarea, Liquidacion, LiquidacionItem, Persona, Subtarea, Tarea, TareaRecurrente
from .services import ESTADOS_DE_AVANCE, MAX_LINKS_TAREA, ajustar_por_dependencias, crearia_ciclo, heredar_links

MAX_POR_DIA = 10
MAX_TAREAS_PLAN = 100
MAX_SUBTAREAS = 30
MAX_DEPENDENCIAS = 20


def es_interna(tarea) -> bool:
    """Gestión interna de la agencia (sin cliente): la edita cualquiera del equipo. Las de pagos de servicios no."""
    return tarea.cliente_id is None and not hasattr(tarea, 'aviso_servicio')


def puede_editar_tarea(user, tarea) -> bool:
    if es_interna(tarea):
        return True
    if tarea.user_id is not None and tarea.user_id == user.id:
        return True
    persona = persona_de(user)
    return persona is not None and any(a.persona_id == persona.id for a in tarea.asignaciones.all())


class SubtareaSerializer(serializers.Serializer):
    id = serializers.IntegerField(required=False)
    titulo = serializers.CharField(max_length=200)
    hecha = serializers.BooleanField(required=False, default=False)
    orden = serializers.IntegerField(required=False, min_value=0)


class TareaSerializer(serializers.ModelSerializer):
    asignados = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=Persona.objects.all(), source='personas_asignadas'
    )
    asignados_nombres = serializers.SerializerMethodField()
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)
    cliente_color = serializers.CharField(source='cliente.color', read_only=True, default=None)
    vencida = serializers.SerializerMethodField()
    subtareas = SubtareaSerializer(many=True, required=False)
    progreso = serializers.SerializerMethodField()
    hora_inicio = serializers.TimeField(format='%H:%M', required=False, allow_null=True)
    hora_fin = serializers.TimeField(format='%H:%M', required=False, allow_null=True)
    depende_de = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=Tarea.objects.all())
    dependencias = serializers.SerializerMethodField()
    desbloquea = serializers.SerializerMethodField()
    esperando = serializers.SerializerMethodField()

    class Meta:
        model = Tarea
        fields = (
            'id', 'titulo', 'descripcion', 'cliente', 'cliente_nombre', 'cliente_color', 'estado', 'prioridad',
            'fecha_limite', 'fecha_inicio', 'hora_inicio', 'hora_fin', 'etiqueta', 'links', 'completada_en', 'asignados',
            'asignados_nombres', 'vencida', 'creado', 'notion_url', 'creado_por', 'puede_editar', 'recurrente',
            'subtareas', 'progreso', 'depende_de', 'dependencias', 'desbloquea', 'esperando', 'bloqueo_auto',
        )
        read_only_fields = ('id', 'completada_en', 'creado', 'recurrente', 'bloqueo_auto')

    notion_url = serializers.SerializerMethodField()
    creado_por = serializers.PrimaryKeyRelatedField(source='user', read_only=True)
    puede_editar = serializers.SerializerMethodField()

    def get_puede_editar(self, obj):
        request = self.context.get('request')
        if request is None:
            return False
        return es_admin(request.user) or puede_editar_tarea(request.user, obj)

    def get_notion_url(self, obj):
        return f'https://www.notion.so/{obj.notion_page_id.replace("-", "")}' if obj.notion_page_id else None

    def to_representation(self, instance):
        instance.personas_asignadas = [a.persona for a in instance.asignaciones.all()]
        return super().to_representation(instance)

    def get_asignados_nombres(self, obj):
        return [p.nombre for p in getattr(obj, 'personas_asignadas', [])]

    def get_vencida(self, obj):
        return bool(obj.fecha_limite and obj.estado != 'hecha' and obj.fecha_limite < timezone.localdate())

    def _privadas(self):
        if 'privadas' not in self.context:
            request = self.context.get('request')
            self.context['privadas'] = set() if request is None or es_admin(request.user) else etiquetas.privadas()
        return self.context['privadas']

    def _resumen(self, t):
        if t.etiqueta in self._privadas():
            return {'id': t.id, 'titulo': 'Tarea privada', 'estado': t.estado, 'cliente_nombre': None}
        return {'id': t.id, 'titulo': t.titulo, 'estado': t.estado, 'cliente_nombre': t.cliente.nombre if t.cliente_id else None}

    def get_dependencias(self, obj):
        return [self._resumen(t) for t in obj.depende_de.all()] if obj.pk else []

    def get_desbloquea(self, obj):
        return [self._resumen(t) for t in obj.desbloquea.all()] if obj.pk else []

    def get_esperando(self, obj):
        return any(t.estado != 'hecha' for t in obj.depende_de.all()) if obj.pk else False

    def validate_depende_de(self, value):
        unicas = list({t.pk: t for t in value}.values())
        if len(unicas) > MAX_DEPENDENCIAS:
            raise serializers.ValidationError(f'Máximo {MAX_DEPENDENCIAS} dependencias.')
        if self.instance is not None and any(t.pk == self.instance.pk for t in unicas):
            raise serializers.ValidationError('Una tarea no puede depender de sí misma.')
        request = self.context.get('request')
        if request is not None and not es_admin(request.user):
            privadas = etiquetas.privadas()
            persona = persona_de(request.user)
            for t in unicas:
                aviso = getattr(t, 'aviso_servicio', None)
                if t.etiqueta in privadas or (aviso is not None and aviso.persona_id != getattr(persona, 'pk', None)):
                    raise serializers.ValidationError('Hay una tarea que no existe.')
        if self.instance is not None and crearia_ciclo(self.instance, unicas):
            raise serializers.ValidationError('Así quedaría un ciclo: una de esas tareas ya espera (directa o indirectamente) a esta.')
        return unicas

    def _validar_horario(self, attrs):
        inst = self.instance

        def valor(k):
            return attrs[k] if k in attrs else getattr(inst, k, None)

        fin, inicio = valor('fecha_limite'), valor('fecha_inicio')
        if not fin:
            # Sin fecha no hay rango ni horario.
            for k in ('fecha_inicio', 'hora_inicio', 'hora_fin'):
                if valor(k) is not None:
                    attrs[k] = None
            return
        for k in ('hora_inicio', 'hora_fin'):
            if attrs.get(k) is not None:
                attrs[k] = attrs[k].replace(second=0, microsecond=0)
        h_ini, h_fin = valor('hora_inicio'), valor('hora_fin')
        if inicio and inicio == fin:
            attrs['fecha_inicio'] = inicio = None
        if inicio and inicio > fin:
            raise serializers.ValidationError({'fecha_inicio': 'La fecha de inicio tiene que ser anterior a la de fin.'})
        if h_fin and not h_ini:
            raise serializers.ValidationError({'hora_inicio': 'Poné también la hora de inicio.'})
        if inicio and h_ini and not h_fin:
            raise serializers.ValidationError({'hora_fin': 'En una tarea de varios días, poné también la hora de fin.'})
        if not inicio and h_ini and h_fin and h_fin <= h_ini:
            raise serializers.ValidationError({'hora_fin': 'La hora de fin tiene que ser posterior a la de inicio.'})

    def _validar_dependencias(self, attrs):
        """Bloqueo estricto: mientras espere a otras tareas, no puede pasar a En progreso, En revisión ni Hecha."""
        inst = self.instance
        if 'depende_de' in attrs:
            deps = attrs['depende_de']
        else:
            deps = list(inst.depende_de.all()) if inst is not None else []
        pendientes = [t for t in deps if t.estado != 'hecha']
        estado = attrs.get('estado', getattr(inst, 'estado', 'pendiente'))
        if not pendientes or estado not in ESTADOS_DE_AVANCE:
            return
        antes = set() if inst is None else set(inst.depende_de.values_list('pk', flat=True))
        avanza = inst is None or estado != inst.estado
        nuevas = [t for t in pendientes if t.pk not in antes]
        if avanza or nuevas:
            nombres = ', '.join(f'«{self._resumen(t)["titulo"]}»' for t in (nuevas or pendientes)[:3])
            raise serializers.ValidationError({'estado': f'Esta tarea espera a {nombres}: no puede avanzar hasta que esté Hecha.'})

    def validate(self, attrs):
        self._validar_horario(attrs)
        self._validar_dependencias(attrs)
        return attrs

    def get_progreso(self, obj):
        subtareas = list(obj.subtareas.all())
        if not subtareas:
            return None
        hechas = sum(1 for s in subtareas if s.hecha)
        total = len(subtareas)
        return {'hechas': hechas, 'total': total, 'porcentaje': round(100 * hechas / total)}

    def validate_subtareas(self, value):
        if len(value) > MAX_SUBTAREAS:
            raise serializers.ValidationError(f'Máximo {MAX_SUBTAREAS} subtareas.')
        vistos = set()
        for item in value:
            item['titulo'] = item['titulo'].strip()
            if not item['titulo']:
                raise serializers.ValidationError('Cada subtarea necesita un título.')
            sid = item.get('id')
            if sid is not None:
                if sid in vistos:
                    raise serializers.ValidationError('Hay subtareas repetidas.')
                vistos.add(sid)
        if self.instance is not None and vistos:
            existentes = set(self.instance.subtareas.filter(id__in=vistos).values_list('id', flat=True))
            if vistos - existentes:
                raise serializers.ValidationError('Hay una subtarea que no es de esta tarea.')
        return value

    def validate_titulo(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('El título es obligatorio.')
        return value

    def validate_etiqueta(self, value):
        request = self.context.get('request')
        return etiquetas.validar(value, request and request.user, getattr(self.instance, 'etiqueta', None))

    def validate_links(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Se espera una lista de links.')
        if len(value) > MAX_LINKS_TAREA:
            raise serializers.ValidationError(f'Máximo {MAX_LINKS_TAREA} links por tarea.')
        limpios = []
        for item in value:
            if not isinstance(item, dict):
                raise serializers.ValidationError('Cada link debe tener título y URL.')
            url = str(item.get('url') or '').strip()
            titulo = str(item.get('titulo') or '').strip()[:120]
            if not url:
                continue
            if not url.lower().startswith(('http://', 'https://')):
                url = f'https://{url}'
            try:
                URLValidator(schemes=['http', 'https'])(url)
            except DjangoValidationError:
                raise serializers.ValidationError(f'URL inválida: {url[:80]}')
            limpios.append({'titulo': titulo, 'url': url[:500]})
        return limpios

    def _aplicar_estado(self, validated, instance=None):
        estado = validated.get('estado')
        if estado is None:
            return
        if estado == 'hecha' and (instance is None or instance.estado != 'hecha'):
            validated['completada_en'] = timezone.now()
        elif estado != 'hecha':
            validated['completada_en'] = None

    def _reemplazar_subtareas(self, tarea, items):
        actuales = {s.id: s for s in tarea.subtareas.all()}
        antes = [s.hecha for s in tarea.subtareas.all()]
        vistos = []
        for i, item in enumerate(items):
            orden = item.get('orden', i)
            sid = item.get('id')
            if sid and tarea.pk and sid in actuales:
                sub = actuales[sid]
                sub.titulo = item['titulo']
                sub.hecha = item['hecha']
                sub.orden = orden
                sub.save(update_fields=['titulo', 'hecha', 'orden'])
                vistos.append(sid)
            else:
                Subtarea.objects.create(tarea=tarea, titulo=item['titulo'], hecha=item['hecha'], orden=orden)
        sobrantes = [sid for sid in actuales if sid not in vistos]
        if sobrantes:
            Subtarea.objects.filter(id__in=sobrantes).delete()
        tarea._checklist_tocado = True
        if hasattr(tarea, '_prefetched_objects_cache'):
            tarea._prefetched_objects_cache.pop('subtareas', None)
        despues = [s.hecha for s in tarea.subtareas.all()]
        return antes != despues

    def _cerrar_progreso(self, tarea, estado_anterior, cambio_hecha):
        if tarea.estado == 'hecha' and estado_anterior != 'hecha':
            tarea.subtareas.filter(hecha=False).update(hecha=True)
            return
        if not cambio_hecha:
            return
        from .services import estado_segun_subtareas, fijar_estado

        if hasattr(tarea, '_prefetched_objects_cache'):
            tarea._prefetched_objects_cache.pop('subtareas', None)
        fijar_estado(tarea, estado_segun_subtareas(tarea, tarea.estado))

    @transaction.atomic
    def create(self, validated_data):
        personas = validated_data.pop('personas_asignadas', [])
        subtareas = validated_data.pop('subtareas', None)
        dependencias = validated_data.pop('depende_de', None)
        pedido = validated_data.get('estado', 'pendiente')
        self._aplicar_estado(validated_data)
        tarea = Tarea.objects.create(**validated_data)
        if dependencias:
            tarea.depende_de.set(dependencias)
            heredar_links(tarea, dependencias)
        for p in personas:
            AsignacionTarea.objects.create(persona=p, tarea=tarea)
        cambio = False
        if subtareas is not None:
            cambio = self._reemplazar_subtareas(tarea, subtareas)
        self._cerrar_progreso(tarea, 'pendiente' if pedido == 'hecha' else tarea.estado, cambio)
        ajustar_por_dependencias(tarea)
        return tarea

    @transaction.atomic
    def update(self, instance, validated_data):
        personas = validated_data.pop('personas_asignadas', None)
        subtareas = validated_data.pop('subtareas', None)
        dependencias = validated_data.pop('depende_de', None)
        estado_anterior = instance.estado
        if validated_data.get('estado', estado_anterior) != estado_anterior:
            # Lo decidió una persona: si después vuelve a quedar bloqueada por dependencias, lo marca el sistema.
            validated_data['bloqueo_auto'] = False
        self._aplicar_estado(validated_data, instance)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if personas is not None:
            ids = {p.id for p in personas}
            instance.asignaciones.exclude(persona_id__in=ids).delete()
            actuales = set(instance.asignaciones.values_list('persona_id', flat=True))
            for p in personas:
                if p.id not in actuales:
                    AsignacionTarea.objects.create(persona=p, tarea=instance)
        if dependencias is not None:
            instance.depende_de.set(dependencias)
            heredar_links(instance, dependencias)
        cambio = self._reemplazar_subtareas(instance, subtareas) if subtareas is not None else False
        self._cerrar_progreso(instance, estado_anterior, cambio)
        ajustar_por_dependencias(instance)
        if hasattr(instance, '_prefetched_objects_cache'):
            instance._prefetched_objects_cache.clear()
        return instance


class TareaDelPlanSerializer(serializers.ModelSerializer):
    asignados = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=Persona.objects.all())
    # Posición (en la lista del plan) de una tarea anterior que tiene que estar Hecha antes.
    despues_de = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    class Meta:
        model = Tarea
        fields = ('titulo', 'descripcion', 'fecha_limite', 'etiqueta', 'prioridad', 'asignados', 'despues_de')
        extra_kwargs = {'fecha_limite': {'required': True, 'allow_null': False}}

    validate_titulo = TareaSerializer.validate_titulo
    validate_etiqueta = TareaSerializer.validate_etiqueta


class PlanDelMesSerializer(serializers.Serializer):
    """Varias tareas de un cliente (o de gestión interna, sin cliente) creadas de una vez (Plan del mes)."""

    cliente = serializers.PrimaryKeyRelatedField(queryset=Cliente.objects.all(), allow_null=True, required=False, default=None)
    tareas = TareaDelPlanSerializer(many=True, allow_empty=False, max_length=MAX_TAREAS_PLAN)

    def validate_tareas(self, value):
        for i, datos in enumerate(value):
            previa = datos.get('despues_de')
            # Solo hacia atrás: así no puede haber ciclos.
            if previa is not None and previa >= i:
                raise serializers.ValidationError(f'La tarea {i + 1} solo puede ir después de una de las anteriores.')
        return value

    @transaction.atomic
    def create(self, validated_data):
        cliente, user = validated_data.get('cliente'), self.context['request'].user
        creadas = []
        for datos in validated_data['tareas']:
            personas = datos.pop('asignados', [])
            previa = datos.pop('despues_de', None)
            tarea = Tarea.objects.create(cliente=cliente, user=user, **datos)
            AsignacionTarea.objects.bulk_create([AsignacionTarea(persona=p, tarea=tarea) for p in personas])
            if previa is not None:
                tarea.depende_de.add(creadas[previa])
                ajustar_por_dependencias(tarea)
            creadas.append(tarea)
        return creadas


class TareaRecurrenteSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)
    cliente_color = serializers.CharField(source='cliente.color', read_only=True, default=None)
    personas = serializers.PrimaryKeyRelatedField(many=True, required=False, queryset=Persona.objects.all())
    por_dia = serializers.IntegerField(min_value=1, max_value=MAX_POR_DIA, default=1)
    hora_inicio = serializers.TimeField(format='%H:%M', required=False, allow_null=True)
    hora_fin = serializers.TimeField(format='%H:%M', required=False, allow_null=True)

    class Meta:
        model = TareaRecurrente
        fields = (
            'id', 'titulo', 'descripcion', 'cliente', 'cliente_nombre', 'cliente_color', 'personas', 'dias', 'por_dia',
            'agrupar_subtareas', 'titulo_subtarea', 'etiqueta', 'prioridad', 'hora_inicio', 'hora_fin', 'activa',
            'generada_hasta', 'creado',
        )
        read_only_fields = ('id', 'generada_hasta', 'creado')

    def validate_titulo(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('El título es obligatorio.')
        return value

    def validate_titulo_subtarea(self, value):
        return (value or '').strip()

    validate_etiqueta = TareaSerializer.validate_etiqueta

    def validate_dias(self, value):
        if not isinstance(value, list) or not value or any(not isinstance(d, int) or not 0 <= d <= 6 for d in value):
            raise serializers.ValidationError('Elegí al menos un día de la semana.')
        return sorted(set(value))

    def validate(self, attrs):
        inst = self.instance
        h_ini = attrs.get('hora_inicio', getattr(inst, 'hora_inicio', None))
        h_fin = attrs.get('hora_fin', getattr(inst, 'hora_fin', None))
        for k in ('hora_inicio', 'hora_fin'):
            if attrs.get(k) is not None:
                attrs[k] = attrs[k].replace(second=0, microsecond=0)
        if h_fin and not h_ini:
            raise serializers.ValidationError({'hora_inicio': 'Poné también la hora de inicio.'})
        if h_ini and h_fin and h_fin <= h_ini:
            raise serializers.ValidationError({'hora_fin': 'La hora de fin tiene que ser posterior a la de inicio.'})
        return attrs


class PersonaBasicaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Persona
        fields = ('id', 'nombre', 'rol', 'color', 'activo')
        read_only_fields = fields


class PersonaSerializer(serializers.ModelSerializer):
    tareas = serializers.SerializerMethodField()
    usuario = serializers.SerializerMethodField()
    clientes = serializers.SerializerMethodField()

    class Meta:
        model = Persona
        fields = (
            'id', 'nombre', 'rol', 'color', 'contactos', 'notas', 'tipo_vinculo', 'cuit', 'alias_cbu',
            'activo', 'tareas', 'usuario', 'clientes', 'notion_user_id',
        )
        read_only_fields = ('id',)

    def get_tareas(self, obj):
        return [a.tarea_id for a in obj.asignaciones.all()]

    def get_usuario(self, obj):
        u = getattr(obj, 'usuario', None)
        return u.username if u else None

    def get_clientes(self, obj):
        return [
            {'id': a.id, 'cliente': a.cliente_id, 'cliente_nombre': a.cliente.nombre, 'rol': a.rol}
            for a in obj.asignaciones_cliente.all()
            if a.activo
        ]

    def validate_contactos(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Debe ser una lista.')
        return value


class AsignacionClienteSerializer(serializers.ModelSerializer):
    persona_nombre = serializers.CharField(source='persona.nombre', read_only=True)
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True)

    class Meta:
        model = AsignacionCliente
        fields = ('id', 'persona', 'persona_nombre', 'cliente', 'cliente_nombre', 'rol', 'modalidad', 'valor', 'activo', 'creado')
        read_only_fields = ('id', 'creado')
        validators = []

    def validate(self, attrs):
        modalidad = attrs.get('modalidad', getattr(self.instance, 'modalidad', 'fijo'))
        valor = attrs.get('valor', getattr(self.instance, 'valor', 0))
        if modalidad == 'porcentaje' and valor > 100:
            raise serializers.ValidationError({'valor': 'El porcentaje no puede superar 100.'})
        persona = attrs.get('persona', getattr(self.instance, 'persona', None))
        cliente = attrs.get('cliente', getattr(self.instance, 'cliente', None))
        rol = attrs.get('rol', getattr(self.instance, 'rol', ''))
        dup = AsignacionCliente.objects.filter(persona=persona, cliente=cliente, rol=rol)
        if self.instance is not None:
            dup = dup.exclude(pk=self.instance.pk)
        if dup.exists():
            raise serializers.ValidationError({'rol': 'Esa persona ya tiene ese rol en el cliente.'})
        return attrs


class LiquidacionItemSerializer(serializers.ModelSerializer):
    total = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)

    class Meta:
        model = LiquidacionItem
        fields = ('id', 'concepto', 'cantidad', 'monto_unitario', 'total')
        read_only_fields = ('id',)


class LiquidacionSerializer(serializers.ModelSerializer):
    items = LiquidacionItemSerializer(many=True, required=False)
    persona_nombre = serializers.CharField(source='persona.nombre', read_only=True)
    persona_color = serializers.CharField(source='persona.color', read_only=True)
    persona_alias_cbu = serializers.CharField(source='persona.alias_cbu', read_only=True)
    persona_cuit = serializers.CharField(source='persona.cuit', read_only=True)
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)
    modalidad = serializers.CharField(source='asignacion.modalidad', read_only=True, default=None)

    class Meta:
        model = Liquidacion
        fields = (
            'id', 'persona', 'persona_nombre', 'persona_color', 'persona_alias_cbu', 'persona_cuit', 'periodo',
            'concepto', 'cliente', 'cliente_nombre', 'asignacion', 'modalidad', 'origen', 'monto_base', 'items',
            'total', 'estado', 'fecha_pago', 'medio_pago', 'comprobante', 'transaccion', 'notas', 'creado',
        )
        read_only_fields = (
            'id', 'asignacion', 'origen', 'total', 'estado', 'fecha_pago', 'medio_pago', 'comprobante',
            'transaccion', 'creado',
        )

    def validate_periodo(self, value):
        if not MES_RE.match(value or ''):
            raise serializers.ValidationError('Formato inválido; se espera YYYY-MM.')
        return value

    def validate(self, attrs):
        if self.instance is not None and self.instance.estado in ('pagada', 'anulada'):
            raise serializers.ValidationError({'detail': 'No se puede editar una liquidación pagada o anulada.'})
        return attrs

    def _guardar_items(self, liq, items):
        if items is None:
            return
        liq.items.all().delete()
        LiquidacionItem.objects.bulk_create([LiquidacionItem(liquidacion=liq, **i) for i in items])

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop('items', [])
        liq = Liquidacion.objects.create(origen='manual', **validated_data)
        self._guardar_items(liq, items)
        liq.recalcular()
        return liq

    @transaction.atomic
    def update(self, instance, validated_data):
        items = validated_data.pop('items', None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        self._guardar_items(instance, items)
        if hasattr(instance, '_prefetched_objects_cache'):
            instance._prefetched_objects_cache.clear()
        instance.recalcular()
        return instance


class PagarLiquidacionSerializer(serializers.Serializer):
    fecha = serializers.DateField(required=False, allow_null=True)
    medio_pago = serializers.ChoiceField(
        choices=[c[0] for c in Liquidacion._meta.get_field('medio_pago').choices], required=False, allow_blank=True, default=''
    )
    comprobante = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')


class FilaRepartoSerializer(serializers.Serializer):
    persona = serializers.PrimaryKeyRelatedField(queryset=Persona.objects.all())
    monto = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal('0.01'))


class RepartirSerializer(PagarLiquidacionSerializer):
    cliente = serializers.PrimaryKeyRelatedField(queryset=Cliente.objects.all())
    periodo = serializers.RegexField(MES_RE, error_messages={'invalid': 'Formato inválido; se espera YYYY-MM.'})
    concepto = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    filas = FilaRepartoSerializer(many=True)
    pagado = serializers.BooleanField(default=False)

    def validate_filas(self, value):
        if not value:
            raise serializers.ValidationError('Cargá al menos una persona.')
        ids = [f['persona'].id for f in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError('Hay personas repetidas.')
        return value
