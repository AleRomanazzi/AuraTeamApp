from datetime import timedelta
from decimal import Decimal

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, models, transaction
from django.db.models import F, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.serializers import MeSerializer
from apps.calendario.models import EventoUnico
from apps.clientes.models import AjustePrecio, Cliente, Cobro, Contrato
from apps.clientes.reportes import rentabilidad_clientes
from apps.clientes.serializers import fee_mensual_de
from apps.core.permissions import IsAdmin
from apps.core.utils import add_months, equivalente_mensual, fecha_en_mes, mes_label, money, parse_mes, today
from apps.equipo.models import AsignacionCliente, AsignacionTarea, Liquidacion, LiquidacionItem, Persona, Tarea
from apps.finanzas.models import CATEGORIA_FEE, Categoria, Transaccion
from apps.finanzas.serializers import TransaccionSerializer
from apps.servicios.models import PagoServicio, Servicio
from apps.servicios.services import aplica_servicio_en_mes
from apps.stats.models import AnalisisStats

from .serializers import UserConfigSerializer

CERO = Decimal('0')
ABIERTOS = ('pendiente', 'parcial')


def _s(v) -> str:
    return str(money(v or 0))


def _variacion(actual: Decimal, anterior: Decimal):
    if not anterior:
        return None
    return float(round((actual - anterior) / abs(anterior) * 100, 1))


