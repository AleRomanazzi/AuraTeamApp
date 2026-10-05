from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.utils import aplica_en_mes, fecha_en_mes, money, parse_mes
from apps.finanzas.models import CATEGORIA_SOFTWARE, Categoria, Transaccion

from .models import AvisoServicio, PagoServicio, Servicio

ETIQUETA_PAGOS = 'pagos'
# Si el cron estuvo caído, las tareas de un vencimiento se generan igual hasta esta cantidad de días después.
DIAS_TARDE = 7


def aplica_servicio_en_mes(s: Servicio, y: int, m: int) -> bool:
    if s.periodicidad == 'mensual' or not s.fecha_pago:
        return True
    return aplica_en_mes(s.fecha_pago, s.periodicidad, y, m)


def _registrar(s: Servicio, inicio, periodo, user=None) -> PagoServicio | None:
    monto = s.monto_agencia
    if not monto or monto <= 0:
        return None
    tx = Transaccion.objects.create(
        user=user,
        fecha=fecha_en_mes(inicio.year, inicio.month, s.dia_vencimiento),
        descripcion=f'{s.nombre} ({periodo})'[:200],
        categoria=s.categoria or Categoria.por_nombre(CATEGORIA_SOFTWARE, 'egreso'),
        tipo='egreso',
        monto=monto,
    )
    return PagoServicio.objects.create(servicio=s, periodo=periodo, transaccion=tx)


@transaction.atomic
def generar_egresos(mes: str, user=None) -> dict:
    """Registra el egreso del mes de cada suscripción activa que corresponda. Idempotente."""
    inicio, _fin, periodo = parse_mes(mes, required=True)
    ya = set(PagoServicio.objects.filter(periodo=periodo).values_list('servicio_id', flat=True))
    creados = 0
    for s in Servicio.objects.filter(activo=True, generar_egreso=True).select_related('categoria'):
        if s.id in ya or not aplica_servicio_en_mes(s, inicio.year, inicio.month):
            continue
        if _registrar(s, inicio, periodo, user):
            creados += 1
    return {'periodo': periodo, 'creados': creados, 'existentes': len(ya)}


@transaction.atomic
def registrar_pago(s: Servicio, mes: str, user=None) -> bool:
    """Registra el egreso de un servicio en un período (si no estaba) y cierra su tarea de pago. Devuelve si lo creó."""
    inicio, _fin, periodo = parse_mes(mes, required=True)
    creado = False
    if s.generar_egreso and not PagoServicio.objects.filter(servicio=s, periodo=periodo).exists():
        creado = _registrar(s, inicio, periodo, user) is not None
    from apps.equipo.models import Tarea

    abiertas = Tarea.objects.filter(aviso_servicio__servicio=s, aviso_servicio__periodo=periodo, aviso_servicio__tipo='pago').exclude(estado='hecha')
    abiertas.update(estado='hecha', completada_en=timezone.now())
    return creado


def pesos(valor) -> str:
    v = money(valor)
    entero = f'{int(v):,}'.replace(',', '.')
    centavos = int((v - int(v)) * 100)
    return f'$ {entero},{centavos:02d}' if centavos else f'$ {entero}'


def _vencimientos(s: Servicio, hoy):
    """Vencimientos del servicio en el mes actual y el siguiente: [(fecha, 'YYYY-MM')]."""
    salida = []
    y, m = hoy.year, hoy.month
    for _ in range(2):
        if aplica_servicio_en_mes(s, y, m):
            salida.append((fecha_en_mes(y, m, s.dia_vencimiento), f'{y:04d}-{m:02d}'))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return salida


def vencimientos_proximos(hoy, dias: int) -> list:
    """[(servicio, fecha)] de servicios activos sin pagar que vencen entre hoy y hoy + dias."""
    pagados = set(PagoServicio.objects.values_list('servicio_id', 'periodo'))
    salida = []
    for s in Servicio.objects.filter(activo=True).select_related('pagador'):
        for fecha, periodo in _vencimientos(s, hoy):
            if hoy <= fecha <= hoy + timedelta(days=dias) and (s.id, periodo) not in pagados:
                salida.append((s, fecha))
    return sorted(salida, key=lambda x: x[1])


def _aportes(s: Servicio):
    """[(persona_id, monto)] de las filas del reparto vinculadas a una persona del equipo (sin el pagador)."""
    salida = []
    for fila in s.detalle or []:
        pid = fila.get('persona')
        if pid and pid != s.pagador_id and money(fila.get('monto')) > 0:
            salida.append((int(pid), money(fila.get('monto'))))
    return salida


def _crear_tarea(s, periodo, persona_id, tipo, monto, vencimiento, titulo, descripcion):
    from apps.equipo.models import AsignacionTarea, Tarea

    try:
        with transaction.atomic():
            aviso = AvisoServicio.objects.create(
                servicio=s, periodo=periodo, persona_id=persona_id, tipo=tipo, monto=monto, vencimiento=vencimiento
            )
            tarea = Tarea.objects.create(
                titulo=titulo[:200], descripcion=descripcion, prioridad='alta', fecha_limite=vencimiento, etiqueta=ETIQUETA_PAGOS,
                user=s.user,
            )
            AsignacionTarea.objects.create(persona_id=persona_id, tarea=tarea)
            AvisoServicio.objects.filter(pk=aviso.pk).update(tarea=tarea)
    except IntegrityError:
        return None
    return tarea


