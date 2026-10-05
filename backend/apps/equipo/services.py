from calendar import monthrange
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q
from rest_framework.exceptions import ValidationError

from apps.core.utils import today
from apps.finanzas.models import CATEGORIA_HONORARIOS, Categoria, Transaccion

from .models import AsignacionTarea, Liquidacion, Tarea, TareaRecurrente

# Las recurrentes cubren hasta fin del mes en que cae hoy + DIAS_RECURRENTES (así el mes siguiente queda armado desde
# su última semana). Notion y Google las reciben de a tandas en las siguientes sincronizaciones.
DIAS_RECURRENTES = 7


def fin_de_generacion(hoy):
    limite = hoy + timedelta(days=DIAS_RECURRENTES)
    return date(limite.year, limite.month, monthrange(limite.year, limite.month)[1])


def generar_recurrentes() -> int:
    """Crea las tareas de las plantillas activas hasta `fin_de_generacion`. Devuelve cuántas creó."""
    hoy = today()
    hasta = fin_de_generacion(hoy)
    pendientes = TareaRecurrente.objects.filter(activa=True).filter(Q(generada_hasta__isnull=True) | Q(generada_hasta__lt=hasta))
    creadas = 0
    nuevas = []
    for pk in pendientes.values_list('pk', flat=True):
        with transaction.atomic():
            p = TareaRecurrente.objects.select_for_update(of=('self',)).filter(pk=pk, activa=True).order_by().first()
            if p is None or (p.generada_hasta and p.generada_hasta >= hasta):
                continue
            personas = list(p.personas.all())
            dia = max(p.generada_hasta + timedelta(days=1), hoy) if p.generada_hasta else hoy
            while dia <= hasta:
                if dia.weekday() in p.dias:
                    for i in range(1, p.por_dia + 1):
                        tarea = Tarea.objects.create(
                            titulo=f'{p.titulo} {i}/{p.por_dia}' if p.por_dia > 1 else p.titulo,
                            descripcion=p.descripcion, cliente_id=p.cliente_id, prioridad=p.prioridad,
                            etiqueta=p.etiqueta, fecha_limite=dia, recurrente=p,
                        )
                        AsignacionTarea.objects.bulk_create([AsignacionTarea(persona=x, tarea=tarea) for x in personas])
                        nuevas.append(tarea)
                        creadas += 1
                dia += timedelta(days=1)
            TareaRecurrente.objects.filter(pk=p.pk).update(generada_hasta=hasta)
    if nuevas:
        from apps.notificaciones.services import asignadas_en_tanda

        asignadas_en_tanda(nuevas, 'recurrentes')
    return creadas


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
    # Postgres no permite FOR UPDATE sobre el lado nullable de un LEFT JOIN (cliente).
    liq = Liquidacion.objects.select_for_update(of=('self',)).select_related('persona', 'cliente').get(pk=liq.pk)
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
