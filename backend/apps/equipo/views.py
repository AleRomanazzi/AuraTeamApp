from decimal import Decimal

from django.db.models import Q, Sum
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core.csv_utils import csv_response, monto_es
from apps.core.permissions import IsAdmin, IsAdminOrReadOnly, es_admin, persona_de
from apps.core.utils import money, parse_mes, today
from apps.calendario import google_calendar
from apps.integraciones import notion

from . import services
from .models import AsignacionCliente, AsignacionTarea, Liquidacion, Persona, Tarea
from .serializers import (
    AsignacionClienteSerializer,
    LiquidacionSerializer,
    PagarLiquidacionSerializer,
    PersonaBasicaSerializer,
    PersonaSerializer,
    RepartirSerializer,
    TareaSerializer,
    es_tarea_propia,
)


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

    def perform_update(self, serializer):
        antes = serializer.instance.notion_user_id
        persona = serializer.save()
        if persona.notion_user_id != antes:
            notion.al_vincular_persona(persona)

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
    """Todos ven todas las tareas; el equipo crea y edita las suyas (asignadas o creadas por él). Borrar es del admin."""

    message = 'Solo podés editar tus tareas.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if es_admin(request.user) or request.method in permissions.SAFE_METHODS:
            return True
        return view.action in ('create', 'update', 'partial_update')

    def has_object_permission(self, request, view, obj):
        if es_admin(request.user) or request.method in permissions.SAFE_METHODS:
            return True
        return es_tarea_propia(request.user, obj)


class TareaViewSet(viewsets.ModelViewSet):
    serializer_class = TareaSerializer
    permission_classes = [TareaPermission]

    def get_queryset(self):
        qs = Tarea.objects.select_related('cliente').prefetch_related('asignaciones__persona')
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

    def perform_create(self, serializer):
        user = self.request.user
        tarea = serializer.save(user=user)
        persona = persona_de(user)
        if not es_admin(user) and persona is not None and not tarea.asignaciones.exists():
            AsignacionTarea.objects.create(persona=persona, tarea=tarea)
        notion.al_guardar_tarea(tarea)
        google_calendar.al_guardar_tarea(tarea)

    def perform_update(self, serializer):
        user, tarea = self.request.user, serializer.instance
        nuevos = serializer.validated_data.get('personas_asignadas')
        if nuevos is not None and not es_admin(user) and tarea.user_id != user.id:
            actuales = set(tarea.asignaciones.values_list('persona_id', flat=True))
            if {p.id for p in nuevos} != actuales:
                raise PermissionDenied('Solo quien creó la tarea o un administrador puede cambiar los responsables.')
        tarea = serializer.save()
        notion.al_guardar_tarea(tarea)
        google_calendar.al_guardar_tarea(tarea)

    def perform_destroy(self, instance):
        page_id, gid = instance.notion_page_id, instance.google_event_id
        instance.delete()
        notion.al_borrar_tarea(page_id)
        google_calendar.al_borrar_tarea(gid)


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
        qs = qs.filter(asignaciones__persona=persona)
    return qs.select_related('cliente').distinct()
