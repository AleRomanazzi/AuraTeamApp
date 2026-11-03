from calendar import monthrange
from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.utils import today
from apps.finanzas.models import CATEGORIA_HONORARIOS, Categoria, Transaccion

from .models import AsignacionTarea, Liquidacion, Subtarea, Tarea, TareaRecurrente

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
                    if p.agrupar_subtareas and p.por_dia > 1:
                        tarea = Tarea.objects.create(
                            titulo=p.titulo, descripcion=p.descripcion, cliente_id=p.cliente_id, prioridad=p.prioridad,
                            etiqueta=p.etiqueta, fecha_limite=dia, recurrente=p, hora_inicio=p.hora_inicio, hora_fin=p.hora_fin,
                        )
                        prefijo = (p.titulo_subtarea or '').strip() or 'Historia'
                        Subtarea.objects.bulk_create([
                            Subtarea(tarea=tarea, titulo=f'{prefijo} {i}', orden=i) for i in range(1, p.por_dia + 1)
                        ])
                        AsignacionTarea.objects.bulk_create([AsignacionTarea(persona=x, tarea=tarea) for x in personas])
                        nuevas.append(tarea)
                        creadas += 1
                    else:
                        for i in range(1, p.por_dia + 1):
                            tarea = Tarea.objects.create(
                                titulo=f'{p.titulo} {i}/{p.por_dia}' if p.por_dia > 1 else p.titulo,
                                descripcion=p.descripcion, cliente_id=p.cliente_id, prioridad=p.prioridad,
                                etiqueta=p.etiqueta, fecha_limite=dia, recurrente=p, hora_inicio=p.hora_inicio, hora_fin=p.hora_fin,
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


def estado_segun_subtareas(tarea, estado):
    """Tras tildar o destildar: todas hechas pasa a hecha; si estaba hecha y ya no, vuelve a en curso.

    Bloqueada, en revisión y el resto no se pisan mientras no se cruce ese umbral.
    """
    marcas = list(tarea.subtareas.values_list('hecha', flat=True))
    if not marcas or (estado == 'bloqueada' and esperando(tarea)):
        return estado
    if all(marcas):
        return 'hecha'
    if estado == 'hecha':
        return 'en_curso'
    return estado


def fijar_estado(tarea, estado):
    """Deja estado y completada_en coherentes. Devuelve True si cambió el estado."""
    if estado == tarea.estado:
        return False
    anterior = tarea.estado
    tarea.estado = estado
    if estado == 'hecha' and anterior != 'hecha':
        tarea.completada_en = timezone.now()
    elif estado != 'hecha':
        tarea.completada_en = None
    tarea.save(update_fields=['estado', 'completada_en'])
    return True


# Estados a los que no puede pasar una tarea mientras espere a otras.
ESTADOS_DE_AVANCE = ('en_curso', 'en_revision', 'hecha')


def pendientes_de(tarea):
    """Dependencias que todavía no están Hechas."""
    if not tarea.pk:
        return Tarea.objects.none()
    return tarea.depende_de.exclude(estado='hecha')


def esperando(tarea) -> bool:
    return pendientes_de(tarea).exists()


def ajustar_por_dependencias(tarea, avanzo=False):
    """Bloquea o desbloquea la tarea según sus dependencias. Devuelve 'bloqueada', 'desbloqueada' o None.

    Solo bloquea una que está Por hacer, o una que recién avanzó (`avanzo`, p. ej. desde Notion): una que ya estaba en
    curso cuando se reabrió una de sus dependencias no se toca. Solo desbloquea las que bloqueó el sistema.
    """
    if esperando(tarea):
        if tarea.estado == 'pendiente' or (avanzo and tarea.estado in ESTADOS_DE_AVANCE):
            tarea.estado, tarea.completada_en, tarea.bloqueo_auto = 'bloqueada', None, True
            tarea.save(update_fields=['estado', 'completada_en', 'bloqueo_auto'])
            return 'bloqueada'
        return None
    if not tarea.bloqueo_auto:
        return None
    tarea.bloqueo_auto = False
    if tarea.estado != 'bloqueada':
        tarea.save(update_fields=['bloqueo_auto'])
        return None
    tarea.estado, tarea.completada_en = 'pendiente', None
    tarea.save(update_fields=['estado', 'completada_en', 'bloqueo_auto'])
    return 'desbloqueada'


def crearia_ciclo(tarea, candidatas) -> bool:
    """True si `tarea` pasaría a depender (directa o indirectamente) de sí misma."""
    if not tarea.pk:
        return False
    vistos, frontera = set(), {c.pk for c in candidatas}
    while frontera:
        if tarea.pk in frontera:
            return True
        vistos |= frontera
        frontera = set(Tarea.depende_de.through.objects.filter(from_tarea_id__in=frontera).values_list('to_tarea_id', flat=True)) - vistos
    return False


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
    from apps.notificaciones.services import pago_registrado

    transaction.on_commit(lambda: pago_registrado(liq))
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


# Una liquidación aprobada o pendiente que lleva estos días sin pagarse avisa a los admins.
DIAS_LIQUIDACION_ATRASADA = 7


def liquidaciones_sin_pagar():
    return Liquidacion.objects.filter(estado__in=('pendiente', 'aprobada')).select_related('persona', 'cliente').order_by('periodo', 'creado')


def avisos_de_liquidaciones(hoy) -> int:
    """A los admins, una vez por liquidación: las que llevan DIAS_LIQUIDACION_ATRASADA días sin pagar."""
    from apps.notificaciones.services import admins, notificar
    from apps.servicios.services import pesos

    limite = timezone.make_aware(datetime.combine(hoy - timedelta(days=DIAS_LIQUIDACION_ATRASADA), time.max))
    creadas = 0
    for liq in liquidaciones_sin_pagar().filter(creado__lte=limite):
        creadas += notificar(
            admins(), 'pago_equipo', f'Falta pagarle a {liq.persona.nombre}', f'{liq.concepto} ({liq.periodo}) · {pesos(liq.total)}.',
            '/pagos-equipo', clave=f'liq-atrasada:{liq.pk}',
        )
    return creadas
