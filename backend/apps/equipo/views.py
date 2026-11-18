import logging
from decimal import Decimal

from django.db.models import Q, Sum
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import cron
from apps.core.csv_utils import csv_response, monto_es
from apps.core.permissions import IsAdmin, IsAdminOrReadOnly, es_admin, persona_de, tiene_permiso
from apps.core.utils import money, parse_mes, today
from apps.calendario import etiquetas, google_calendar
from apps.notificaciones import services as avisos
from apps.servicios.services import al_completar_tarea as servicios_al_completar

from . import actividad, dependencias, services
from .models import AsignacionCliente, AsignacionTarea, ComentarioTarea, Liquidacion, Persona, PlantillaTarea, Tarea, TareaRecurrente
from .serializers import (
    AsignacionClienteSerializer,
    LiquidacionSerializer,
    PagarLiquidacionSerializer,
    PersonaBasicaSerializer,
    PersonaSerializer,
    PlanDelMesSerializer,
    PlantillaTareaSerializer,
    RepartirSerializer,
    TareaRecurrenteSerializer,
    TareaSerializer,
    es_interna,
    puede_editar_tarea,
)

GESTION_INTERNA = 'AuraTeam - Gestión Interna'

logger = logging.getLogger(__name__)


def _nombre(user):
    if user is None:
        return 'Alguien'
    if user.persona_id:
        return user.persona.nombre
    return (user.nombre_display if user.nombre_display not in ('', 'Yo') else '') or user.first_name or user.username


def _texto_error(detalle) -> str:
    if isinstance(detalle, dict):
        return ' '.join(_texto_error(v) for v in detalle.values())
    if isinstance(detalle, list):
        return ' '.join(_texto_error(v) for v in detalle)
    return str(detalle)


class PlantillaTareaViewSet(viewsets.ModelViewSet):
    """Moldes para crear tareas: los ve todo el equipo (las de etiquetas privadas, solo admins); los editan los admins."""

    serializer_class = PlantillaTareaSerializer
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def get_queryset(self):
        qs = PlantillaTarea.objects.prefetch_related('personas')
        if not es_admin(self.request.user):
            qs = qs.exclude(etiqueta__in=etiquetas.privadas())
        return qs


class PersonaViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def get_serializer_class(self):
        return PersonaSerializer if es_admin(self.request.user) else PersonaBasicaSerializer

    def get_queryset(self):
        qs = Persona.objects.select_related('usuario').prefetch_related('asignaciones', 'asignaciones_cliente__cliente')
        if self.request.query_params.get('activo') in ('1', 'true'):
            qs = qs.filter(activo=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        persona = self.get_object()
        if persona.liquidaciones.exists():
            persona.activo = False
            persona.save(update_fields=['activo'])
            return Response(
                {'detail': 'La persona tiene pagos registrados; se marcó como inactiva.', 'desactivada': True},
                status=status.HTTP_200_OK,
            )
        persona.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TareaPermission(permissions.BasePermission):
    """Todos ven todas las tareas; el equipo crea y edita las suyas (asignadas o creadas por él) y las de gestión interna.
    Borrar es del admin."""

    message = 'Solo podés editar tus tareas.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if es_admin(request.user) or request.method in permissions.SAFE_METHODS:
            return True
        return view.action in ('create', 'update', 'partial_update', 'plan', 'subtarea', 'lote', 'comentarios', 'comentario')

    def has_object_permission(self, request, view, obj):
        if es_admin(request.user) or request.method in permissions.SAFE_METHODS:
            return True
        if view.action in ('comentarios', 'comentario'):
            # Comentar puede cualquiera que la ve; borrar un comentario se chequea en la acción (solo su autor).
            return True
        return puede_editar_tarea(request.user, obj)


class TareaViewSet(viewsets.ModelViewSet):
    serializer_class = TareaSerializer
    permission_classes = [TareaPermission]

    def get_queryset(self):
        qs = Tarea.objects.select_related('cliente', 'aviso_servicio').prefetch_related(
            'asignaciones__persona', 'subtareas', 'depende_de__cliente', 'desbloquea__cliente'
        )
        if not es_admin(self.request.user):
            qs = qs.exclude(etiqueta__in=etiquetas.privadas())
            # Las tareas de pagos y aportes de servicios (con montos) solo las ve su responsable.
            qs = qs.exclude(Q(aviso_servicio__isnull=False) & ~Q(aviso_servicio__persona=persona_de(self.request.user)))
        p = self.request.query_params
        if p.get('estado') == 'abiertas':
            qs = qs.exclude(estado='hecha')
        elif p.get('estado'):
            qs = qs.filter(estado=p['estado'])
        if p.get('cliente'):
            qs = qs.filter(cliente_id=p['cliente'])
        if p.get('persona'):
            qs = qs.filter(asignaciones__persona_id=p['persona'])
        if p.get('q'):
            qs = qs.filter(Q(titulo__icontains=p['q']) | Q(descripcion__icontains=p['q']))
        return qs.distinct()

    def list(self, request, *args, **kwargs):
        services.generar_recurrentes()
        cron.respaldo()
        return super().list(request, *args, **kwargs)

    def _efectos(self, tarea, estado_anterior, user, antes_asignados=None):
        google_calendar.al_guardar_tarea(tarea)
        if antes_asignados is not None:
            nuevas = set(tarea.asignaciones.values_list('persona_id', flat=True)) - antes_asignados
            avisos.al_asignar(tarea, list(nuevas), user)
        if estado_anterior != tarea.estado:
            avisos.al_cambiar_estado(tarea, estado_anterior, user)
            dependencias.propagar(tarea, estado_anterior, user)
        if tarea.estado == 'hecha' and estado_anterior != 'hecha':
            try:
                servicios_al_completar(tarea, user)
            except Exception:
                logger.exception('No se pudo registrar el pago del servicio de la tarea %s', tarea.pk)

    def perform_create(self, serializer):
        user = self.request.user
        tarea = serializer.save(user=user)
        persona = persona_de(user)
        if not es_admin(user) and persona is not None and not tarea.asignaciones.exists():
            AsignacionTarea.objects.create(persona=persona, tarea=tarea)
        actividad.registrar(tarea, 'Creó la tarea', user)
        google_calendar.al_guardar_tarea(tarea)
        avisos.al_asignar(tarea, list(tarea.asignaciones.values_list('persona_id', flat=True)), user)
        if tarea.estado == 'hecha':
            try:
                servicios_al_completar(tarea, user)
            except Exception:
                logger.exception('No se pudo registrar el pago del servicio de la tarea %s', tarea.pk)

    def perform_update(self, serializer):
        user, tarea = self.request.user, serializer.instance
        nuevos = serializer.validated_data.get('personas_asignadas')
        if nuevos is not None and not es_admin(user) and tarea.user_id != user.id and not es_interna(tarea):
            actuales = set(tarea.asignaciones.values_list('persona_id', flat=True))
            if {p.id for p in nuevos} != actuales:
                raise PermissionDenied('Solo quien creó la tarea o un administrador puede cambiar los responsables.')
        foto = actividad.foto(tarea)
        estado_anterior = tarea.estado
        tarea = serializer.save()
        actividad.registrar_cambios(tarea, foto, user)
        self._efectos(tarea, estado_anterior, user, foto['asignados'])

    @action(detail=True, methods=['patch'], url_path=r'subtareas/(?P<sub_id>[0-9]+)')
    def subtarea(self, request, pk=None, sub_id=None):
        """Tilda o destilda una subtarea al instante y ajusta el estado de la tarea."""
        tarea = self.get_object()
        sub = tarea.subtareas.filter(pk=sub_id).first()
        if sub is None:
            return Response({'detail': 'Esa subtarea no existe.'}, status=status.HTTP_404_NOT_FOUND)
        hecha = request.data.get('hecha')
        if not isinstance(hecha, bool):
            return Response({'hecha': 'Indicá si está hecha.'}, status=status.HTTP_400_BAD_REQUEST)
        if tarea.estado == 'bloqueada' and services.esperando(tarea):
            return Response(
                {'detail': 'La tarea espera a otras: no se puede avanzar hasta que estén Hechas.'}, status=status.HTTP_400_BAD_REQUEST
            )
        estado_anterior = tarea.estado
        if sub.hecha != hecha:
            sub.hecha = hecha
            sub.save(update_fields=['hecha'])
            actividad.registrar(tarea, f'{"Tildó" if hecha else "Destildó"} «{sub.titulo}»', request.user)
            tarea._checklist_tocado = True
            services.fijar_estado(tarea, services.estado_segun_subtareas(tarea, tarea.estado))
            if tarea.estado != estado_anterior:
                actividad.registrar(tarea, f'Pasó a {actividad.ESTADOS.get(tarea.estado, tarea.estado)} por el checklist', request.user)
            self._efectos(tarea, estado_anterior, request.user)
        if hasattr(tarea, '_prefetched_objects_cache'):
            tarea._prefetched_objects_cache.clear()
        return Response(self.get_serializer(tarea).data)

    @action(detail=False, methods=['post'])
    def plan(self, request):
        """Crea varias tareas de un cliente (o de gestión interna) de una vez. Llegan a Google de a tandas."""
        serializer = PlanDelMesSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user, cliente = request.user, serializer.validated_data.get('cliente')
        if not es_admin(user):
            persona = persona_de(user)
            asignado = cliente is None or (
                persona is not None and AsignacionCliente.objects.filter(persona=persona, cliente=cliente, activo=True).exists()
            )
            if not (tiene_permiso(user, 'plan_tareas') and asignado):
                raise PermissionDenied('Solo podés armar el plan de tus clientes asignados.')
        creadas = serializer.save()
        avisos.asignadas_en_tanda(creadas, f'de {cliente.nombre if cliente else GESTION_INTERNA} (plan del mes)', user, email=True)
        return Response({'creadas': len(creadas)}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def historial(self, request, pk=None):
        """Comentarios y cambios de la tarea, del más viejo al más nuevo."""
        tarea = self.get_object()
        items = [
            {'tipo': 'comentario', 'id': c.id, 'texto': c.texto, 'creado': c.creado, 'autor': _nombre(c.autor),
             'propio': c.autor_id == request.user.id}
            for c in tarea.comentarios.select_related('autor')
        ] + [
            {'tipo': 'cambio', 'id': a.id, 'texto': a.texto, 'creado': a.creado, 'autor': _nombre(a.usuario) if a.usuario_id else 'Sistema'}
            for a in tarea.actividad.select_related('usuario')
        ]
        items.sort(key=lambda i: i['creado'])
        return Response(items)

    @action(detail=True, methods=['post'])
    def comentarios(self, request, pk=None):
        tarea = self.get_object()
        texto = str(request.data.get('texto', '')).strip()
        if not texto:
            return Response({'texto': 'Escribí el comentario.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(texto) > 4000:
            return Response({'texto': 'Máximo 4000 caracteres.'}, status=status.HTTP_400_BAD_REQUEST)
        c = ComentarioTarea.objects.create(tarea=tarea, autor=request.user, texto=texto)
        avisos.al_comentar(tarea, c, request.user)
        return Response({'id': c.id}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['delete'], url_path=r'comentarios/(?P<com_id>[0-9]+)')
    def comentario(self, request, pk=None, com_id=None):
        tarea = self.get_object()
        c = tarea.comentarios.filter(pk=com_id).first()
        if c is None:
            return Response({'detail': 'Ese comentario no existe.'}, status=status.HTTP_404_NOT_FOUND)
        if c.autor_id != request.user.id and not es_admin(request.user):
            raise PermissionDenied('Solo quien lo escribió puede borrarlo.')
        c.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    def lote(self, request):
        """Aplica los mismos cambios a varias tareas. Las que no se pueden tocar vuelven en `errores`."""
        ids = request.data.get('ids')
        if not isinstance(ids, list) or not ids or len(ids) > 200:
            return Response({'ids': 'Elegí entre 1 y 200 tareas.'}, status=status.HTTP_400_BAD_REQUEST)
        cambios = request.data.get('cambios') or {}
        borrar = request.data.get('borrar') is True
        if not isinstance(cambios, dict) or (not borrar and not cambios):
            return Response({'cambios': 'Indicá qué cambiar.'}, status=status.HTTP_400_BAD_REQUEST)
        if borrar and not es_admin(request.user):
            raise PermissionDenied('Solo un administrador puede borrar tareas.')
        permitidos = {'estado', 'fecha_limite', 'prioridad', 'etiqueta', 'agregar', 'quitar'}
        if set(cambios) - permitidos:
            return Response({'cambios': f'Campos no permitidos: {", ".join(sorted(set(cambios) - permitidos))}.'},
                            status=status.HTTP_400_BAD_REQUEST)
        agregar = {int(x) for x in cambios.get('agregar') or []}
        quitar = {int(x) for x in cambios.get('quitar') or []}
        datos = {k: v for k, v in cambios.items() if k not in ('agregar', 'quitar')}
        hechas, errores = 0, []
        for tarea in self.get_queryset().filter(pk__in=ids):
            try:
                self.check_object_permissions(request, tarea)
                if borrar:
                    self.perform_destroy(tarea)
                    hechas += 1
                    continue
                body = dict(datos)
                if agregar or quitar:
                    actuales = set(tarea.asignaciones.values_list('persona_id', flat=True))
                    body['asignados'] = sorted((actuales | agregar) - quitar)
                serializer = self.get_serializer(tarea, data=body, partial=True)
                serializer.is_valid(raise_exception=True)
                self.perform_update(serializer)
                hechas += 1
            except Exception as e:  # noqa: BLE001 — cada tarea se informa por separado
                detalle = getattr(e, 'detail', None) or str(e)
                errores.append({'id': tarea.id, 'titulo': tarea.titulo, 'detalle': _texto_error(detalle)})
        return Response({'hechas': hechas, 'errores': errores})

    def perform_destroy(self, instance):
        gid, cal_id = instance.google_event_id, instance.google_calendar_id
        esperaban = list(instance.desbloquea.all())
        instance.delete()
        google_calendar.al_borrar_tarea(gid, cal_id)
        for dep in esperaban:
            # Sin esa dependencia puede quedar libre.
            if services.ajustar_por_dependencias(dep) == 'desbloqueada':
                avisos.tarea_disponible(dep, instance, self.request.user, borrada=True)
                google_calendar.al_guardar_tarea(dep)


class TareaRecurrenteViewSet(viewsets.ModelViewSet):
    """Plantillas de tareas recurrentes. Borrar una plantilla no borra las tareas que ya generó."""

    serializer_class = TareaRecurrenteSerializer
    permission_classes = [IsAdmin]
    pagination_class = None
    queryset = TareaRecurrente.objects.select_related('cliente').prefetch_related('personas')

    def perform_create(self, serializer):
        serializer.save()
        services.generar_recurrentes()

    def perform_update(self, serializer):
        serializer.save()
        services.generar_recurrentes()


class AsignacionClienteViewSet(viewsets.ModelViewSet):
    serializer_class = AsignacionClienteSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_queryset(self):
        qs = AsignacionCliente.objects.select_related('persona', 'cliente')
        p = self.request.query_params
        if p.get('persona'):
            qs = qs.filter(persona_id=p['persona'])
        if p.get('cliente'):
            qs = qs.filter(cliente_id=p['cliente'])
        return qs


class LiquidacionViewSet(viewsets.ModelViewSet):
    serializer_class = LiquidacionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = Liquidacion.objects.select_related('persona', 'cliente', 'asignacion').prefetch_related('items')
        user = self.request.user
        if not es_admin(user):
            persona = persona_de(user)
            if persona is None:
                return qs.none()
            qs = qs.filter(persona=persona).exclude(estado='anulada')
        p = self.request.query_params
        periodo = p.get('periodo') or p.get('mes')
        if periodo:
            _, _, periodo = parse_mes(periodo)
            qs = qs.filter(periodo=periodo)
        if p.get('persona'):
            qs = qs.filter(persona_id=p['persona'])
        if p.get('cliente'):
            qs = qs.filter(cliente_id=p['cliente'])
        if p.get('estado') == 'abiertas':
            qs = qs.filter(estado__in=('pendiente', 'aprobada'))
        elif p.get('estado'):
            qs = qs.filter(estado=p['estado'])
        return qs

    def destroy(self, request, *args, **kwargs):
        liq = self.get_object()
        if liq.estado == 'pagada':
            return Response({'detail': 'Revertí el pago antes de borrar la liquidación.'}, status=status.HTTP_400_BAD_REQUEST)
        liq.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    def repartir(self, request):
        s = RepartirSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        pago = {k: d[k] for k in ('fecha', 'medio_pago', 'comprobante')} if d['pagado'] else None
        liqs = services.repartir_cobro(
            cliente=d['cliente'], periodo=d['periodo'], concepto=d['concepto'].strip() or d['cliente'].nombre,
            filas=d['filas'], pago=pago, user=request.user,
        )
        return Response(self.get_serializer(liqs, many=True).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def aprobar(self, request, pk=None):
        liq = self.get_object()
        if liq.estado != 'pendiente':
            return Response({'detail': 'Solo se aprueban liquidaciones pendientes.'}, status=status.HTTP_400_BAD_REQUEST)
        liq.estado = 'aprobada'
        liq.save(update_fields=['estado'])
        return Response(self.get_serializer(liq).data)

    @action(detail=True, methods=['post'])
    def pagar(self, request, pk=None):
        s = PagarLiquidacionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        liq = services.pagar_liquidacion(self.get_object(), user=request.user, **s.validated_data)
        return Response(self.get_serializer(liq).data)

    @action(detail=True, methods=['post'])
    def revertir(self, request, pk=None):
        return Response(self.get_serializer(services.revertir_liquidacion(self.get_object())).data)

    @action(detail=True, methods=['post'])
    def anular(self, request, pk=None):
        liq = self.get_object()
        if liq.estado == 'pagada':
            return Response({'detail': 'Revertí el pago antes de anular.'}, status=status.HTTP_400_BAD_REQUEST)
        liq.estado = 'anulada'
        liq.save(update_fields=['estado'])
        return Response(self.get_serializer(liq).data)

    @action(detail=False, methods=['get'])
    def resumen(self, request):
        qs = self.get_queryset().exclude(estado='anulada')
        por_estado = {r['estado']: r['t'] or Decimal('0') for r in qs.values('estado').annotate(t=Sum('total'))}
        personas = [
            {
                'persona': r['persona_id'],
                'persona_nombre': r['persona__nombre'],
                'total': str(money(r['t'])),
                'pagado': str(money(r['pagado'] or 0)),
            }
            for r in qs.values('persona_id', 'persona__nombre')
            .annotate(t=Sum('total'), pagado=Sum('total', filter=Q(estado='pagada')))
            .order_by('persona__nombre')
        ]
        total = sum(por_estado.values(), Decimal('0'))
        pagado = por_estado.get('pagada', Decimal('0'))
        return Response(
            {'total': str(money(total)), 'pagado': str(money(pagado)), 'pendiente': str(money(total - pagado)), 'personas': personas}
        )

    @action(detail=False, methods=['get'], url_path='export.csv', permission_classes=[IsAdmin])
    def export_csv(self, request):
        rows = (
            [
                l.periodo, l.persona.nombre, l.concepto, l.cliente.nombre if l.cliente else '', l.get_estado_display(),
                monto_es(l.total), l.fecha_pago.isoformat() if l.fecha_pago else '', l.persona.alias_cbu, l.comprobante,
            ]
            for l in self.get_queryset()
        )
        return csv_response(
            'pagos_equipo.csv',
            ['Período', 'Persona', 'Concepto', 'Cliente', 'Estado', 'Total', 'Fecha de pago', 'Alias/CBU', 'Comprobante'],
            rows,
        )


def tareas_proximas(persona=None, dias=7):
    hoy = today()
    qs = Tarea.objects.exclude(estado='hecha').filter(fecha_limite__isnull=False, fecha_limite__lte=hoy.fromordinal(hoy.toordinal() + dias))
    if persona is not None:
        qs = qs.filter(asignaciones__persona=persona).exclude(etiqueta__in=etiquetas.privadas())
    return qs.select_related('cliente', 'aviso_servicio').distinct()


class SeguimientoView(APIView):
    """«Equipo hoy»: tablero de cumplimiento por persona para los admins."""

    permission_classes = [IsAdmin]

    def get(self, request):
        from datetime import date

        from .seguimiento import seguimiento

        try:
            fecha = date.fromisoformat(request.query_params['fecha']) if request.query_params.get('fecha') else today()
        except ValueError:
            return Response({'detail': 'Fecha inválida.'}, status=status.HTTP_400_BAD_REQUEST)
        filas = seguimiento(fecha, request.query_params.get('rol') or None)
        ctx = {'request': request}
        personas = [
            {
                'id': f['persona'].id,
                'nombre': f['persona'].nombre,
                'color': f['persona'].color,
                'roles': f['persona'].usuario.roles or [],
                'es_admin': f['persona'].usuario.es_admin,
                'conteos': f['conteos'],
                'semaforo': f['semaforo'],
                'cumplimiento_7': f['cumplimiento_7'],
                'cumplimiento_30': f['cumplimiento_30'],
                'tareas': TareaSerializer(f['tareas'], many=True, context=ctx).data,
            }
            for f in filas
        ]
        totales = {k: sum(p['conteos'][k] for p in personas) for k in ('vencidas', 'hoy', 'en_revision', 'bloqueadas', 'hechas_hoy')}
        valores = [p['cumplimiento_7'] for p in personas if p['cumplimiento_7'] is not None]
        totales['cumplimiento_7'] = round(sum(valores) / len(valores)) if valores else None
        totales['en_rojo'] = sum(1 for p in personas if p['semaforo'] == 'rojo')
        from apps.clientes.onboarding import atrasados

        return Response({'fecha': fecha, 'totales': totales, 'personas': personas, 'onboarding_atrasado': atrasados(fecha)})
