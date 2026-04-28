import calendar
from datetime import date, datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.db.models.functions import Coalesce
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.serializers import MeSerializer
from apps.calendario.models import ClienteMensual, EventoUnico
from apps.calendario.serializers import ClienteMensualSerializer, EventoUnicoSerializer
from apps.equipo.models import AsignacionTarea, Persona, Tarea
from apps.equipo.serializers import PersonaSerializer, TareaSerializer
from apps.finanzas.models import Transaccion
from apps.finanzas.serializers import TransaccionSerializer
from apps.servicios.models import Servicio
from apps.servicios.serializers import ServicioSerializer
from apps.stats.models import AnalisisStats
from apps.stats.serializers import AnalisisStatsSerializer

from .serializers import UserConfigSerializer


def _dec_str(value) -> str:
    q = Decimal(value).quantize(Decimal('0.01'))
    return format(q, 'f')


def _monthly_servicio_total(s: Servicio) -> Decimal:
    """Equivalente mensual del monto total del servicio (sin usar mi_parte)."""
    metodo = (s.metodo or '').lower()
    base = s.monto_total or Decimal('0')
    if 'bimestral' in metodo:
        return base / Decimal('2')
    if 'anual' in metodo or 'año' in metodo or 'ano' in metodo:
        return base / Decimal('12')
    return base


def _add_months(y: int, m: int, delta: int) -> tuple[int, int]:
    m += delta
    while m > 12:
        m -= 12
        y += 1
    while m < 1:
        m += 12
        y -= 1
    return y, m


def _parse_mes(mes: str | None) -> tuple[date, date, str]:
    today = date.today()
    if mes and len(mes) == 7:
        y, m = int(mes[:4]), int(mes[5:7])
        start = date(y, m, 1)
        last = calendar.monthrange(y, m)[1]
        end = date(y, m, last)
        return start, end, f'{y:04d}-{m:02d}'
    y, m = today.year, today.month
    start = date(y, m, 1)
    last = calendar.monthrange(y, m)[1]
    end = date(y, m, last)
    return start, end, f'{y:04d}-{m:02d}'


def _wipe_user_business_data(user):
    user.transacciones.all().delete()
    user.servicios.all().delete()
    user.tareas.all().delete()
    user.personas.all().delete()
    user.cal_clientes.all().delete()
    user.cal_eventos.all().delete()
    user.analisis.all().delete()


class DashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        start, end, mes_key = _parse_mes(request.query_params.get('mes'))

        txs_mes = Transaccion.objects.filter(user=user, fecha__range=(start, end))
        ing = txs_mes.filter(tipo='ingreso').aggregate(s=Coalesce(Sum('monto'), Decimal('0')))['s']
        eg = txs_mes.filter(tipo='egreso').aggregate(s=Coalesce(Sum('monto'), Decimal('0')))['s']
        bal = ing - eg

        srv_mes = sum((_monthly_servicio_total(s) for s in Servicio.objects.filter(user=user)), Decimal('0'))

        y0, m0 = start.year, start.month
        series = []
        for i in range(5, -1, -1):
            y, m = _add_months(y0, m0, -i)
            d0 = date(y, m, 1)
            d1 = date(y, m, calendar.monthrange(y, m)[1])
            key = f'{y:04d}-{m:02d}'
            tsub = Transaccion.objects.filter(user=user, fecha__range=(d0, d1))
            mi = tsub.filter(tipo='ingreso').aggregate(s=Coalesce(Sum('monto'), Decimal('0')))['s']
            me = tsub.filter(tipo='egreso').aggregate(s=Coalesce(Sum('monto'), Decimal('0')))['s']
            label = datetime(y, m, 1).strftime('%b').lower()
            series.append({'mes': key, 'label': label, 'ingreso': mi, 'egreso': me})

        ultimas = Transaccion.objects.filter(user=user).order_by('-fecha', '-creado')[:5]
        ultimas_data = TransaccionSerializer(ultimas, many=True).data

        return Response(
            {
                'mes': mes_key,
                'ingresos_mes': _dec_str(ing),
                'egresos_mes': _dec_str(eg),
                'balance': _dec_str(bal),
                'servicios_proyectado_mes': _dec_str(srv_mes),
                'series_6_meses': [
                    {**row, 'ingreso': _dec_str(row['ingreso']), 'egreso': _dec_str(row['egreso'])}
                    for row in series
                ],
                'ultimas_transacciones': ultimas_data,
            }
        )


class MeConfigView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        ser = UserConfigSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(MeSerializer(request.user).data)


class MeExportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        asignaciones = list(
            AsignacionTarea.objects.filter(persona__user=user).values('persona_id', 'tarea_id')
        )
        data = {
            'version': 1,
            'config': UserConfigSerializer(user).data,
            'transacciones': TransaccionSerializer(
                Transaccion.objects.filter(user=user).order_by('-fecha', '-creado'), many=True
            ).data,
            'servicios': ServicioSerializer(Servicio.objects.filter(user=user), many=True).data,
            'personas': PersonaSerializer(Persona.objects.filter(user=user), many=True).data,
            'tareas': TareaSerializer(Tarea.objects.filter(user=user), many=True).data,
            'asignaciones': asignaciones,
            'cal_clientes': ClienteMensualSerializer(ClienteMensual.objects.filter(user=user), many=True).data,
            'cal_eventos': EventoUnicoSerializer(EventoUnico.objects.filter(user=user), many=True).data,
            'stats': AnalisisStatsSerializer(AnalisisStats.objects.filter(user=user), many=True).data,
        }
        return Response(data)


class MeImportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        body = request.data
        if body.get('version') != 1:
            return Response({'detail': 'Se requiere JSON con "version": 1.'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        _wipe_user_business_data(user)

        cfg = body.get('config') or {}
        cfg_ser = UserConfigSerializer(user, data=cfg, partial=True)
        cfg_ser.is_valid(raise_exception=True)
        cfg_ser.save()

        for row in body.get('transacciones') or []:
            Transaccion.objects.create(
                user=user,
                fecha=row['fecha'],
                descripcion=row.get('descripcion', ''),
                categoria=row.get('categoria', ''),
                tipo=row['tipo'],
                monto=row['monto'],
                notas=row.get('notas', ''),
            )

        for row in body.get('servicios') or []:
            Servicio.objects.create(
                user=user,
                nombre=row.get('nombre', ''),
                monto_total=row['monto_total'],
                metodo=row.get('metodo', ''),
                detalle=row.get('detalle') or [],
                mi_parte=row.get('mi_parte') or Decimal('0'),
                fecha_pago=row.get('fecha_pago') or None,
            )

        tarea_map = {}
        for row in body.get('tareas') or []:
            t = Tarea.objects.create(
                user=user,
                titulo=row.get('titulo', ''),
                descripcion=row.get('descripcion', ''),
            )
            old_id = row.get('id')
            if old_id is not None:
                tarea_map[int(old_id)] = t.pk

        persona_map = {}
        for row in body.get('personas') or []:
            p = Persona.objects.create(
                user=user,
                nombre=row.get('nombre', ''),
                rol=row.get('rol', ''),
                color=row.get('color') or '#7c6fff',
                contactos=row.get('contactos') or [],
                notas=row.get('notas', ''),
            )
            old_id = row.get('id')
            if old_id is not None:
                persona_map[int(old_id)] = p.pk

        for a in body.get('asignaciones') or []:
            pid = persona_map.get(int(a['persona_id']))
            tid = tarea_map.get(int(a['tarea_id']))
            if pid and tid:
                AsignacionTarea.objects.get_or_create(
                    persona_id=pid, tarea_id=tid, defaults={'estado': 'pendiente'}
                )

        for row in body.get('cal_clientes') or []:
            ClienteMensual.objects.create(
                user=user,
                nombre=row.get('titulo') or row.get('nombre', ''),
                dia_mes=row['dia_mes'],
                hora=row.get('hora') or None,
                descripcion=row.get('descripcion', ''),
                color=row.get('color') or '#4fffb0',
                monto=row.get('monto'),
            )

        for row in body.get('cal_eventos') or []:
            EventoUnico.objects.create(
                user=user,
                nombre=row.get('titulo') or row.get('nombre', ''),
                inicio=row['inicio'],
                fin=row.get('fin'),
                descripcion=row.get('descripcion', ''),
                color=row.get('color') or '#7c6fff',
            )

        return Response({'ok': True})


class MeDataDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    @transaction.atomic
    def delete(self, request):
        user = request.user
        _wipe_user_business_data(user)
        user.moneda = '$'
        user.nombre_display = 'Yo'
        user.google_api_key = ''
        user.google_client_id = ''
        user.gmail_account = ''
        user.google_connected = False
        user.save(
            update_fields=[
                'moneda',
                'nombre_display',
                'google_api_key',
                'google_client_id',
                'gmail_account',
                'google_connected',
            ]
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class GoogleOAuthExchangePlaceholderView(APIView):
    """Reservado para intercambio OAuth server-side (más seguro que solo gapi en el cliente)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        return Response(
            {
                'detail': (
                    'TODO: POST /api/integraciones/google/exchange/ — intercambio de código OAuth en el servidor. '
                    'Hoy la app usa Google API JS (gapi) en el navegador con credenciales guardadas vía /me/config/.'
                ),
            },
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )
