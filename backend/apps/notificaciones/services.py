"""Crear notificaciones (campana del panel) y, cuando corresponde, avisar por email.

Un fallo al notificar nunca debe impedir guardar lo que lo disparó.
"""

import logging
from collections import defaultdict

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q

from . import email as correo
from .models import Notificacion

logger = logging.getLogger(__name__)
User = get_user_model()

ESTADOS_PARA_ADMINS = {'en_revision': 'pasó a revisión', 'bloqueada': 'está bloqueada'}


def admins():
    return User.objects.filter(Q(is_superuser=True) | Q(rol='admin'), is_active=True)


def usuarios_de(personas):
    """Usuarios activos vinculados a esas personas (objetos o ids)."""
    ids = [getattr(p, 'pk', p) for p in personas]
    return User.objects.filter(persona_id__in=ids, is_active=True)


def fecha_corta(d) -> str:
    return d.strftime('%d/%m') if d else ''


def url_tarea(tarea) -> str:
    return f'/tareas?tarea={tarea.pk}'


def _visibles(usuarios, tarea):
    if tarea is None:
        return list(usuarios)
    from apps.calendario.etiquetas import privadas

    if tarea.etiqueta in privadas():
        return [u for u in usuarios if u.es_admin]
    return list(usuarios)


def notificar(usuarios, tipo, titulo, cuerpo='', url='', tarea=None, clave='', email=False, excluir=None) -> int:
    """Crea una notificación por usuario (sin repetir la misma `clave`). Devuelve cuántas creó."""
    creadas = 0
    vistos = set()
    for u in _visibles(usuarios, tarea):
        if u.pk in vistos or (excluir is not None and u.pk == excluir.pk):
            continue
        vistos.add(u.pk)
        if clave and Notificacion.objects.filter(usuario=u, clave=clave).exists():
            continue
        try:
            with transaction.atomic():
                n = Notificacion.objects.create(
                    usuario=u, tipo=tipo, titulo=titulo[:200], cuerpo=cuerpo, url=url[:200], tarea=tarea, clave=clave[:160]
                )
        except IntegrityError:
            continue
        creadas += 1
        if email and u.notif_email and u.email:
            html = correo.plantilla(titulo, [correo.parrafo(cuerpo)] if cuerpo else [], ('Abrir en el panel', url or '/'))
            if correo.enviar_seguro(u.email, titulo, html):
                Notificacion.objects.filter(pk=n.pk).update(email_enviado=True)
    return creadas


def _seguro(fn, *args, **kwargs):
    try:
        fn(*args, **kwargs)
    except Exception:
        logger.exception('Error creando notificaciones')


def _detalle_tarea(tarea) -> str:
    partes = []
    if tarea.cliente_id:
        partes.append(tarea.cliente.nombre)
    if tarea.fecha_limite:
        partes.append(f'vence el {fecha_corta(tarea.fecha_limite)}')
    return ' · '.join(partes)


def _al_asignar(tarea, persona_ids, actor):
    if not persona_ids:
        return
    quien = f' ({actor.nombre_display or actor.username})' if actor and actor.nombre_display not in ('', 'Yo') else ''
    notificar(
        usuarios_de(persona_ids), 'tarea_asignada', f'Nueva tarea: {tarea.titulo}', _detalle_tarea(tarea) + quien,
        url_tarea(tarea), tarea=tarea, email=True, excluir=actor,
    )


def al_asignar(tarea, persona_ids, actor=None):
    _seguro(_al_asignar, tarea, persona_ids, actor)


def _al_cambiar_estado(tarea, anterior, actor):
    if tarea.estado == anterior:
        return
    nombre = (actor.nombre_display if actor and actor.nombre_display not in ('', 'Yo') else getattr(actor, 'username', '')) or 'Alguien'
    if tarea.estado in ESTADOS_PARA_ADMINS:
        destinatarios = list(admins())
        if tarea.user_id:
            destinatarios += list(User.objects.filter(pk=tarea.user_id, is_active=True))
        notificar(
            destinatarios, 'tarea_estado', f'«{tarea.titulo}» {ESTADOS_PARA_ADMINS[tarea.estado]}',
            f'{nombre} la cambió. {_detalle_tarea(tarea)}'.strip(), url_tarea(tarea), tarea=tarea, excluir=actor,
        )
    elif tarea.estado == 'hecha' and tarea.user_id and (actor is None or tarea.user_id != actor.pk):
        notificar(
            User.objects.filter(pk=tarea.user_id, is_active=True), 'tarea_hecha', f'Terminada: {tarea.titulo}',
            f'La marcó {nombre}. {_detalle_tarea(tarea)}'.strip(), url_tarea(tarea), tarea=tarea, excluir=actor,
        )


def al_cambiar_estado(tarea, anterior, actor=None):
    _seguro(_al_cambiar_estado, tarea, anterior, actor)


def _asignadas_en_tanda(tareas, motivo, actor, email):
    por_persona = defaultdict(list)
    for t in tareas:
        for pid in t.asignaciones.values_list('persona_id', flat=True):
            por_persona[pid].append(t)
    for pid, lista in por_persona.items():
        if len(lista) == 1:
            _al_asignar(lista[0], [pid], actor)
            continue
        fechas = sorted(t.fecha_limite for t in lista if t.fecha_limite)
        rango = f' (del {fecha_corta(fechas[0])} al {fecha_corta(fechas[-1])})' if fechas else ''
        visibles = [t for t in lista if _visibles(usuarios_de([pid]), t)]
        if not visibles:
            continue
        notificar(
            usuarios_de([pid]), 'tarea_asignada', f'Te asignaron {len(visibles)} tareas {motivo}', f'Ya están en Mi panel{rango}.',
            '/tareas', email=email, excluir=actor,
        )


def asignadas_en_tanda(tareas, motivo, actor=None, email=False):
    """Un solo aviso por persona para muchas tareas creadas juntas (plan del mes, recurrentes)."""
    _seguro(_asignadas_en_tanda, tareas, motivo, actor, email)
