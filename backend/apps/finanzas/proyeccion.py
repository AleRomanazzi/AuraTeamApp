"""Flujo de caja proyectado: lo que se espera cobrar y pagar mes a mes, desde el mes en curso.

Ingresos: cobros del período (cobrado y saldo), contratos cuyo cobro todavía no se generó y, en el mes en curso, la
deuda vencida de meses anteriores. Egresos: suscripciones (pagadas y por pagar), pagos al equipo (registrados o, si
faltan, el promedio de los últimos meses) y el resto de los gastos (promedio de los últimos meses).
"""

from decimal import Decimal

from django.db.models import Sum

from apps.core.utils import add_months, money, parse_mes

MESES_PROMEDIO = 3


def _suma(qs, campo='monto') -> Decimal:
    return money(qs.aggregate(t=Sum(campo))['t'] or 0)


def _periodo(y, m) -> str:
    return f'{y:04d}-{m:02d}'


def _promedio(valores) -> Decimal:
    return money(sum(valores, Decimal('0')) / len(valores)) if valores else Decimal('0')


def _otros_egresos(qs):
    """Egresos que no son suscripciones ni pagos al equipo (esos se cuentan aparte)."""
    return qs.filter(tipo='egreso', pago_servicio__isnull=True, liquidacion__isnull=True)


def proyectar(hoy, meses=3) -> dict:
    from apps.clientes.models import Cobro
    from apps.clientes.services import contratos_del_mes
    from apps.equipo.models import Liquidacion
    from apps.servicios.models import PagoServicio, Servicio
    from apps.servicios.services import aplica_servicio_en_mes

    from .models import Transaccion

    # Promedios de los meses completos anteriores.
    anteriores = [_periodo(*add_months(hoy.year, hoy.month, -i)) for i in range(1, MESES_PROMEDIO + 1)]
    equipo_prom = _promedio([_suma(Liquidacion.objects.filter(periodo=p, estado='pagada'), 'total') for p in anteriores])
    otros_prom = _promedio([
        _suma(_otros_egresos(Transaccion.objects.filter(fecha__gte=parse_mes(p)[0], fecha__lte=parse_mes(p)[1])))
        for p in anteriores
    ])

    filas, acumulado = [], Decimal('0')
    for i in range(meses):
        y, m = add_months(hoy.year, hoy.month, i)
        inicio, fin, periodo = parse_mes(_periodo(y, m))
        actual = i == 0

        cobros = Cobro.objects.filter(periodo=periodo).exclude(estado='anulado')
        cobrado = _suma(cobros, 'monto_cobrado')
        a_cobrar = money(sum((c.saldo for c in cobros.filter(estado__in=('pendiente', 'parcial'))), Decimal('0')))
        sin_generar = money(sum((monto for _c, monto in contratos_del_mes(inicio, fin)), Decimal('0')))
        atrasado = Decimal('0')
        otros_ingresos = Decimal('0')
        if actual:
            viejos = Cobro.objects.filter(periodo__lt=periodo, estado__in=('pendiente', 'parcial'))
            atrasado = money(sum((c.saldo for c in viejos), Decimal('0')))
            otros_ingresos = _suma(
                Transaccion.objects.filter(tipo='ingreso', fecha__gte=inicio, fecha__lte=fin, cobro__isnull=True)
            )
        ingresos = money(cobrado + a_cobrar + sin_generar + atrasado + otros_ingresos)

        pagos = PagoServicio.objects.filter(periodo=periodo)
        subs_pagadas = _suma(pagos, 'transaccion__monto')
        ya = set(pagos.values_list('servicio_id', flat=True))
        subs_pendientes = money(sum(
            (s.monto_agencia for s in Servicio.objects.filter(activo=True, generar_egreso=True)
             if s.id not in ya and aplica_servicio_en_mes(s, y, m)),
            Decimal('0'),
        ))

        liqs = Liquidacion.objects.filter(periodo=periodo).exclude(estado='anulada')
        equipo_pagado = _suma(liqs.filter(estado='pagada'), 'total')
        equipo_a_pagar = _suma(liqs.filter(estado__in=('pendiente', 'aprobada')), 'total')
        if actual:
            equipo_a_pagar += _suma(Liquidacion.objects.filter(periodo__lt=periodo, estado__in=('pendiente', 'aprobada')), 'total')
        # Los repartos son manuales: hasta que se carguen, se estima con el promedio.
        equipo_estimado = max(equipo_prom - equipo_pagado - equipo_a_pagar, Decimal('0'))

        otros_gastado = _suma(_otros_egresos(Transaccion.objects.filter(fecha__gte=inicio, fecha__lte=fin))) if actual else Decimal('0')
        otros_estimado = max(otros_prom - otros_gastado, Decimal('0'))

        egresos = money(subs_pagadas + subs_pendientes + equipo_pagado + equipo_a_pagar + equipo_estimado + otros_gastado + otros_estimado)
        neto = money(ingresos - egresos)
        acumulado = money(acumulado + neto)
        filas.append({
            'periodo': periodo,
            'ingresos': {
                'cobrado': str(cobrado), 'a_cobrar': str(a_cobrar), 'sin_generar': str(sin_generar), 'atrasado': str(atrasado),
                'otros': str(otros_ingresos), 'total': str(ingresos),
            },
            'egresos': {
                'suscripciones_pagadas': str(subs_pagadas), 'suscripciones_pendientes': str(subs_pendientes),
                'equipo_pagado': str(equipo_pagado), 'equipo_a_pagar': str(equipo_a_pagar), 'equipo_estimado': str(equipo_estimado),
                'otros_gastado': str(otros_gastado), 'otros_estimado': str(otros_estimado), 'total': str(egresos),
            },
            'neto': str(neto),
            'acumulado': str(acumulado),
        })
    return {
        'meses': filas,
        'promedios': {'meses': MESES_PROMEDIO, 'equipo': str(equipo_prom), 'otros_egresos': str(otros_prom)},
    }
