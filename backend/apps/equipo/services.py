from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.core.utils import today
from apps.finanzas.models import CATEGORIA_HONORARIOS, Categoria, Transaccion

from .models import Liquidacion


@transaction.atomic
def repartir_cobro(*, cliente, periodo, concepto, filas, pago=None, user=None) -> list[Liquidacion]:
    """Crea una liquidación manual por persona para el trabajo de un cliente en el período.
    Con `pago` (fecha, medio_pago, comprobante) quedan pagadas y se registra cada egreso."""
    liqs = []
    for fila in filas:
        liq = Liquidacion.objects.create(
            persona=fila['persona'], periodo=periodo, concepto=concepto[:200], cliente=cliente, origen='manual',
            monto_base=fila['monto'], total=fila['monto'],
        )
        if pago is not None:
            liq = pagar_liquidacion(liq, user=user, **pago)
        liqs.append(liq)
    return liqs


@transaction.atomic
def pagar_liquidacion(liq: Liquidacion, *, fecha=None, medio_pago='', comprobante='', user=None) -> Liquidacion:
    liq = Liquidacion.objects.select_for_update().select_related('persona', 'cliente').get(pk=liq.pk)
    if liq.estado == 'pagada':
        raise ValidationError({'detail': 'La liquidación ya está pagada.'})
    if liq.estado == 'anulada':
        raise ValidationError({'detail': 'La liquidación está anulada.'})
    liq.recalcular(save=False)
    if liq.total <= 0:
        raise ValidationError({'detail': 'El total a pagar debe ser mayor a 0.'})
    fecha = fecha or today()
    tx = Transaccion.objects.create(
        user=user,
        fecha=fecha,
        descripcion=f'Honorarios {liq.persona.nombre} — {liq.concepto} ({liq.periodo})'[:200],
        categoria=Categoria.por_nombre(CATEGORIA_HONORARIOS, 'egreso'),
        tipo='egreso',
        monto=liq.total,
        persona=liq.persona,
        cliente=liq.cliente,
        medio_pago=medio_pago,
        comprobante=comprobante,
    )
    liq.transaccion = tx
    liq.estado = 'pagada'
    liq.fecha_pago = fecha
    liq.medio_pago = medio_pago
    liq.comprobante = comprobante
    liq.save()
    return liq


@transaction.atomic
def revertir_liquidacion(liq: Liquidacion) -> Liquidacion:
    liq = Liquidacion.objects.select_for_update().get(pk=liq.pk)
    if liq.estado != 'pagada':
        raise ValidationError({'detail': 'Solo se puede revertir una liquidación pagada.'})
    tx = liq.transaccion
    liq.transaccion = None
    liq.estado = 'aprobada'
    liq.fecha_pago = None
    liq.save()
    if tx is not None:
        tx.delete()
    return liq
