from rest_framework import permissions, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import es_admin, persona_de
from apps.core.utils import aplica_en_mes, fecha_en_mes, money, parse_fecha_param, parse_mes

from .models import EventoUnico
from .serializers import EventoUnicoSerializer


class EventoPermission(permissions.IsAuthenticated):
    message = 'Solo podés editar los eventos que creaste.'

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS or es_admin(request.user):
            return True
        return obj.user_id is not None and obj.user_id == request.user.id


class EventoUnicoViewSet(viewsets.ModelViewSet):
    serializer_class = EventoUnicoSerializer
    permission_classes = [EventoPermission]
    pagination_class = None

    def get_queryset(self):
        qs = EventoUnico.objects.select_related('cliente')
        p = self.request.query_params
        desde = parse_fecha_param(p.get('desde'), 'desde')
        hasta = parse_fecha_param(p.get('hasta'), 'hasta')
        if desde:
            qs = qs.filter(inicio__gte=desde)
        if hasta:
            qs = qs.filter(inicio__lte=hasta)
        if p.get('cliente'):
            qs = qs.filter(cliente_id=p['cliente'])
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class VencimientosView(APIView):
    """Todo lo que vence en el mes para pintar el calendario: cobros, contratos aún sin cobro,
    suscripciones y tareas con fecha límite. El equipo solo ve sus tareas."""

    def get(self, request):
        from apps.clientes.models import Cobro, Contrato
        from apps.equipo.models import Tarea
        from apps.servicios.models import Servicio
        from apps.servicios.services import aplica_servicio_en_mes

        inicio, fin, periodo = parse_mes(request.query_params.get('mes'))
        items = []
        tareas = Tarea.objects.exclude(estado='hecha').filter(fecha_limite__range=(inicio, fin)).select_related('cliente')

        if es_admin(request.user):
            cobros = Cobro.objects.filter(vencimiento__range=(inicio, fin)).exclude(estado='anulado').select_related('cliente')
            con_cobro = set(Cobro.objects.filter(periodo=periodo, contrato__isnull=False).values_list('contrato_id', flat=True))
            for c in cobros:
                items.append(
                    {
                        'tipo': 'cobro', 'id': c.id, 'fecha': c.vencimiento, 'titulo': f'Cobro {c.cliente.nombre}',
                        'detalle': c.concepto, 'monto': str(money(c.saldo if c.estado != 'pagado' else c.monto)),
                        'estado': 'vencido' if c.vencido else c.estado, 'color': c.cliente.color,
                    }
                )
            contratos = Contrato.objects.filter(
                activo=True, cliente__estado='activo', fecha_inicio__lte=fin
            ).select_related('cliente').prefetch_related('ajustes')
            for ct in contratos:
                if ct.id in con_cobro or (ct.fecha_fin and ct.fecha_fin < inicio):
                    continue
                if not aplica_en_mes(ct.fecha_inicio, ct.periodicidad, inicio.year, inicio.month):
                    continue
                items.append(
                    {
                        'tipo': 'contrato', 'id': ct.id, 'fecha': fecha_en_mes(inicio.year, inicio.month, ct.dia_vencimiento),
                        'titulo': f'Cobro {ct.cliente.nombre}', 'detalle': f'{ct.concepto} (sin generar)',
                        'monto': str(money(ct.monto_para(inicio, list(ct.ajustes.all())))), 'estado': 'proyectado',
                        'color': ct.cliente.color,
                    }
                )
            for s in Servicio.objects.filter(activo=True).prefetch_related('pagos'):
                if not aplica_servicio_en_mes(s, inicio.year, inicio.month):
                    continue
                pagado = any(p.periodo == periodo for p in s.pagos.all())
                items.append(
                    {
                        'tipo': 'suscripcion', 'id': s.id, 'fecha': fecha_en_mes(inicio.year, inicio.month, s.dia_vencimiento),
                        'titulo': s.nombre, 'detalle': s.proveedor, 'monto': str(money(s.monto_agencia)),
                        'estado': 'pagado' if pagado else 'pendiente', 'color': '#ff6b6b',
                    }
                )
        else:
            persona = persona_de(request.user)
            tareas = tareas.filter(asignaciones__persona=persona) if persona else tareas.none()

        for t in tareas.distinct():
            items.append(
                {
                    'tipo': 'tarea', 'id': t.id, 'fecha': t.fecha_limite, 'titulo': t.titulo,
                    'detalle': t.cliente.nombre if t.cliente else '', 'monto': None, 'estado': t.estado,
                    'color': t.cliente.color if t.cliente else '#ffd166',
                }
            )
        items.sort(key=lambda i: (i['fecha'], i['tipo']))
        return Response({'periodo': periodo, 'items': items})