class DashboardView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        inicio, fin, periodo = parse_mes(request.query_params.get('mes'))
        hoy = today()

        y0, m0 = add_months(inicio.year, inicio.month, -5)
        desde_serie = inicio.replace(year=y0, month=m0)
        por_mes = {
            (r['mes'].year, r['mes'].month): r
            for r in Transaccion.objects.filter(fecha__gte=desde_serie, fecha__lte=fin)
            .annotate(mes=TruncMonth('fecha'))
            .values('mes')
            .annotate(
                ingreso=Coalesce(Sum('monto', filter=Q(tipo='ingreso')), CERO),
                egreso=Coalesce(Sum('monto', filter=Q(tipo='egreso')), CERO),
            )
        }
        serie = []
        for i in range(5, -1, -1):
            y, m = add_months(inicio.year, inicio.month, -i)
            r = por_mes.get((y, m), {'ingreso': CERO, 'egreso': CERO})
            serie.append(
                {
                    'mes': f'{y:04d}-{m:02d}',
                    'label': mes_label(y, m),
                    'ingreso': _s(r['ingreso']),
                    'egreso': _s(r['egreso']),
                    'balance': _s(r['ingreso'] - r['egreso']),
                }
            )
        ing = Decimal(serie[-1]['ingreso'])
        eg = Decimal(serie[-1]['egreso'])
        ing_prev = Decimal(serie[-2]['ingreso'])
        eg_prev = Decimal(serie[-2]['egreso'])

        clientes_activos = Cliente.objects.filter(estado='activo').prefetch_related('contratos__ajustes')
        mrr = sum((fee_mensual_de(c) for c in clientes_activos), CERO)

        cobros_mes = Cobro.objects.filter(periodo=periodo).exclude(estado='anulado')
        agg = cobros_mes.aggregate(f=Coalesce(Sum('monto'), CERO), c=Coalesce(Sum('monto_cobrado'), CERO))
        facturado, cobrado = agg['f'], agg['c']

        vencidos = Cobro.objects.filter(estado__in=ABIERTOS, vencimiento__lt=hoy)
        deuda_vencida = vencidos.aggregate(t=Coalesce(Sum(F('monto') - F('monto_cobrado')), CERO))['t']
        deudores = (
            vencidos.values('cliente_id', 'cliente__nombre', 'cliente__whatsapp')
            .annotate(deuda=Sum(F('monto') - F('monto_cobrado')), desde=models.Min('vencimiento'), cobros=models.Count('id'))
            .order_by('-deuda')[:5]
        )

        liq_abiertas = Liquidacion.objects.filter(estado__in=('pendiente', 'aprobada'))
        equipo_pendiente = liq_abiertas.aggregate(t=Coalesce(Sum('total'), CERO))['t']
        equipo_mes = Liquidacion.objects.filter(periodo=periodo).exclude(estado='anulada').aggregate(t=Coalesce(Sum('total'), CERO))['t']

        servicios = list(Servicio.objects.filter(activo=True).prefetch_related('pagos'))
        suscripciones_mensual = sum((equivalente_mensual(s.monto_agencia, s.periodicidad) for s in servicios), CERO)

        limite = hoy + timedelta(days=15)
        proximos = [
            {
                'tipo': 'cobro', 'id': c.id, 'fecha': c.vencimiento, 'titulo': c.cliente.nombre, 'detalle': c.concepto,
                'monto': _s(c.saldo), 'vencido': c.vencimiento < hoy,
            }
            for c in Cobro.objects.filter(estado__in=ABIERTOS, vencimiento__lte=limite).select_related('cliente').order_by('vencimiento')[:12]
        ]
        for s in servicios:
            fecha = hoy.replace(day=1)
            for delta in (0, 1):
                yy, mm = add_months(fecha.year, fecha.month, delta)
                f = fecha_en_mes(yy, mm, s.dia_vencimiento)
                per = f'{yy:04d}-{mm:02d}'
                if hoy <= f <= limite and aplica_servicio_en_mes(s, yy, mm) and not any(p.periodo == per for p in s.pagos.all()):
                    proximos.append(
                        {'tipo': 'suscripcion', 'id': s.id, 'fecha': f, 'titulo': s.nombre, 'detalle': s.proveedor,
                         'monto': _s(s.monto_agencia), 'vencido': False}
                    )
        proximos.sort(key=lambda x: x['fecha'])

        rent = rentabilidad_clientes(inicio, fin, periodo)
        tareas_abiertas = Tarea.objects.exclude(estado='hecha')

        return Response(
            {
                'mes': periodo,
                'ingresos_mes': _s(ing),
                'egresos_mes': _s(eg),
                'balance': _s(ing - eg),
                'margen_pct': float(round((ing - eg) / ing * 100, 1)) if ing else None,
                'variacion': {
                    'ingresos': _variacion(ing, ing_prev),
                    'egresos': _variacion(eg, eg_prev),
                    'balance': _variacion(ing - eg, ing_prev - eg_prev),
                },
                'series_6_meses': serie,
                'mrr': _s(mrr),
                'clientes_activos': len(clientes_activos),
                'cobros_mes': {
                    'facturado': _s(facturado),
                    'cobrado': _s(cobrado),
                    'pendiente': _s(facturado - cobrado),
                    'pct_cobrado': float(round(cobrado / facturado * 100, 1)) if facturado else None,
                },
                'deuda_vencida': _s(deuda_vencida),
                'top_deudores': [
                    {
                        'cliente': d['cliente_id'], 'nombre': d['cliente__nombre'], 'whatsapp': d['cliente__whatsapp'],
                        'deuda': _s(d['deuda']), 'dias': (hoy - d['desde']).days, 'cobros': d['cobros'],
                    }
                    for d in deudores
                ],
                'equipo': {'pendiente_pago': _s(equipo_pendiente), 'costo_mes': _s(equipo_mes), 'liquidaciones_abiertas': liq_abiertas.count()},
                'suscripciones_mensual': _s(suscripciones_mensual),
                'servicios_proyectado_mes': _s(suscripciones_mensual),
                'rentabilidad': rent[:5],
                'rentabilidad_peor': [r for r in rent if Decimal(r['margen']) < 0][-3:],
                'proximos_vencimientos': proximos[:12],
                'tareas': {
                    'abiertas': tareas_abiertas.count(),
                    'vencidas': tareas_abiertas.filter(fecha_limite__lt=hoy).count(),
                },
                'ultimas_transacciones': TransaccionSerializer(
                    Transaccion.objects.select_related('categoria', 'cliente', 'persona').prefetch_related('adjuntos')[:5],
                    many=True,
                ).data,
            }
        )


