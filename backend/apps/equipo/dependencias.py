"""Efectos de completar o reabrir una tarea sobre las que dependen de ella.

Se llama después de guardar (API del panel y Notion → panel). Las tareas que cambian se mandan a Notion y Google;
un fallo de esas integraciones o de los avisos nunca impide guardar.
"""

import logging

from .models import Tarea
from .services import ajustar_por_dependencias

logger = logging.getLogger(__name__)


def _sincronizar(tarea):
    from apps.calendario import google_calendar
    from apps.integraciones import notion

    notion.al_guardar_tarea(tarea)
    google_calendar.al_guardar_tarea(tarea)


def propagar(tarea, anterior, actor=None, sincronizar=True) -> list:
    """Si `tarea` entró o salió de Hecha, revisa las que dependen de ella. Devuelve las que cambiaron de estado."""
    if anterior is None or (tarea.estado == 'hecha') == (anterior == 'hecha'):
        return []
    from apps.notificaciones import services as avisos

    cambiadas = []
    for dep in Tarea.objects.filter(depende_de=tarea).select_related('cliente'):
        try:
            resultado = ajustar_por_dependencias(dep)
        except Exception:
            logger.exception('No se pudo revisar la dependencia de la tarea %s', dep.pk)
            continue
        if resultado == 'desbloqueada':
            avisos.tarea_disponible(dep, tarea, actor)
        elif resultado is None and tarea.estado != 'hecha' and dep.estado != 'bloqueada':
            avisos.dependencia_reabierta(dep, tarea, actor)
        if resultado:
            cambiadas.append(dep)
            if sincronizar:
                _sincronizar(dep)
    return cambiadas
