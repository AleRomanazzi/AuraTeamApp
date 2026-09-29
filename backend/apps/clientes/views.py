import re
from decimal import Decimal, InvalidOperation

from django.db.models import DecimalField, ExpressionWrapper, F, ProtectedError, Q, Sum
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.csv_utils import csv_response, monto_es
from apps.core.permissions import IsAdmin, IsAdminOrReadOnly, es_admin
from apps.core.utils import add_months, mes_label, money, parse_mes, today

from . import services
from .models import Cliente, Cobro, Contrato
from .reportes import rentabilidad_clientes
from .serializers import (
    AjusteInputSerializer,
    AjustePrecioSerializer,
    ClienteBasicoSerializer,
    ClienteSerializer,
    CobroSerializer,
    ContratoSerializer,
    RegistrarPagoSerializer,
)

ABIERTOS = ('pendiente', 'parcial')
SALDO = ExpressionWrapper(F('cobros__monto') - F('cobros__monto_cobrado'), output_field=DecimalField(max_digits=14, decimal_places=2))


def _num(v):
    if isinstance(v, (int, float)):
        return float(v)
    if not isinstance(v, str):
        return None
    s = v.strip().lower().replace(' ', '')
    mult = 1
    if s.endswith('k'):
        mult, s = 1_000, s[:-1]
    elif s.endswith('m'):
        mult, s = 1_000_000, s[:-1]
    s = re.sub(r'[^\d,.\-]', '', s)
    if ',' in s and '.' in s:
        dec = ',' if s.rfind(',') > s.rfind('.') else '.'
        mil = '.' if dec == ',' else ','
        s = s.replace(mil, '').replace(dec, '.')
    else:
        for sep in (',', '.'):
            if sep in s:
                partes = s.split(sep)
                if len(partes) == 2 and len(partes[1]) != 3:
                    s = s.replace(sep, '.')
                else:
                    s = s.replace(sep, '')
    try:
        return float(Decimal(s)) * mult
    except (InvalidOperation, ValueError):
        return None


class ClienteViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAdminOrReadOnly]
    pagination_class = None

    def get_serializer_class(self):
        return ClienteSerializer if es_admin(self.request.user) else ClienteBasicoSerializer

    def get_queryset(self):
        qs = Cliente.objects.all()
        p = self.request.query_params
        if p.get('estado'):
            qs = qs.filter(estado=p['estado'])
        if p.get('q'):
            q = p['q'].strip()
            qs = qs.filter(Q(nombre__icontains=q) | Q(razon_social__icontains=q) | Q(rubro__icontains=q))
        if not es_admin(self.request.user):
            return qs
        hoy = today()
        return qs.annotate(
            deuda_total=Sum(SALDO, filter=Q(cobros__estado__in=ABIERTOS)),
            deuda_vencida_total=Sum(SALDO, filter=Q(cobros__estado__in=ABIERTOS, cobros__vencimiento__lt=hoy)),
        ).prefetch_related('contratos__ajustes', 'asignaciones__persona')

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def destroy(self, request, *args, **kwargs):
        cliente = self.get_object()
        try:
            cliente.delete()
        except ProtectedError:
            return Response(
                {'detail': 'El cliente tiene cobros registrados. Marcalo como «Baja» para conservar el historial.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], permission_classes=[IsAdmin])
    def rentabilidad(self, request, pk=None):
        cliente = self.get_object()
        try:
            meses = max(1, min(24, int(request.query_params.get('meses', 6))))
        except ValueError:
            meses = 6
        inicio_actual, _, _ = parse_mes(request.query_params.get('hasta'), param='hasta')
        serie = []
        for i in range(meses - 1, -1, -1):
            y, m = add_months(inicio_actual.year, inicio_actual.month, -i)
            ini, fin, periodo = parse_mes(f'{y:04d}-{m:02d}')
            fila = rentabilidad_clientes(ini, fin, periodo, [cliente.id])
            base = fila[0] if fila else {k: '0.00' for k in ('facturado', 'ingresos', 'costo_equipo', 'otros_egresos', 'costo_total', 'margen')}
            serie.append({**base, 'periodo': periodo, 'label': mes_label(y, m)})
        return Response({'cliente': cliente.id, 'serie': serie})

    @action(detail=True, methods=['get'], permission_classes=[IsAdmin])
    def reporte(self, request, pk=None):
        from apps.calendario.models import EventoUnico
        from apps.equipo.models import Tarea
        from apps.stats.models import AnalisisStats
        from apps.stats.serializers import AnalisisStatsSerializer

        cliente = self.get_object()
        inicio, fin, periodo = parse_mes(request.query_params.get('mes'))
        rent = rentabilidad_clientes(inicio, fin, periodo, [cliente.id])
        cobros = Cobro.objects.filter(cliente=cliente, periodo=periodo).select_related('contrato')
        deuda = (
            Cobro.objects.filter(cliente=cliente, estado__in=ABIERTOS)
            .aggregate(t=Sum(F('monto') - F('monto_cobrado')))['t']
            or Decimal('0')
        )
        hechas = Tarea.objects.filter(cliente=cliente, estado='hecha', completada_en__date__gte=inicio, completada_en__date__lte=fin)
        pendientes = Tarea.objects.filter(cliente=cliente).exclude(estado='hecha')
        analisis = AnalisisStats.objects.filter(cliente=cliente, estado='listo').filter(
            Q(periodo_hasta__gte=inicio, periodo_hasta__lte=fin)
            | Q(periodo_hasta__isnull=True, creado__date__gte=inicio, creado__date__lte=fin)
        ).prefetch_related('imagenes')
        eventos = EventoUnico.objects.filter(cliente=cliente, inicio__date__gte=inicio, inicio__date__lte=fin)
        return Response(
            {
                'periodo': periodo,
                'cliente': ClienteSerializer(
                    self.get_queryset().get(pk=cliente.pk), context=self.get_serializer_context()
                ).data,
                'rentabilidad': rent[0] if rent else None,
                'cobros': CobroSerializer(cobros, many=True).data,
                'deuda_total': str(money(deuda)),
                'tareas_hechas': [{'id': t.id, 'titulo': t.titulo, 'completada_en': t.completada_en} for t in hechas],
                'tareas_pendientes': [
                    {'id': t.id, 'titulo': t.titulo, 'estado': t.estado, 'fecha_limite': t.fecha_limite} for t in pendientes
                ],
                'analisis': AnalisisStatsSerializer(analisis, many=True, context=self.get_serializer_context()).data,
                'eventos': [{'id': e.id, 'titulo': e.nombre, 'inicio': e.inicio} for e in eventos],
            }
        )

    @action(detail=True, methods=['get'], permission_classes=[IsAdmin])
    def evolucion(self, request, pk=None):
        from apps.stats.models import AnalisisStats

        cliente = self.get_object()
        qs = AnalisisStats.objects.filter(cliente=cliente, estado='listo').order_by('periodo_hasta', 'creado')
        plataforma = request.query_params.get('plataforma')
        if plataforma:
            qs = qs.filter(plataforma=plataforma)
        series: dict[str, list] = {}
        puntos = []
        for a in qs:
            fecha = a.periodo_hasta or a.creado.date()
            puntos.append({'id': a.id, 'fecha': fecha, 'plataforma': a.plataforma})
            for met in a.metricas or []:
                if not isinstance(met, dict) or not met.get('nombre'):
                    continue
                valor = _num(met.get('despues'))
                if valor is None:
                    continue
                series.setdefault(str(met['nombre']).strip(), []).append({'fecha': fecha, 'valor': valor, 'analisis': a.id})
        return Response({'analisis': puntos, 'series': series})


class ContratoViewSet(viewsets.ModelViewSet):
    serializer_class = ContratoSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_queryset(self):
        qs = Contrato.objects.select_related('cliente', 'categoria', 'responsable').prefetch_related('ajustes')
        p = self.request.query_params
        if p.get('cliente'):
            qs = qs.filter(cliente_id=p['cliente'])
        if p.get('activo') in ('1', 'true'):
            qs = qs.filter(activo=True)
        return qs

    @action(detail=True, methods=['post'])
    def ajustar(self, request, pk=None):
        contrato = self.get_object()
        s = AjusteInputSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        ajuste = services.aplicar_ajuste(contrato, **s.validated_data)
        contrato.refresh_from_db()
        return Response(
            {'ajuste': AjustePrecioSerializer(ajuste).data, 'contrato': ContratoSerializer(contrato).data},
            status=status.HTTP_201_CREATED,
        )


class CobroViewSet(viewsets.ModelViewSet):
    serializer_class = CobroSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = Cobro.objects.select_related('cliente', 'contrato')
        p = self.request.query_params
        periodo = p.get('periodo') or p.get('mes')
        if periodo:
            _, _, periodo = parse_mes(periodo)
            qs = qs.filter(periodo=periodo)
        if p.get('cliente'):
            qs = qs.filter(cliente_id=p['cliente'])
        estado = p.get('estado')
        if estado == 'vencido':
            qs = qs.filter(estado__in=ABIERTOS, vencimiento__lt=today())
        elif estado == 'abierto':
            qs = qs.filter(estado__in=ABIERTOS)
        elif estado:
            qs = qs.filter(estado=estado)
        return qs

    def destroy(self, request, *args, **kwargs):
        cobro = self.get_object()
        if cobro.monto_cobrado > 0:
            return Response({'detail': 'Revertí el pago antes de borrar el cobro.'}, status=status.HTTP_400_BAD_REQUEST)
        cobro.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['post'])
    def generar(self, request):
        return Response(services.generar_cobros(request.data.get('mes') or request.query_params.get('mes'), request.user))

    @action(detail=True, methods=['post'], url_path='registrar-pago')
    def registrar_pago(self, request, pk=None):
        s = RegistrarPagoSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        cobro = services.registrar_pago(self.get_object(), user=request.user, **s.validated_data)
        return Response(CobroSerializer(cobro).data)

    @action(detail=True, methods=['post'], url_path='revertir-pago')
    def revertir_pago(self, request, pk=None):
        return Response(CobroSerializer(services.revertir_pago(self.get_object())).data)

    @action(detail=True, methods=['post'])
    def anular(self, request, pk=None):
        return Response(CobroSerializer(services.anular_cobro(self.get_object())).data)

    @action(detail=False, methods=['get'])
    def resumen(self, request):
        qs = self.get_queryset().exclude(estado='anulado')
        agg = qs.aggregate(facturado=Sum('monto'), cobrado=Sum('monto_cobrado'))
        facturado = agg['facturado'] or Decimal('0')
        cobrado = agg['cobrado'] or Decimal('0')
        vencido = (
            qs.filter(estado__in=ABIERTOS, vencimiento__lt=today()).aggregate(t=Sum(F('monto') - F('monto_cobrado')))['t']
            or Decimal('0')
        )
        return Response(
            {
                'facturado': str(money(facturado)),
                'cobrado': str(money(cobrado)),
                'pendiente': str(money(facturado - cobrado)),
                'vencido': str(money(vencido)),
                'cantidad': qs.count(),
            }
        )

    @action(detail=False, methods=['get'], url_path='export.csv')
    def export_csv(self, request):
        rows = (
            [
                c.periodo, c.cliente.nombre, c.concepto, c.vencimiento.isoformat(), monto_es(c.monto),
                monto_es(c.monto_cobrado), monto_es(c.saldo), c.get_estado_display(),
                c.fecha_pago.isoformat() if c.fecha_pago else '', c.get_medio_pago_display() if c.medio_pago else '',
                c.comprobante,
            ]
            for c in self.get_queryset()
        )
        return csv_response(
            'cobros.csv',
            ['Período', 'Cliente', 'Concepto', 'Vencimiento', 'Monto', 'Cobrado', 'Saldo', 'Estado', 'Fecha de pago', 'Medio', 'Comprobante'],
            rows,
        )


class RentabilidadView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        inicio, fin, periodo = parse_mes(request.query_params.get('mes'))
        filas = rentabilidad_clientes(inicio, fin, periodo)
        tot = {k: sum((Decimal(f[k]) for f in filas), Decimal('0')) for k in ('facturado', 'ingresos', 'costo_total', 'margen')}
        return Response({'periodo': periodo, 'clientes': filas, 'totales': {k: str(money(v)) for k, v in tot.items()}})