class MiPanelView(APIView):
    """Resumen para cualquier usuario: sus tareas, sus pagos y próximos eventos."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.calendario.serializers import EventoUnicoSerializer
        from apps.calendario.views import eventos_visibles
        from apps.equipo.serializers import LiquidacionSerializer, TareaSerializer

        persona = request.user.persona
        hoy = today()
        tareas = Tarea.objects.none()
        liqs = Liquidacion.objects.none()
        if persona:
            tareas = (
                Tarea.objects.filter(asignaciones__persona=persona)
                .exclude(estado='hecha')
                .select_related('cliente')
                .prefetch_related('asignaciones__persona')
                .distinct()
            )
            liqs = Liquidacion.objects.filter(persona=persona).exclude(estado='anulada').prefetch_related('items').select_related('persona', 'cliente')[:12]
        eventos = eventos_visibles(request.user).filter(inicio__date__gte=hoy, inicio__date__lte=hoy + timedelta(days=14))
        return Response(
            {
                'persona': {'id': persona.id, 'nombre': persona.nombre} if persona else None,
                'tareas': TareaSerializer(tareas, many=True).data,
                'liquidaciones': LiquidacionSerializer(liqs, many=True).data,
                'eventos': EventoUnicoSerializer(eventos, many=True).data,
            }
        )


class MeConfigView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def put(self, request):
        ser = UserConfigSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(MeSerializer(request.user).data)


# --- Exportación / importación -------------------------------------------------------------

EXPORT_MODELOS = [
    ('categorias', Categoria),
    ('personas', Persona),
    ('clientes', Cliente),
    ('contratos', Contrato),
    ('ajustes', AjustePrecio),
    ('transacciones', Transaccion),
    ('cobros', Cobro),
    ('tareas', Tarea),
    ('asignaciones', AsignacionTarea),
    ('asignaciones_cliente', AsignacionCliente),
    ('liquidaciones', Liquidacion),
    ('liquidacion_items', LiquidacionItem),
    ('servicios', Servicio),
    ('pagos_servicio', PagoServicio),
    ('cal_eventos', EventoUnico),
]
OMITIR = {'user'}


def _campos_fk(model):
    return [
        f for f in model._meta.concrete_fields
        if isinstance(f, (models.ForeignKey, models.OneToOneField)) and f.name not in OMITIR
    ]


class MeExportView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        data = {'version': 2, 'exportado': today().isoformat(), 'config': UserConfigSerializer(request.user).data}
        for clave, model in EXPORT_MODELOS:
            omitir = {f'{n}_id' for n in OMITIR} | set(OMITIR)
            data[clave] = [{k: v for k, v in row.items() if k not in omitir} for row in model.objects.order_by('pk').values()]
        data['stats'] = list(
            AnalisisStats.objects.order_by('pk').values(
                'id', 'cliente_id', 'plataforma', 'periodo_desde', 'periodo_hasta', 'metricas', 'interpretacion', 'notas', 'creado'
            )
        )
        return Response(data)


def _wipe_datos_agencia():
    """Borra los datos operativos de la agencia. No toca usuarios, categorías ni estadísticas."""
    PagoServicio.objects.all().delete()
    Cobro.objects.all().delete()
    LiquidacionItem.objects.all().delete()
    Liquidacion.objects.all().delete()
    Transaccion.objects.all().delete()
    AjustePrecio.objects.all().delete()
    Contrato.objects.all().delete()
    AsignacionTarea.objects.all().delete()
    AsignacionCliente.objects.all().delete()
    Tarea.objects.all().delete()
    EventoUnico.objects.all().delete()
    Servicio.objects.all().delete()
    Cliente.objects.all().delete()
    Persona.objects.all().delete()


class Importador:
    def __init__(self, user):
        self.user = user
        self.maps: dict[type, dict[int, int]] = {}
        self.errores: list[dict] = []
        self.creados: dict[str, int] = {}

    def _crear(self, seccion, fila, model, campos):
        try:
            with transaction.atomic():
                obj = model(**campos)
                obj.full_clean(validate_unique=False, validate_constraints=False)
                obj.save()
        except (DjangoValidationError, IntegrityError, ValueError, TypeError) as e:
            msg = '; '.join(f'{k}: {", ".join(v)}' for k, v in e.message_dict.items()) if hasattr(e, 'message_dict') else str(e)
            self.errores.append({'seccion': seccion, 'fila': fila, 'error': msg[:300]})
            return None
        self.creados[seccion] = self.creados.get(seccion, 0) + 1
        return obj

    def importar_v2(self, body):
        cat_map = self.maps.setdefault(Categoria, {})
        for row in body.get('categorias') or []:
            cat, _ = Categoria.objects.get_or_create(
                nombre=row.get('nombre', '')[:60], tipo=row.get('tipo', 'egreso'),
                defaults={'color': row.get('color') or '#7c6fff', 'activa': row.get('activa', True), 'orden': row.get('orden') or 100},
            )
            if row.get('id') is not None:
                cat_map[int(row['id'])] = cat.pk

        for clave, model in EXPORT_MODELOS[1:]:
            fks = _campos_fk(model)
            valid = {f.attname for f in model._meta.concrete_fields} - {'id', 'user_id'}
            mapa = self.maps.setdefault(model, {})
            for i, row in enumerate(body.get(clave) or [], start=1):
                if not isinstance(row, dict):
                    self.errores.append({'seccion': clave, 'fila': i, 'error': 'Fila inválida.'})
                    continue
                campos = {k: v for k, v in row.items() if k in valid}
                faltante = False
                for f in fks:
                    old = row.get(f.attname)
                    if old is None:
                        continue
                    nuevo = self.maps.get(f.related_model, {}).get(int(old))
                    if nuevo is None:
                        if not f.null:
                            faltante = True
                            break
                        campos[f.attname] = None
                    else:
                        campos[f.attname] = nuevo
                if faltante:
                    self.errores.append({'seccion': clave, 'fila': i, 'error': 'Referencia a un registro inexistente.'})
                    continue
                if 'user_id' in {f.attname for f in model._meta.concrete_fields}:
                    campos['user_id'] = self.user.pk
                campos.pop('creado', None)
                obj = self._crear(clave, i, model, campos)
                if obj is not None and row.get('id') is not None:
                    mapa[int(row['id'])] = obj.pk

    def importar_v1(self, body):
        for i, row in enumerate(body.get('transacciones') or [], start=1):
            tipo = row.get('tipo') if row.get('tipo') in ('ingreso', 'egreso') else 'egreso'
            nombre = (row.get('categoria') or '').strip()[:60] or ('Otros ingresos' if tipo == 'ingreso' else 'Otros')
            cat, _ = Categoria.objects.get_or_create(nombre=nombre, tipo=tipo)
            self._crear('transacciones', i, Transaccion, {
                'user': self.user, 'fecha': row.get('fecha'), 'descripcion': (row.get('descripcion') or '')[:200] or '-',
                'categoria': cat, 'tipo': tipo, 'monto': row.get('monto'), 'notas': row.get('notas') or '',
            })
        metodos = {c[0] for c in Servicio._meta.get_field('metodo').choices}
        for i, row in enumerate(body.get('servicios') or [], start=1):
            self._crear('servicios', i, Servicio, {
                'user': self.user, 'nombre': (row.get('nombre') or '')[:120] or '-', 'monto_total': row.get('monto_total'),
                'metodo': row.get('metodo') if row.get('metodo') in metodos else 'sin_division',
                'detalle': row.get('detalle') if isinstance(row.get('detalle'), list) else [],
                'mi_parte': row.get('mi_parte') or 0, 'fecha_pago': row.get('fecha_pago') or None,
            })
        tareas, personas = {}, {}
        for i, row in enumerate(body.get('tareas') or [], start=1):
            t = self._crear('tareas', i, Tarea, {'user': self.user, 'titulo': (row.get('titulo') or '')[:200] or '-', 'descripcion': row.get('descripcion') or ''})
            if t and row.get('id') is not None:
                tareas[int(row['id'])] = t
        for i, row in enumerate(body.get('personas') or [], start=1):
            p = self._crear('personas', i, Persona, {
                'user': self.user, 'nombre': (row.get('nombre') or '')[:120] or '-', 'rol': row.get('rol') or '',
                'color': row.get('color') or '#7c6fff', 'contactos': row.get('contactos') or [], 'notas': row.get('notas') or '',
            })
            if p and row.get('id') is not None:
                personas[int(row['id'])] = p
        for a in body.get('asignaciones') or []:
            p, t = personas.get(int(a.get('persona_id', 0))), tareas.get(int(a.get('tarea_id', 0)))
            if p and t:
                AsignacionTarea.objects.get_or_create(persona=p, tarea=t)
        fee = Categoria.por_nombre(CATEGORIA_FEE, 'ingreso')
        for i, row in enumerate(body.get('cal_clientes') or [], start=1):
            c = self._crear('clientes', i, Cliente, {'user': self.user, 'nombre': (row.get('titulo') or row.get('nombre') or '')[:120] or '-', 'notas': row.get('descripcion') or ''})
            if c and row.get('monto'):
                self._crear('contratos', i, Contrato, {
                    'cliente': c, 'concepto': 'Fee mensual', 'categoria': fee, 'monto': row['monto'],
                    'dia_vencimiento': row.get('dia_mes') or 10, 'fecha_inicio': today().replace(day=1),
                })
        for i, row in enumerate(body.get('cal_eventos') or [], start=1):
            self._crear('cal_eventos', i, EventoUnico, {
                'user': self.user, 'nombre': (row.get('titulo') or row.get('nombre') or '')[:120] or '-',
                'inicio': row.get('inicio'), 'fin': row.get('fin'), 'descripcion': row.get('descripcion') or '',
                'color': row.get('color') or '#7c6fff',
            })


class MeImportView(APIView):
    permission_classes = [IsAdmin]

    @transaction.atomic
    def post(self, request):
        body = request.data
        version = body.get('version') if isinstance(body, dict) else None
        if version not in (1, 2):
            return Response({'detail': 'El archivo no es un respaldo válido del panel (falta "version").'}, status=status.HTTP_400_BAD_REQUEST)

        stats_cliente = dict(
            AnalisisStats.objects.filter(cliente__isnull=False).values_list('id', 'cliente__nombre')
        )
        usuarios_persona = dict(User.objects.filter(persona__isnull=False).values_list('id', 'persona__nombre'))

        _wipe_datos_agencia()
        cfg = body.get('config') or {}
        cfg.pop('moneda', None)
        cfg_ser = UserConfigSerializer(request.user, data=cfg, partial=True)
        if cfg_ser.is_valid():
            cfg_ser.save()

        imp = Importador(request.user)
        if version == 2:
            imp.importar_v2(body)
        else:
            imp.importar_v1(body)

        clientes_por_nombre = {c.nombre: c.pk for c in Cliente.objects.all()}
        for sid, nombre in stats_cliente.items():
            AnalisisStats.objects.filter(pk=sid).update(cliente_id=clientes_por_nombre.get(nombre))
        personas_por_nombre = {p.nombre: p.pk for p in Persona.objects.all()}
        for uid, nombre in usuarios_persona.items():
            pid = personas_por_nombre.get(nombre)
            if pid and not User.objects.filter(persona_id=pid).exists():
                User.objects.filter(pk=uid).update(persona_id=pid)

        return Response({'ok': True, 'creados': imp.creados, 'errores': imp.errores[:200], 'total_errores': len(imp.errores)})


class MeDataDeleteView(APIView):
    permission_classes = [IsAdmin]

    @transaction.atomic
    def delete(self, request):
        if request.data.get('confirmar') != 'BORRAR' and request.query_params.get('confirmar') != 'BORRAR':
            return Response({'detail': 'Confirmá escribiendo BORRAR.'}, status=status.HTTP_400_BAD_REQUEST)
        _wipe_datos_agencia()
        AnalisisStats.objects.all().delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
