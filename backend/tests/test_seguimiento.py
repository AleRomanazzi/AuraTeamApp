from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from apps.equipo.models import AsignacionTarea, Tarea

ART = ZoneInfo('America/Argentina/Buenos_Aires')
HOY = date(2026, 10, 7)


def _tarea(persona, titulo, fecha, estado='pendiente', hecha_el=None):
    t = Tarea.objects.create(titulo=titulo, fecha_limite=fecha, estado=estado)
    if hecha_el:
        Tarea.objects.filter(pk=t.pk).update(completada_en=datetime.combine(hecha_el, datetime.min.time(), ART) + timedelta(hours=12))
    AsignacionTarea.objects.create(persona=persona, tarea=t)
    return t


@pytest.mark.django_db
def test_seguimiento_por_persona(api_client, equipo_user, persona):
    _tarea(persona, 'Vencida', HOY - timedelta(days=2))
    _tarea(persona, 'De hoy', HOY)
    _tarea(persona, 'Pasado mañana', HOY + timedelta(days=2))
    _tarea(persona, 'Lejana', HOY + timedelta(days=10))
    _tarea(persona, 'A tiempo', HOY - timedelta(days=3), 'hecha', HOY - timedelta(days=4))
    _tarea(persona, 'Tarde', HOY - timedelta(days=5), 'hecha', HOY)

    r = api_client.get('/api/equipo/seguimiento/', {'fecha': HOY.isoformat()})
    assert r.status_code == 200, r.data
    [p] = r.data['personas']
    assert p['nombre'] == 'Lau' and p['roles'] == ['editor'] and p['semaforo'] == 'rojo'
    assert p['conteos'] == {'vencidas': 1, 'hoy': 1, 'proximas': 1, 'en_revision': 0, 'bloqueadas': 0, 'hechas_hoy': 1, 'sin_fecha': 0}
    # 3 con fecha en la semana: una a tiempo, una tarde y una vencida.
    assert p['cumplimiento_7'] == 33
    assert [t['titulo'] for t in p['tareas']] == ['Vencida', 'De hoy', 'Pasado mañana', 'Tarde']
    assert r.data['totales']['en_rojo'] == 1

    assert api_client.get('/api/equipo/seguimiento/', {'fecha': HOY.isoformat(), 'rol': 'cm'}).data['personas'] == []


@pytest.mark.django_db
def test_seguimiento_solo_admins(equipo_client):
    assert equipo_client.get('/api/equipo/seguimiento/').status_code == 403
