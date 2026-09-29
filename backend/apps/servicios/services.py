from django.db import transaction

from apps.core.utils import aplica_en_mes, fecha_en_mes, parse_mes
from apps.finanzas.models import CATEGORIA_SOFTWARE, Categoria, Transaccion

from .models import PagoServicio, Servicio


def aplica_servicio_en_mes(s: Servicio, y: int, m: int) -> bool:
    if s.periodicidad == 'mensual' or not s.fecha_pago:
        return True
    return aplica_en_mes(s.fecha_pago, s.periodicidad, y, m)


@transaction.atomic
def generar_egresos(mes: str, user=None) -> dict:
    """Registra el egreso del mes de cada suscripción activa que corresponda. Idempotente."""
    inicio, _fin, periodo = parse_mes(mes, required=True)
    ya = set(PagoServicio.objects.filter(periodo=periodo).values_list('servicio_id', flat=True))
    creados = 0
    for s in Servicio.objects.filter(activo=True, generar_egreso=True).select_related('categoria'):
        if s.id in ya or not aplica_servicio_en_mes(s, inicio.year, inicio.month):
            continue
        monto = s.monto_agencia
        if not monto or monto <= 0:
            continue
        tx = Transaccion.objects.create(
            user=user,
            fecha=fecha_en_mes(inicio.year, inicio.month, s.dia_vencimiento),
            descripcion=f'{s.nombre} ({periodo})'[:200],
            categoria=s.categoria or Categoria.por_nombre(CATEGORIA_SOFTWARE, 'egreso'),
            tipo='egreso',
            monto=monto,
        )
        PagoServicio.objects.create(servicio=s, periodo=periodo, transaccion=tx)
        creados += 1
    return {'periodo': periodo, 'creados': creados, 'existentes': len(ya)}
