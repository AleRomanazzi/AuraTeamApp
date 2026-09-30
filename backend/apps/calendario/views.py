from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.google import GoogleError
from apps.core.permissions import IsAdmin, es_admin, persona_de
from apps.core.utils import aplica_en_mes, fecha_en_mes, money, parse_fecha_param, parse_mes

from . import google_calendar
from .models import ETIQUETAS, ETIQUETAS_PRIVADAS, CalendarioGoogle, EstadoCalendarioGoogle, EventoUnico
from .serializers import EventoUnicoSerializer


def eventos_visibles(user):
    """El admin ve todo. El equipo no ve las etiquetas privadas; del resto, los eventos sin cliente, los de sus
    clientes (asignados o de sus tareas) y los que creó."""
    from apps.equipo.models import AsignacionCliente, Tarea

    qs = EventoUnico.objects.select_related('cliente')
    if es_admin(user):
        return qs
    filtro = Q(cliente__isnull=True) | Q(user=user)
    persona = persona_de(user)
    if persona:
        asignados = AsignacionCliente.objects.filter(persona=persona, activo=True).values('cliente_id')
        de_tareas = Tarea.objects.filter(asignaciones__persona=persona, cliente__isnull=False).exclude(estado='hecha').values('cliente_id')
        filtro |= Q(cliente_id__in=asignados) | Q(cliente_id__in=de_tareas)
    return qs.filter(filtro).exclude(etiqueta__in=ETIQUETAS_PRIVADAS)


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
        qs = eventos_visibles(self.request.user)
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
        google_calendar.al_guardar_evento(serializer.save(user=self.request.user))

    def perform_update(self, serializer):
        google_calendar.al_guardar_evento(serializer.save())

    def perform_destroy(self, instance):
        cal_id, gid = instance.google_calendar_id, instance.google_event_id
        instance.delete()
        google_calendar.al_borrar_evento(cal_id, gid)


class GoogleCalendarEstadoView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        e = EstadoCalendarioGoogle.get()
        conectado = google_calendar.configurado()
        cuenta, error_cuenta = [], None
        if conectado:
            try:
                if CalendarioGoogle.objects.count() < len(ETIQUETAS):
                    google_calendar.vincular_etiquetas()
                cuenta = google_calendar.calendarios_de_la_cuenta()
            except GoogleError as ex:
                error_cuenta = str(ex)
        elegidos = {c.etiqueta: c for c in CalendarioGoogle.objects.all()}
        return Response(
            {
                'conectado': conectado,
                'ultima_sync': e.ultima_sync,
                'ultima_sync_completa': e.ultima_sync_completa,
                'ultimo_error': e.ultimo_error or error_cuenta,
                'ultimo_error_en': e.ultimo_error_en,
                'etiquetas': [
                    {
                        'etiqueta': valor, 'nombre': nombre, 'privada': valor in ETIQUETAS_PRIVADAS,
                        'calendar_id': elegidos[valor].calendar_id if valor in elegidos else None,
                        'calendario': elegidos[valor].nombre if valor in elegidos else None,
                    }
                    for valor, nombre in ETIQUETAS
                ],
                'calendarios': cuenta,
                'eventos_en_google': EventoUnico.objects.exclude(google_event_id='').count(),
            }
        )


class GoogleCalendarEtiquetaView(APIView):
    """Elige a mano qué calendario de la cuenta corresponde a una etiqueta."""

    permission_classes = [IsAdmin]

    def post(self, request):
        etiqueta, calendar_id = request.data.get('etiqueta'), request.data.get('calendar_id')
        if etiqueta not in dict(ETIQUETAS) or not calendar_id:
            return Response({'detail': 'Etiqueta o calendario inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            google_calendar.elegir_calendario(etiqueta, calendar_id)
        except GoogleError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


class GoogleCalendarColoresView(APIView):
    """Vista previa (GET) y aplicación (POST) del color de cliente en eventos que ya existen en Google."""

    permission_classes = [IsAdmin]

    def get(self, request):
        try:
            return Response(google_calendar.colores_sugeridos())
        except GoogleError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)

    def post(self, request):
        eventos = request.data.get('eventos')
        if not isinstance(eventos, list):
            return Response({'detail': 'Falta la lista de eventos.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            return Response({'pintados': google_calendar.pintar(eventos)})
        except GoogleError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class GoogleCalendarSincronizarView(APIView):
    """Incremental (cualquier usuario, limitada a una por minuto) o completa (solo admin)."""

    def post(self, request):
        if not google_calendar.configurado():
            return Response({'omitida': True, 'detail': 'Google no está conectado.'})
        completa = bool(request.data.get('completa')) and es_admin(request.user)
        try:
            return Response(google_calendar.sincronizar(completa=completa))
        except GoogleError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


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
