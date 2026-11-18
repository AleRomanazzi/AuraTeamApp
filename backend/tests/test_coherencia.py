"""Comentarios e historial de tareas, cambios en lote, plantillas y permisos por rol editables."""

from datetime import date

import pytest

from apps.equipo.models import ActividadTarea, AsignacionTarea, Persona, PlantillaTarea, Tarea
from apps.notificaciones.models import Notificacion


@pytest.fixture
def tarea(db, persona):
    t = Tarea.objects.create(titulo='Reel de lanzamiento')
    AsignacionTarea.objects.create(persona=persona, tarea=t)
    return t


@pytest.mark.django_db
def test_los_cambios_quedan_en_el_historial(api_client, tarea):
    caro = Persona.objects.create(nombre='Caro')
    r = api_client.patch(
        f'/api/tareas/{tarea.id}/', {'estado': 'en_curso', 'fecha_limite': '2026-12-01', 'asignados': [caro.id]}, format='json'
    )
    assert r.status_code == 200, r.data
    textos = [i['texto'] for i in api_client.get(f'/api/tareas/{tarea.id}/historial/').data]
    assert 'Pasó de Por hacer a En progreso' in textos
    assert 'Cambió la fecha límite: sin fecha → 01/12/2026' in textos
    assert 'Asignó a Caro' in textos and 'Quitó a Lau' in textos


@pytest.mark.django_db
def test_crear_registra_y_el_checklist_tambien(api_client):
    r = api_client.post('/api/tareas/', {'titulo': 'Guion', 'subtareas': [{'titulo': 'Idea', 'hecha': False}]}, format='json')
    tid = r.data['id']
    sub = r.data['subtareas'][0]['id']
    api_client.patch(f'/api/tareas/{tid}/subtareas/{sub}/', {'hecha': True}, format='json')
    textos = list(ActividadTarea.objects.filter(tarea_id=tid).values_list('texto', flat=True))
    assert textos[0] == 'Creó la tarea' and 'Tildó «Idea»' in textos and 'Pasó a Hecha por el checklist' in textos


@pytest.mark.django_db
def test_comentar_avisa_a_los_responsables(equipo_client, api_client, tarea, equipo_user, user):
    r = api_client.post(f'/api/tareas/{tarea.id}/comentarios/', {'texto': 'Falta el logo al final'}, format='json')
    assert r.status_code == 201
    aviso = Notificacion.objects.get(usuario=equipo_user, tipo='tarea_comentario')
    assert aviso.cuerpo == 'Falta el logo al final' and not Notificacion.objects.filter(usuario=user).exists()

    # Cualquiera que ve la tarea comenta; borrar, solo el autor (o un admin).
    otra = Tarea.objects.create(titulo='Ajena', cliente=None, user=user)
    assert equipo_client.post(f'/api/tareas/{otra.id}/comentarios/', {'texto': 'Ok'}, format='json').status_code == 201
    cid = r.data['id']
    assert equipo_client.delete(f'/api/tareas/{tarea.id}/comentarios/{cid}/').status_code == 403
    items = equipo_client.get(f'/api/tareas/{tarea.id}/historial/').data
    assert [i['tipo'] for i in items] == ['comentario'] and items[0]['propio'] is False
    assert api_client.delete(f'/api/tareas/{tarea.id}/comentarios/{cid}/').status_code == 204
    assert api_client.post(f'/api/tareas/{tarea.id}/comentarios/', {'texto': '  '}, format='json').status_code == 400


@pytest.mark.django_db
def test_lote_cambia_varias_y_reporta_las_que_no_puede(equipo_client, api_client, tarea, persona, clientes_dos):
    propia = tarea
    ajena = Tarea.objects.create(titulo='De otro', cliente=clientes_dos)
    r = equipo_client.post('/api/tareas/lote/', {'ids': [propia.id, ajena.id], 'cambios': {'prioridad': 'alta'}}, format='json')
    assert r.data['hechas'] == 1 and [e['id'] for e in r.data['errores']] == [ajena.id]
    propia.refresh_from_db()
    assert propia.prioridad == 'alta'

    caro = Persona.objects.create(nombre='Caro')
    r = api_client.post(
        '/api/tareas/lote/', {'ids': [propia.id, ajena.id], 'cambios': {'agregar': [caro.id], 'fecha_limite': '2026-12-05'}}, format='json'
    )
    assert r.data == {'hechas': 2, 'errores': []}
    assert set(propia.asignaciones.values_list('persona_id', flat=True)) == {persona.id, caro.id}
    assert Tarea.objects.get(pk=ajena.id).fecha_limite == date(2026, 12, 5)

    assert equipo_client.post('/api/tareas/lote/', {'ids': [propia.id], 'borrar': True}, format='json').status_code == 403
    assert api_client.post('/api/tareas/lote/', {'ids': [propia.id], 'cambios': {'titulo': 'x'}}, format='json').status_code == 400
    assert api_client.post('/api/tareas/lote/', {'ids': [propia.id, ajena.id], 'borrar': True}, format='json').data['hechas'] == 2
    assert not Tarea.objects.exists()


@pytest.fixture
def clientes_dos(db):
    from apps.clientes.models import Cliente

    return Cliente.objects.create(nombre='Lennon')


@pytest.mark.django_db
def test_plantillas_las_ve_el_equipo_y_las_edita_un_admin(api_client, equipo_client, persona):
    body = {'nombre': 'Reel', 'titulo': 'Reel', 'etiqueta': 'edicion', 'subtareas': ['Guion', ' ', 'Edición'], 'personas': [persona.id], 'dias_plazo': 3}
    r = api_client.post('/api/plantillas-tarea/', body, format='json')
    assert r.status_code == 201, r.data
    assert r.data['subtareas'] == ['Guion', 'Edición']
    assert [p['nombre'] for p in equipo_client.get('/api/plantillas-tarea/').data] == ['Reel']
    assert equipo_client.post('/api/plantillas-tarea/', body, format='json').status_code == 403
    PlantillaTarea.objects.create(nombre='Socios', etiqueta='ceos')
    assert [p['nombre'] for p in equipo_client.get('/api/plantillas-tarea/').data] == ['Reel']


@pytest.mark.django_db
def test_permisos_por_rol_editables(api_client, cm_client, equipo_client):
    assert cm_client.get('/api/auth/me/').data['permisos'] == ['clientes', 'estadisticas', 'plan_tareas']
    assert equipo_client.get('/api/auth/me/').data['permisos'] == []
    actual = api_client.get('/api/auth/permisos/').data
    assert actual['por_rol']['cm'] == ['clientes', 'estadisticas', 'plan_tareas']

    r = api_client.put('/api/auth/permisos/', {'por_rol': {'cm': ['estadisticas'], 'editor': ['clientes']}}, format='json')
    assert r.status_code == 200 and r.data['por_rol']['editor'] == ['clientes']
    assert cm_client.get('/api/auth/me/').data['permisos'] == ['estadisticas']
    assert cm_client.get('/api/stats/').status_code == 200
    assert equipo_client.get('/api/auth/me/').data['permisos'] == ['clientes']

    assert api_client.put('/api/auth/permisos/', {'por_rol': {'cm': ['todo']}}, format='json').status_code == 400
    assert cm_client.get('/api/auth/permisos/').status_code == 403
