from datetime import date, time

import pytest

from apps.calendario import google_calendar
from apps.equipo.models import Tarea
from apps.notificaciones import email as correo
from apps.notificaciones.models import Notificacion


@pytest.fixture
def sin_sync(monkeypatch):
    monkeypatch.setattr('apps.integraciones.notion.al_guardar_tarea', lambda *a, **k: None)
    monkeypatch.setattr('apps.calendario.google_calendar.al_guardar_tarea', lambda *a, **k: None)


@pytest.fixture
def emails(monkeypatch):
    enviados = []
    monkeypatch.setattr(correo, 'enviar', lambda para, asunto, html, bcc=None: enviados.append((para, asunto)) or True)
    return enviados


def _crear(client, titulo, **extra):
    r = client.post('/api/tareas/', {'titulo': titulo, **extra}, format='json')
    assert r.status_code == 201, r.data
    return r.data


@pytest.mark.django_db
def test_nace_bloqueada_y_se_desbloquea_con_aviso_por_mail(api_client, sin_sync, emails, equipo_user, persona):
    equipo_user.email = 'lau@x.com'
    equipo_user.save()
    guion = _crear(api_client, 'Guion')
    grabacion = _crear(api_client, 'Grabación')
    edicion = _crear(api_client, 'Edición', depende_de=[guion['id'], grabacion['id']], asignados=[persona.id])
    assert edicion['estado'] == 'bloqueada' and edicion['bloqueo_auto'] and edicion['esperando']
    assert sorted(d['titulo'] for d in edicion['dependencias']) == ['Grabación', 'Guion']
    # El bloqueo automático no avisa a los admins como un problema.
    assert not Notificacion.objects.filter(tipo='tarea_estado').exists()

    api_client.patch(f'/api/tareas/{guion["id"]}/', {'estado': 'hecha'}, format='json')
    assert Tarea.objects.get(pk=edicion['id']).estado == 'bloqueada'

    api_client.patch(f'/api/tareas/{grabacion["id"]}/', {'estado': 'hecha'}, format='json')
    tarea = Tarea.objects.get(pk=edicion['id'])
    assert tarea.estado == 'pendiente' and not tarea.bloqueo_auto
    aviso = Notificacion.objects.get(tipo='tarea_disponible')
    assert aviso.usuario == equipo_user and aviso.email_enviado
    assert emails[-1] == ('lau@x.com', 'Ya podés arrancar: Edición')


@pytest.mark.django_db
def test_bloqueo_estricto(api_client, sin_sync):
    previa = _crear(api_client, 'Guion')
    tarea = _crear(api_client, 'Edición', depende_de=[previa['id']], subtareas=[{'titulo': 'Corte'}])
    for estado in ('en_curso', 'en_revision', 'hecha'):
        r = api_client.patch(f'/api/tareas/{tarea["id"]}/', {'estado': estado}, format='json')
        assert r.status_code == 400 and '«Guion»' in r.data['estado'][0]
    sub = tarea['subtareas'][0]['id']
    assert api_client.patch(f'/api/tareas/{tarea["id"]}/subtareas/{sub}/', {'hecha': True}, format='json').status_code == 400
    # Tampoco se puede crear avanzada ni sumarle una dependencia pendiente a una que ya avanzó.
    r = api_client.post('/api/tareas/', {'titulo': 'X', 'estado': 'en_curso', 'depende_de': [previa['id']]}, format='json')
    assert r.status_code == 400
    en_curso = _crear(api_client, 'Y', estado='en_curso')
    assert api_client.patch(f'/api/tareas/{en_curso["id"]}/', {'depende_de': [previa['id']]}, format='json').status_code == 400
    # Pasarla a Por hacer a mano la deja bloqueada igual; editar otros campos se puede.
    r = api_client.patch(f'/api/tareas/{tarea["id"]}/', {'estado': 'pendiente', 'titulo': 'Edición final'}, format='json')
    assert r.status_code == 200 and r.data['estado'] == 'bloqueada' and r.data['titulo'] == 'Edición final'


@pytest.mark.django_db
def test_sin_ciclos_ni_autodependencia(api_client, sin_sync):
    a = _crear(api_client, 'A')
    b = _crear(api_client, 'B', depende_de=[a['id']])
    c = _crear(api_client, 'C', depende_de=[b['id']])
    assert api_client.patch(f'/api/tareas/{a["id"]}/', {'depende_de': [a['id']]}, format='json').status_code == 400
    r = api_client.patch(f'/api/tareas/{a["id"]}/', {'depende_de': [c['id']]}, format='json')
    assert r.status_code == 400 and 'ciclo' in r.data['depende_de'][0]


