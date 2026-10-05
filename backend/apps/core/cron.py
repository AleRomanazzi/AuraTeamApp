"""Tareas programadas. Las dispara cada hora un cron externo (GitHub Actions) con POST /api/cron/.

Todo es idempotente: correr dos veces en la misma hora no duplica avisos ni tareas. Cada paso va aparte para que el
fallo de uno no frene a los demás.
"""

import logging
from collections import defaultdict
from datetime import timedelta

from django.core.cache import cache
from django.utils import timezone

from apps.notificaciones import email as correo
from apps.notificaciones.models import EstadoCron, Notificacion
from apps.notificaciones.services import admins, fecha_corta, notificar

logger = logging.getLogger(__name__)

HORA_AVISOS = 8
DIAS_VENCIDAS = 7
DIAS_LIMPIEZA = 60
INTERVALO_RESPALDO = timedelta(hours=2)
CACHE_RESPALDO = 'aura.cron.respaldo'


def _abiertas_con_fecha():
    from apps.equipo.models import Tarea

    return Tarea.objects.exclude(estado='hecha').filter(fecha_limite__isnull=False).select_related('cliente')


def _por_usuario(tareas):
    """{usuario: [tareas]} según las asignaciones; las privadas solo para admins."""
    from apps.calendario.etiquetas import privadas
    from apps.equipo.models import AsignacionTarea

    ocultas = privadas()
    tareas = {t.pk: t for t in tareas}
    salida = defaultdict(list)
    asign = AsignacionTarea.objects.filter(tarea_id__in=tareas, persona__usuario__is_active=True).select_related('persona__usuario')
    for a in asign:
        u = a.persona.usuario
        t = tareas[a.tarea_id]
        if t.etiqueta in ocultas and not u.es_admin:
            continue
        salida[u].append(t)
    return salida


def _titulos(tareas, n=6):
    items = [f'{t.titulo}' + (f' · {t.cliente.nombre}' if t.cliente_id else '') for t in tareas[:n]]
    if len(tareas) > n:
        items.append(f'y {len(tareas) - n} más')
    return items


def avisos_de_deadlines(hoy) -> int:
    """Un aviso por persona y día: lo que vence mañana, hoy y lo vencido de la última semana."""
    manana = hoy + timedelta(days=1)
    qs = _abiertas_con_fecha().filter(fecha_limite__gte=hoy - timedelta(days=DIAS_VENCIDAS), fecha_limite__lte=manana)
    creadas = 0
    for u, tareas in _por_usuario(qs).items():
        grupos = (
            ('tarea_vencida', [t for t in tareas if t.fecha_limite < hoy], 'vencida', 'vencidas', f'vencidas:{hoy}'),
            ('deadline_hoy', [t for t in tareas if t.fecha_limite == hoy], 'Vence hoy', 'vencen hoy', f'hoy:{hoy}'),
            ('deadline_manana', [t for t in tareas if t.fecha_limite == manana], 'Vence mañana', 'vencen mañana', f'manana:{manana}'),
        )
        for tipo, lista, uno, varios, clave in grupos:
            if not lista:
                continue
            if len(lista) == 1:
                t = lista[0]
                titulo = f'Tarea vencida: {t.titulo}' if tipo == 'tarea_vencida' else f'{uno}: {t.titulo}'
                cuerpo = t.cliente.nombre if t.cliente_id else ''
                if tipo == 'tarea_vencida':
                    cuerpo = f'Vencía el {fecha_corta(t.fecha_limite)}. {cuerpo}'.strip()
                creadas += notificar([u], tipo, titulo, cuerpo, f'/tareas?tarea={t.pk}', tarea=t, clave=clave)
            else:
                titulo = f'Tenés {len(lista)} tareas {varios}'
                creadas += notificar([u], tipo, titulo, ' · '.join(_titulos(lista, 4)), '/tareas', clave=clave)
    return creadas


def _bloques_tareas(tareas, hoy):
    manana = hoy + timedelta(days=1)
    bloques = []
    for nombre, lista in (
        ('Vencidas', [t for t in tareas if t.fecha_limite < hoy]),
        ('Para hoy', [t for t in tareas if t.fecha_limite == hoy]),
        ('Para mañana', [t for t in tareas if t.fecha_limite == manana]),
    ):
        if lista:
            bloques += [correo.subtitulo(f'{nombre} ({len(lista)})'), correo.lista(_titulos(lista, 15))]
    return bloques


def resumen_diario(hoy) -> int:
    """Email de la mañana: a cada persona sus tareas; a los admins, además, el estado del equipo."""
    from apps.equipo.models import Tarea

    manana = hoy + timedelta(days=1)
    qs = _abiertas_con_fecha().filter(fecha_limite__gte=hoy - timedelta(days=30), fecha_limite__lte=manana)
    por_usuario = _por_usuario(qs)
    enviados = 0
    dia = hoy.strftime('%d/%m')

    for u, tareas in por_usuario.items():
        if u.es_admin or not (u.notif_email and u.email):
            continue
        html = correo.plantilla(f'Tu día · {dia}', _bloques_tareas(tareas, hoy), ('Abrir Mi panel', '/'))
        enviados += correo.enviar_seguro(u.email, f'Tu día en AuraTeam · {dia}', html)

    equipo = []
    for u, tareas in sorted(por_usuario.items(), key=lambda x: x[0].persona.nombre if x[0].persona else x[0].username):
        if u.es_admin:
            continue
        vencidas = sum(t.fecha_limite < hoy for t in tareas)
        de_hoy = sum(t.fecha_limite == hoy for t in tareas)
        if vencidas or de_hoy:
            equipo.append(f'{u.persona.nombre}: {vencidas} vencidas, {de_hoy} para hoy')
    revision = list(Tarea.objects.filter(estado='en_revision').select_related('cliente')[:15])
    bloqueadas = list(Tarea.objects.filter(estado='bloqueada').select_related('cliente')[:15])
    servicios = _servicios_a_pagar(hoy)

    for u in admins():
        if not (u.notif_email and u.email):
            continue
        bloques = []
        if equipo:
            bloques += [correo.subtitulo('Equipo'), correo.lista(equipo)]
        if revision:
            bloques += [correo.subtitulo(f'En revisión ({len(revision)})'), correo.lista(_titulos(revision, 10))]
        if bloqueadas:
            bloques += [correo.subtitulo(f'Bloqueadas ({len(bloqueadas)})'), correo.lista(_titulos(bloqueadas, 10))]
        if servicios:
            bloques += [correo.subtitulo('Servicios a pagar'), correo.lista(servicios)]
        bloques += _bloques_tareas(por_usuario.get(u, []), hoy)
        if not bloques:
            bloques = [correo.parrafo('Todo al día: no hay tareas vencidas, en revisión ni pagos próximos.')]
        html = correo.plantilla(f'Resumen de la agencia · {dia}', bloques, ('Ver Equipo hoy', '/equipo-hoy'))
        enviados += correo.enviar_seguro(u.email, f'Resumen AuraTeam · {dia}', html)
    return enviados


def _servicios_a_pagar(hoy) -> list[str]:
    from apps.servicios.services import vencimientos_proximos

    return [f'{s.nombre}: vence el {fecha_corta(v)}' + (f' (paga {s.pagador.nombre})' if s.pagador_id else '') for s, v in vencimientos_proximos(hoy, 3)]


def limpiar(ahora) -> int:
    borradas, _ = Notificacion.objects.filter(leida_en__lt=ahora - timedelta(days=DIAS_LIMPIEZA)).delete()
    return borradas


def _paso(resumen, nombre, fn, *args):
    try:
        resumen[nombre] = fn(*args)
    except Exception as e:
        logger.exception('Cron: falló %s', nombre)
        resumen.setdefault('errores', []).append(f'{nombre}: {e.__class__.__name__}: {e}'[:300])


def _pasos_livianos(resumen, ahora):
    from apps.equipo.services import generar_recurrentes
    from apps.servicios.services import avisos_de_servicios, generar_tareas_de_servicios

    hoy = timezone.localdate(ahora)
    _paso(resumen, 'recurrentes', generar_recurrentes)
    _paso(resumen, 'tareas_servicios', generar_tareas_de_servicios, hoy)
    if timezone.localtime(ahora).hour >= HORA_AVISOS:
        _paso(resumen, 'avisos', avisos_de_deadlines, hoy)
        _paso(resumen, 'avisos_servicios', avisos_de_servicios, hoy)


def ejecutar(ahora=None) -> dict:
    ahora = ahora or timezone.now()
    hoy = timezone.localdate(ahora)
    estado = EstadoCron.get()
    resumen = {}
    _pasos_livianos(resumen, ahora)
    if timezone.localtime(ahora).hour >= HORA_AVISOS and estado.ultimo_resumen != hoy:
        # Se marca antes de enviar: si algo falla a mitad, no se repiten emails en la corrida siguiente.
        EstadoCron.objects.filter(pk=estado.pk).update(ultimo_resumen=hoy)
        _paso(resumen, 'resumen', resumen_diario, hoy)
    _paso(resumen, 'clientes', _tareas_de_clientes, ahora)
    _paso(resumen, 'limpieza', limpiar, ahora)
    EstadoCron.objects.filter(pk=estado.pk).update(ultima_corrida=ahora, ultimo_error='\n'.join(resumen.get('errores', [])))
    return resumen


def _tareas_de_clientes(ahora):
    from apps.clientes import envios

    return envios.programados(ahora)


def respaldo():
    """Si el cron externo no corrió en las últimas horas, al abrir el panel se hacen los pasos livianos (sin resumen diario)."""
    if cache.get(CACHE_RESPALDO):
        return
    cache.set(CACHE_RESPALDO, True, 600)
    ultima = EstadoCron.get().ultima_corrida
    ahora = timezone.now()
    if ultima and ahora - ultima < INTERVALO_RESPALDO:
        return
    try:
        resumen = {}
        _pasos_livianos(resumen, ahora)
    except Exception:
        logger.exception('Cron: falló el respaldo')
