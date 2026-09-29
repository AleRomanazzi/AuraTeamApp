from collections import defaultdict
from decimal import Decimal

from django.db.models import Sum

from apps.core.utils import money
from apps.equipo.models import Liquidacion
from apps.finanzas.models import Transaccion

from .models import Cliente, Cobro

CERO = Decimal('0')


def rentabilidad_clientes(inicio, fin, periodo, cliente_ids=None) -> list[dict]:
    """Por cliente en el período: facturado, cobrado (ingresos), costo del equipo y otros egresos directos.
    Las liquidaciones del período cuentan como costo aunque no estén pagadas (criterio devengado);
    por eso se excluyen los egresos que ya provienen de una liquidación para no contarlos dos veces."""
    tx = Transaccion.objects.filter(fecha__gte=inicio, fecha__lte=fin, cliente__isnull=False)
    cobros = Cobro.objects.filter(periodo=periodo, cliente__isnull=False).exclude(estado='anulado')
    liqs = Liquidacion.objects.filter(periodo=periodo, cliente__isnull=False).exclude(estado='anulada')
    clientes = Cliente.objects.all()
    if cliente_ids is not None:
        tx = tx.filter(cliente_id__in=cliente_ids)
        cobros = cobros.filter(cliente_id__in=cliente_ids)
        liqs = liqs.filter(cliente_id__in=cliente_ids)
        clientes = clientes.filter(id__in=cliente_ids)

    data = defaultdict(lambda: defaultdict(lambda: CERO))
    for r in tx.filter(tipo='ingreso').values('cliente_id').annotate(t=Sum('monto')):
        data[r['cliente_id']]['ingresos'] = r['t'] or CERO
    for r in tx.filter(tipo='egreso', liquidacion__isnull=True).values('cliente_id').annotate(t=Sum('monto')):
        data[r['cliente_id']]['otros_egresos'] = r['t'] or CERO
    for r in cobros.values('cliente_id').annotate(t=Sum('monto')):
        data[r['cliente_id']]['facturado'] = r['t'] or CERO
    for r in liqs.values('cliente_id').annotate(t=Sum('total')):
        data[r['cliente_id']]['costo_equipo'] = r['t'] or CERO

    filas = []
    for c in clientes:
        if c.id not in data and c.estado != 'activo':
            continue
        d = data[c.id]
        costo = d['costo_equipo'] + d['otros_egresos']
        margen = d['ingresos'] - costo
        filas.append(
            {
                'cliente': c.id,
                'cliente_nombre': c.nombre,
                'color': c.color,
                'facturado': str(money(d['facturado'])),
                'ingresos': str(money(d['ingresos'])),
                'costo_equipo': str(money(d['costo_equipo'])),
                'otros_egresos': str(money(d['otros_egresos'])),
                'costo_total': str(money(costo)),
                'margen': str(money(margen)),
                'margen_pct': float(round(margen / d['ingresos'] * 100, 1)) if d['ingresos'] else None,
            }
        )
    filas.sort(key=lambda f: Decimal(f['margen']), reverse=True)
    return filas