@pytest.mark.django_db
def test_reabrir_la_previa_vuelve_a_bloquear_solo_las_por_hacer(api_client, sin_sync):
    previa = _crear(api_client, 'Guion')
    quieta = _crear(api_client, 'Edición', depende_de=[previa['id']])
    en_marcha = _crear(api_client, 'Música', depende_de=[previa['id']])
    api_client.patch(f'/api/tareas/{previa["id"]}/', {'estado': 'hecha'}, format='json')
    api_client.patch(f'/api/tareas/{en_marcha["id"]}/', {'estado': 'en_curso'}, format='json')

    api_client.patch(f'/api/tareas/{previa["id"]}/', {'estado': 'en_curso'}, format='json')
    assert Tarea.objects.get(pk=quieta['id']).estado == 'bloqueada'
    assert Tarea.objects.get(pk=en_marcha['id']).estado == 'en_curso'
    # Editar la que ya estaba en marcha no la bloquea.
    r = api_client.patch(f'/api/tareas/{en_marcha["id"]}/', {'titulo': 'Música v2'}, format='json')
    assert r.status_code == 200 and r.data['estado'] == 'en_curso'


@pytest.mark.django_db
def test_bloqueo_manual_no_se_desbloquea_solo(api_client, sin_sync):
    previa = _crear(api_client, 'Guion')
    tarea = _crear(api_client, 'Edición', estado='bloqueada', depende_de=[previa['id']])
    assert not tarea['bloqueo_auto']
    api_client.patch(f'/api/tareas/{previa["id"]}/', {'estado': 'hecha'}, format='json')
    assert Tarea.objects.get(pk=tarea['id']).estado == 'bloqueada'


@pytest.mark.django_db
def test_borrar_la_previa_desbloquea(api_client, sin_sync):
    previa = _crear(api_client, 'Guion')
    tarea = _crear(api_client, 'Edición', depende_de=[previa['id']])
    assert api_client.delete(f'/api/tareas/{previa["id"]}/').status_code == 204
    assert Tarea.objects.get(pk=tarea['id']).estado == 'pendiente'
    assert Notificacion.objects.filter(tipo='tarea_disponible').count() == 0  # el admin no está asignado ni la creó otro


@pytest.mark.django_db
def test_equipo_no_puede_depender_de_privadas(api_client, equipo_client, sin_sync):
    privada = _crear(api_client, 'Socios', etiqueta='ceos')
    r = equipo_client.post('/api/tareas/', {'titulo': 'Mía', 'depende_de': [privada['id']]}, format='json')
    assert r.status_code == 400


@pytest.mark.django_db
def test_rango_y_horario(api_client, sin_sync):
    t = _crear(api_client, 'Rodaje', fecha_inicio='2026-11-10', fecha_limite='2026-11-12', hora_inicio='09:00', hora_fin='18:30')
    assert t['hora_inicio'] == '09:00' and t['fecha_inicio'] == '2026-11-10'
    r = api_client.post('/api/tareas/', {'titulo': 'X', 'fecha_inicio': '2026-11-12', 'fecha_limite': '2026-11-10'}, format='json')
    assert r.status_code == 400 and 'fecha_inicio' in r.data
    r = api_client.post('/api/tareas/', {'titulo': 'X', 'fecha_limite': '2026-11-10', 'hora_inicio': '10:00', 'hora_fin': '09:00'}, format='json')
    assert r.status_code == 400 and 'hora_fin' in r.data
    r = api_client.post('/api/tareas/', {'titulo': 'X', 'fecha_inicio': '2026-11-09', 'fecha_limite': '2026-11-10', 'hora_inicio': '10:00'}, format='json')
    assert r.status_code == 400 and 'hora_fin' in r.data
    # Mismo día de inicio y fin queda como tarea de un día; sacar la fecha borra el rango y el horario.
    t = _crear(api_client, 'Reunión', fecha_inicio='2026-11-10', fecha_limite='2026-11-10', hora_inicio='15:00')
    assert t['fecha_inicio'] is None and t['hora_fin'] is None
    r = api_client.patch(f'/api/tareas/{t["id"]}/', {'fecha_limite': None}, format='json')
    assert r.data['hora_inicio'] is None


def test_evento_de_google_segun_horario():
    t = Tarea(titulo='Rodaje', fecha_limite=date(2026, 11, 12))
    assert google_calendar._horario_tarea(t) == ({'date': '2026-11-12'}, {'date': '2026-11-13'})
    t.fecha_inicio = date(2026, 11, 10)
    assert google_calendar._horario_tarea(t) == ({'date': '2026-11-10'}, {'date': '2026-11-13'})
    t.hora_inicio, t.hora_fin = time(9), time(18, 30)
    inicio, fin = google_calendar._horario_tarea(t)
    assert inicio['dateTime'] == '2026-11-10T09:00:00' and fin['dateTime'] == '2026-11-12T18:30:00'
    t.fecha_inicio, t.hora_fin = None, None
    inicio, fin = google_calendar._horario_tarea(t)
    assert inicio['dateTime'] == '2026-11-12T09:00:00' and fin['dateTime'] == '2026-11-12T10:00:00'
