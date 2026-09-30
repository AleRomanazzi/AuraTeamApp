from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.clientes.models import Cliente
from apps.core.utils import MES_RE

from .models import AsignacionCliente, AsignacionTarea, Liquidacion, LiquidacionItem, Persona, Tarea


class TareaSerializer(serializers.ModelSerializer):
    asignados = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=Persona.objects.all(), source='personas_asignadas'
    )
    asignados_nombres = serializers.SerializerMethodField()
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)
    cliente_color = serializers.CharField(source='cliente.color', read_only=True, default=None)
    vencida = serializers.SerializerMethodField()

    class Meta:
        model = Tarea
        fields = (
            'id', 'titulo', 'descripcion', 'cliente', 'cliente_nombre', 'cliente_color', 'estado', 'prioridad',
            'fecha_limite', 'completada_en', 'asignados', 'asignados_nombres', 'vencida', 'creado', 'notion_url',
        )
        read_only_fields = ('id', 'completada_en', 'creado')

    notion_url = serializers.SerializerMethodField()

    def get_notion_url(self, obj):
        return f'https://www.notion.so/{obj.notion_page_id.replace("-", "")}' if obj.notion_page_id else None

    def to_representation(self, instance):
        instance.personas_asignadas = [a.persona for a in instance.asignaciones.all()]
        return super().to_representation(instance)

    def get_asignados_nombres(self, obj):
        return [p.nombre for p in getattr(obj, 'personas_asignadas', [])]

    def get_vencida(self, obj):
        return bool(obj.fecha_limite and obj.estado != 'hecha' and obj.fecha_limite < timezone.localdate())

    def validate_titulo(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('El título es obligatorio.')
        return value

    def _aplicar_estado(self, validated, instance=None):
        estado = validated.get('estado')
        if estado is None:
            return
        if estado == 'hecha' and (instance is None or instance.estado != 'hecha'):
            validated['completada_en'] = timezone.now()
        elif estado != 'hecha':
            validated['completada_en'] = None

    @transaction.atomic
    def create(self, validated_data):
        personas = validated_data.pop('personas_asignadas', [])
        self._aplicar_estado(validated_data)
        tarea = Tarea.objects.create(**validated_data)
        for p in personas:
            AsignacionTarea.objects.create(persona=p, tarea=tarea)
        return tarea

    @transaction.atomic
    def update(self, instance, validated_data):
        personas = validated_data.pop('personas_asignadas', None)
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
        if hasattr(instance, '_prefetched_objects_cache'):
            instance._prefetched_objects_cache.clear()
        return instance


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
