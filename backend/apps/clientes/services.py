from decimal import Decimal

from django.db import transaction
from rest_framework.exceptions import ValidationError

from apps.core.utils import aplica_en_mes, fecha_en_mes, money, parse_mes, today
from apps.finanzas.models import CATEGORIA_FEE, Categoria, Transaccion

from .models import AjustePrecio, Cobro, Contrato


def generar_cobros(mes: str, user=None) -> dict:
    """Crea los cobros del mes para cada contrato activo que corresponda. Es idempotente."""
    inicio, fin, periodo = parse_mes(mes, required=True)
    contratos = (
        Contrato.objects.filter(activo=True, cliente__estado='activo', fecha_inicio__lte=fin)
        .select_related('cliente')
        .prefetch_related('ajustes')
    )
    existentes = set(Cobro.objects.filter(periodo=periodo, contrato__isnull=False).values_list('contrato_id', flat=True))
    creados = []
    for c in contratos:
        if c.id in existentes:
            continue
        if c.fecha_fin and c.fecha_fin < inicio:
            continue
        if not aplica_en_mes(c.fecha_inicio, c.periodicidad, inicio.year, inicio.month):
            continue
        creados.append(
            Cobro(
                cliente=c.cliente,
                contrato=c,
                periodo=periodo,
                concepto=c.concepto,
                monto=c.monto_para(inicio, list(c.ajustes.all())),
                vencimiento=fecha_en_mes(inicio.year, inicio.month, c.dia_vencimiento),
            )
        )
    Cobro.objects.bulk_create(creados)
    return {'periodo': periodo, 'creados': len(creados), 'existentes': len(existentes)}


def _estado_por_monto(cobro: Cobro) -> str:
    if cobro.monto_cobrado <= 0:
        return 'pendiente'
    if cobro.monto_cobrado >= cobro.monto:
        return 'pagado'
    return 'parcial'


@transaction.atomic
def registrar_pago(cobro: Cobro, *, monto=None, fecha=None, medio_pago='', comprobante='', notas='', user=None) -> Cobro:
    # Postgres no permite FOR UPDATE sobre el lado nullable de un LEFT JOIN (contrato).
    cobro = Cobro.objects.select_for_update(of=('self',)).select_related('cliente', 'contrato').get(pk=cobro.pk)
    if cobro.estado == 'anulado':
        raise ValidationError({'detail': 'El cobro está anulado.'})
    saldo = cobro.saldo
    if saldo <= 0:
        raise ValidationError({'detail': 'El cobro ya está pagado.'})
    monto = money(monto) if monto not in (None, '') else saldo
    if monto <= 0:
        raise ValidationError({'monto': 'El monto debe ser mayor a 0.'})
    if monto > saldo:
        raise ValidationError({'monto': f'El monto supera el saldo pendiente ({saldo}).'})
    fecha = fecha or today()

    cobro.monto_cobrado = money(cobro.monto_cobrado + monto)
    cobro.fecha_pago = fecha
    if medio_pago:
        cobro.medio_pago = medio_pago
    if comprobante:
        cobro.comprobante = comprobante
    if notas:
        cobro.notas = (cobro.notas + '\n' + notas).strip() if cobro.notas else notas
    cobro.estado = _estado_por_monto(cobro)

    categoria = (cobro.contrato.categoria if cobro.contrato and cobro.contrato.categoria_id else None) or Categoria.por_nombre(
        CATEGORIA_FEE, 'ingreso'
    )
    descripcion = f'{cobro.concepto} — {cobro.cliente.nombre} ({cobro.periodo})'[:200]
    tx = cobro.transaccion
    if tx is None:
        tx = Transaccion.objects.create(
            user=user,
            fecha=fecha,
            descripcion=descripcion,
            categoria=categoria,
            tipo='ingreso',
            monto=cobro.monto_cobrado,
            cliente=cobro.cliente,
            medio_pago=cobro.medio_pago,
            comprobante=cobro.comprobante,
        )
        cobro.transaccion = tx
    else:
        tx.fecha = fecha
        tx.monto = cobro.monto_cobrado
        tx.medio_pago = cobro.medio_pago
        tx.comprobante = cobro.comprobante
        tx.save(update_fields=['fecha', 'monto', 'medio_pago', 'comprobante'])
    cobro.save()
    return cobro


@transaction.atomic
def revertir_pago(cobro: Cobro) -> Cobro:
    cobro = Cobro.objects.select_for_update().get(pk=cobro.pk)
    tx = cobro.transaccion
    cobro.transaccion = None
    cobro.monto_cobrado = Decimal('0')
    cobro.fecha_pago = None
    cobro.estado = 'pendiente'
    cobro.save()
    if tx is not None:
        tx.delete()
    return cobro


def anular_cobro(cobro: Cobro) -> Cobro:
    if cobro.monto_cobrado > 0:
        raise ValidationError({'detail': 'Revertí el pago antes de anular el cobro.'})
    cobro.estado = 'anulado'
    cobro.save(update_fields=['estado'])
    return cobro


@transaction.atomic
def aplicar_ajuste(contrato: Contrato, *, fecha_desde, monto_nuevo=None, porcentaje=None, nota='', actualizar_pendientes=True):
    """Registra un aumento/ajuste de precio. Acepta monto nuevo o porcentaje."""
    anterior = contrato.monto_para(fecha_desde)
    if monto_nuevo in (None, ''):
        if porcentaje in (None, ''):
            raise ValidationError({'detail': 'Indicá el monto nuevo o el porcentaje.'})
        porcentaje = Decimal(str(porcentaje))
        monto_nuevo = money(anterior * (Decimal('1') + porcentaje / Decimal('100')))
    else:
        monto_nuevo = money(monto_nuevo)
        porcentaje = money((monto_nuevo / anterior - 1) * 100) if anterior else None
    if monto_nuevo <= 0:
        raise ValidationError({'monto_nuevo': 'El monto nuevo debe ser mayor a 0.'})

    ajuste = AjustePrecio.objects.create(
        contrato=contrato,
        fecha_desde=fecha_desde,
        monto_anterior=anterior,
        monto_nuevo=monto_nuevo,
        porcentaje=porcentaje,
        nota=nota,
    )
    if fecha_desde <= today():
        contrato.monto = monto_nuevo
        contrato.save(update_fields=['monto'])
    if actualizar_pendientes:
        periodo_desde = f'{fecha_desde.year:04d}-{fecha_desde.month:02d}'
        Cobro.objects.filter(
            contrato=contrato, periodo__gte=periodo_desde, estado='pendiente', monto_cobrado=0
        ).update(monto=monto_nuevo)
    return ajuste
