"""«Equipo hoy»: qué tiene cada persona para hoy, qué se le venció y cuánto cumple en fecha."""

from collections import defaultdict
from datetime import timedelta

from django.utils import timezone

from .models import AsignacionTarea, Persona

DIAS_PROXIMAS = 3


def _porcentaje(cumplidas, total):
    return round(cumplidas * 100 / total) if total else None


def cumplimiento(tareas, fecha, dias) -> int | None:
    """% de tareas con fecha en los últimos `dias` hechas a tiempo, sobre las hechas más las vencidas sin hacer."""
    desde = fecha - timedelta(days=dias - 1)
    cumplidas = total = 0
    for t in tareas:
        if not t.fecha_limite or not desde <= t.fecha_limite <= fecha:
            continue
        if t.estado == 'hecha':
            total += 1
            if t.completada_en and timezone.localdate(t.completada_en) <= t.fecha_limite:
                cumplidas += 1
        elif t.fecha_limite < fecha:
            total += 1
    return _porcentaje(cumplidas, total)


def _semaforo(c):
    if c['vencidas']:
        return 'rojo'
    if c['hoy'] or c['bloqueadas']:
        return 'amarillo'
    return 'verde'


def seguimiento(fecha, rol=None):
    """Por persona activa con usuario: sus tareas abiertas relevantes, las hechas en la fecha y su cumplimiento."""
    personas = [p for p in Persona.objects.filter(activo=True).select_related('usuario') if getattr(p, 'usuario', None)]
    if rol:
        personas = [p for p in personas if rol in (p.usuario.roles or []) or (rol == 'admin' and p.usuario.es_admin)]
    desde = fecha - timedelta(days=29)
    asignaciones = (
        AsignacionTarea.objects.filter(persona__in=personas)
        .exclude(tarea__estado='hecha', tarea__completada_en__date__lt=desde, tarea__fecha_limite__lt=desde)
        .select_related('tarea', 'tarea__cliente')
        .prefetch_related('tarea__asignaciones__persona')
    )
    por_persona = defaultdict(list)
    for a in asignaciones:
        por_persona[a.persona_id].append(a.tarea)

    hasta = fecha + timedelta(days=DIAS_PROXIMAS)
    salida = []
    for p in personas:
        tareas = por_persona[p.id]
        abiertas = [t for t in tareas if t.estado != 'hecha']
        hechas_hoy = [t for t in tareas if t.estado == 'hecha' and t.completada_en and timezone.localdate(t.completada_en) == fecha]
        conteos = {
            'vencidas': sum(1 for t in abiertas if t.fecha_limite and t.fecha_limite < fecha),
            'hoy': sum(1 for t in abiertas if t.fecha_limite == fecha),
            'proximas': sum(1 for t in abiertas if t.fecha_limite and fecha < t.fecha_limite <= hasta),
            'en_revision': sum(1 for t in abiertas if t.estado == 'en_revision'),
            'bloqueadas': sum(1 for t in abiertas if t.estado == 'bloqueada'),
            'hechas_hoy': len(hechas_hoy),
            'sin_fecha': sum(1 for t in abiertas if not t.fecha_limite),
        }
        visibles = [
            t for t in abiertas if (t.fecha_limite and t.fecha_limite <= hasta) or t.estado in ('en_revision', 'bloqueada')
        ]
        visibles.sort(key=lambda t: (t.fecha_limite is None, t.fecha_limite or fecha, t.titulo))
        salida.append({
            'persona': p,
            'conteos': conteos,
            'semaforo': _semaforo(conteos),
            'cumplimiento_7': cumplimiento(tareas, fecha, 7),
            'cumplimiento_30': cumplimiento(tareas, fecha, 30),
            'tareas': visibles + hechas_hoy,
        })
    orden = {'rojo': 0, 'amarillo': 1, 'verde': 2}
    salida.sort(key=lambda x: (orden[x['semaforo']], -x['conteos']['vencidas'], x['persona'].nombre))
    return salida