def generar_tareas_de_servicios(hoy) -> int:
    """Desde `dias_aviso` días antes de cada vencimiento: tarea «Pagar …» al pagador y «Transferir …» a cada aportante."""
    from apps.notificaciones.services import notificar, usuarios_de

    pagados = set(PagoServicio.objects.values_list('servicio_id', 'periodo'))
    creadas = 0
    for s in Servicio.objects.filter(activo=True).select_related('pagador'):
        aportes = _aportes(s)
        if not s.pagador_id and not aportes:
            continue
        for vencimiento, periodo in _vencimientos(s, hoy):
            if not (vencimiento - timedelta(days=s.dias_aviso) <= hoy <= vencimiento + timedelta(days=DIAS_TARDE)):
                continue
            fecha = vencimiento.strftime('%d/%m')
            if s.pagador_id and (s.id, periodo) not in pagados:
                tarea = _crear_tarea(
                    s, periodo, s.pagador_id, 'pago', s.monto_total, vencimiento, f'Pagar {s.nombre}',
                    f'Vence el {fecha}. Total: {pesos(s.monto_total)}.'
                    + (f' Aportan: {", ".join(f"{p.nombre} {pesos(m)}" for p, m in _personas(aportes))}.' if aportes else ''),
                )
                if tarea:
                    creadas += 1
                    notificar(
                        usuarios_de([s.pagador_id]), 'servicio', f'Pagar {s.nombre} antes del {fecha}', f'Total: {pesos(s.monto_total)}.',
                        f'/tareas?tarea={tarea.pk}', tarea=tarea, email=True,
                    )
            for persona_id, monto in aportes:
                destino = f' a {s.pagador.nombre}' if s.pagador_id else ''
                tarea = _crear_tarea(
                    s, periodo, persona_id, 'aporte', monto, vencimiento, f'Transferir {pesos(monto)}{destino} · {s.nombre}',
                    f'Tu parte de {s.nombre} ({periodo}). Vence el {fecha}.'
                    + (f' Alias/CBU de {s.pagador.nombre}: {s.pagador.alias_cbu}.' if s.pagador_id and s.pagador.alias_cbu else ''),
                )
                if tarea:
                    creadas += 1
                    notificar(
                        usuarios_de([persona_id]), 'aporte', f'Aportá tu parte de {s.nombre}', f'{pesos(monto)}{destino}, antes del {fecha}.',
                        f'/tareas?tarea={tarea.pk}', tarea=tarea, email=True,
                    )
    return creadas


def _personas(aportes):
    from apps.equipo.models import Persona

    por_id = Persona.objects.in_bulk([pid for pid, _ in aportes])
    return [(por_id[pid], monto) for pid, monto in aportes if pid in por_id]


def avisos_de_servicios(hoy) -> int:
    """A los admins: servicios de la agencia por vencer, pagos vencidos sin hacer y aportes atrasados."""
    from apps.notificaciones.services import admins, notificar, usuarios_de

    creadas = 0
    for s, fecha in vencimientos_proximos(hoy, 3):
        if not s.pagador_id:
            periodo = f'{fecha.year:04d}-{fecha.month:02d}'
            creadas += notificar(
                admins(), 'servicio', f'Vence {s.nombre} el {fecha.strftime("%d/%m")}', f'{pesos(s.monto_total)} · lo paga la agencia.',
                '/suscripciones', clave=f'servicio-agencia:{s.id}:{periodo}',
            )
    atrasados = AvisoServicio.objects.filter(vencimiento__lte=hoy, tarea__isnull=False).exclude(tarea__estado='hecha')
    for a in atrasados.select_related('servicio', 'persona', 'servicio__pagador', 'tarea'):
        if a.tipo == 'pago':
            titulo = f'{a.servicio.nombre} vence hoy y no está pago' if a.vencimiento == hoy else f'{a.servicio.nombre} venció sin pagar'
            creadas += notificar(
                admins(), 'servicio', titulo, f'Lo paga {a.persona.nombre}.', f'/tareas?tarea={a.tarea_id}', tarea=a.tarea,
                clave=f'servicio-atrasado:{a.id}:{"hoy" if a.vencimiento == hoy else "vencido"}',
            )
        elif a.vencimiento < hoy:
            destinatarios = list(admins()) + (list(usuarios_de([a.servicio.pagador_id])) if a.servicio.pagador_id else [])
            creadas += notificar(
                destinatarios, 'aporte', f'{a.persona.nombre} no confirmó su aporte de {a.servicio.nombre}',
                f'{pesos(a.monto)} · vencía el {a.vencimiento.strftime("%d/%m")}.', f'/tareas?tarea={a.tarea_id}', tarea=a.tarea,
                clave=f'aporte-atrasado:{a.id}',
            )
    return creadas


def al_completar_tarea(tarea, actor=None):
    """La tarea de pago hecha registra el egreso del servicio; la de aporte avisa al pagador."""
    aviso = AvisoServicio.objects.filter(tarea=tarea).select_related('servicio', 'servicio__pagador', 'persona').first()
    if aviso is None:
        return
    from apps.notificaciones.services import admins, notificar, usuarios_de

    s = aviso.servicio
    if aviso.tipo == 'pago':
        registrar_pago(s, aviso.periodo, actor)
        notificar(admins(), 'servicio', f'{aviso.persona.nombre} pagó {s.nombre}', f'Período {aviso.periodo}.', '/suscripciones', excluir=actor)
    else:
        destinatarios = list(usuarios_de([s.pagador_id])) if s.pagador_id else list(admins())
        notificar(
            destinatarios, 'aporte', f'{aviso.persona.nombre} transfirió su parte de {s.nombre}', f'{pesos(aviso.monto)} · {aviso.periodo}.',
            f'/tareas?tarea={tarea.pk}', excluir=actor,
        )
