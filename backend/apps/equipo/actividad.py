"""Historial de cambios de las tareas («quién cambió qué»). Registrar nunca debe impedir guardar."""

import logging

from .models import ESTADO_TAREA, PRIORIDAD_TAREA, ActividadTarea, Persona

logger = logging.getLogger(__name__)

ESTADOS = dict(ESTADO_TAREA)
PRIORIDADES = dict(PRIORIDAD_TAREA)


def foto(tarea) -> dict:
    return {
        'titulo': tarea.titulo,
        'estado': tarea.estado,
        'prioridad': tarea.prioridad,
        'etiqueta': tarea.etiqueta,
        'cliente': tarea.cliente_id,
        'fecha_limite': tarea.fecha_limite,
        'asignados': set(tarea.asignaciones.values_list('persona_id', flat=True)) if tarea.pk else set(),
    }


def _fecha(d):
    return d.strftime('%d/%m/%Y') if d else 'sin fecha'


def _nombres(ids):
    return ', '.join(Persona.objects.filter(pk__in=ids).order_by('nombre').values_list('nombre', flat=True))


def _cambios(antes, despues, tarea) -> list[str]:
    textos = []
    if antes['titulo'] != despues['titulo']:
        textos.append(f'Cambió el título a «{despues["titulo"]}»')
    if antes['estado'] != despues['estado']:
        textos.append(f'Pasó de {ESTADOS.get(antes["estado"], antes["estado"])} a {ESTADOS.get(despues["estado"], despues["estado"])}')
    if antes['fecha_limite'] != despues['fecha_limite']:
        textos.append(f'Cambió la fecha límite: {_fecha(antes["fecha_limite"])} → {_fecha(despues["fecha_limite"])}')
    if antes['prioridad'] != despues['prioridad']:
        textos.append(f'Prioridad {PRIORIDADES.get(despues["prioridad"], despues["prioridad"]).lower()}')
    if antes['etiqueta'] != despues['etiqueta']:
        textos.append(f'Pasó a la etiqueta {despues["etiqueta"]}')
    if antes['cliente'] != despues['cliente']:
        textos.append(f'Pasó a {tarea.cliente.nombre if tarea.cliente_id else "Gestión interna"}')
    sumados, quitados = despues['asignados'] - antes['asignados'], antes['asignados'] - despues['asignados']
    if sumados:
        textos.append(f'Asignó a {_nombres(sumados)}')
    if quitados:
        textos.append(f'Quitó a {_nombres(quitados)}')
    return textos


def registrar(tarea, texto, usuario=None):
    try:
        ActividadTarea.objects.create(tarea=tarea, usuario=usuario, texto=texto[:300])
    except Exception:
        logger.exception('No se pudo registrar la actividad de la tarea %s', tarea.pk)


def registrar_cambios(tarea, antes, usuario):
    try:
        despues = foto(tarea)
        textos = _cambios(antes, despues, tarea)
    except Exception:
        logger.exception('No se pudo comparar la tarea %s', tarea.pk)
        return
    for texto in textos:
        registrar(tarea, texto, usuario)
