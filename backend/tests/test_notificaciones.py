import pytest

from apps.equipo.models import Tarea
from apps.notificaciones import email as correo
from apps.notificaciones.models import Notificacion
from apps.notificaciones.services import notificar


@pytest.fixture
def emails(monkeypatch):
    enviados = []
    monkeypatch.setattr(correo, 'enviar', lambda para, asunto, html, bcc=None: enviados.append((para, asunto)) or True)
    return enviados


def _avisos(user):
    return list(Notificacion.objects.filter(usuario=user).values_list('tipo', 'titulo'))


@pytest.mark.django_db
def test_asignar_una_tarea_avisa_al_responsable_y_no_a_quien_la_crea(api_client, user, equipo_user, persona, emails):
    equipo_user.email = 'lau@x.com'
    equipo_user.save()
    r = api_client.post('/api/tareas/', {'titulo': 'Reel', 'asignados': [persona.id, ]}, format='json')
    assert r.status_code == 201, r.data
    assert _avisos(equipo_user) == [('tarea_asignada', 'Nueva tarea: Reel')]
    assert _avisos(user) == []
    assert emails == [('lau@x.com', 'Nueva tarea: Reel')]

    tid = r.data['id']
    api_client.patch(f'/api/tareas/{tid}/', {'titulo': 'Reel v2'}, format='json')
    assert len(_avisos(equipo_user)) == 1


@pytest.mark.django_db
def test_sin_preferencia_de_email_solo_campana(api_client, equipo_user, persona, emails):
    equipo_user.email, equipo_user.notif_email = 'lau@x.com', False
    equipo_user.save()
    api_client.post('/api/tareas/', {'titulo': 'Reel', 'asignados': [persona.id]}, format='json')
    assert len(_avisos(equipo_user)) == 1 and emails == []


@pytest.mark.django_db
def test_en_revision_avisa_a_los_admins(api_client, user, equipo_client, equipo_user, persona, emails):
    r = api_client.post('/api/tareas/', {'titulo': 'Edición', 'asignados': [persona.id]}, format='json')
    equipo_client.patch(f"/api/tareas/{r.data['id']}/", {'estado': 'en_revision'}, format='json')
    assert ('tarea_estado', '«Edición» pasó a revisión') in _avisos(user)
    equipo_client.patch(f"/api/tareas/{r.data['id']}/", {'estado': 'hecha'}, format='json')
    assert ('tarea_hecha', 'Terminada: Edición') in _avisos(user)
    assert not [a for a in _avisos(equipo_user) if a[0] != 'tarea_asignada']


@pytest.mark.django_db
def test_las_tareas_privadas_no_avisan_al_equipo(api_client, equipo_user, persona, emails):
    api_client.post('/api/tareas/', {'titulo': 'Socios', 'etiqueta': 'ceos', 'asignados': [persona.id]}, format='json')
    assert _avisos(equipo_user) == []


@pytest.mark.django_db
def test_plan_del_mes_un_solo_aviso_por_persona(api_client, equipo_user, persona, emails):
    from apps.clientes.models import Cliente

    c = Cliente.objects.create(nombre='Lennon')
    tareas = [{'titulo': f'Posteo {i}', 'fecha_limite': f'2026-10-{i + 10}', 'asignados': [persona.id]} for i in range(3)]
    r = api_client.post('/api/tareas/plan/', {'cliente': c.id, 'tareas': tareas}, format='json')
    assert r.status_code == 201, r.data
    assert _avisos(equipo_user) == [('tarea_asignada', 'Te asignaron 3 tareas de Lennon (plan del mes)')]


@pytest.mark.django_db
def test_clave_no_repite_y_api_de_la_campana(equipo_client, equipo_user):
    t = Tarea.objects.create(titulo='X')
    assert notificar([equipo_user], 'deadline_hoy', 'Vence hoy: X', tarea=t, clave='hoy:1') == 1
    assert notificar([equipo_user], 'deadline_hoy', 'Vence hoy: X', tarea=t, clave='hoy:1') == 0
    notificar([equipo_user], 'sistema', 'Otra')
    r = equipo_client.get('/api/notificaciones/')
    assert r.data['no_leidas'] == 2 and [n['titulo'] for n in r.data['resultados']] == ['Otra', 'Vence hoy: X']
    nid = r.data['resultados'][0]['id']
    assert equipo_client.post(f'/api/notificaciones/{nid}/leer/').data['no_leidas'] == 1
    assert equipo_client.post('/api/notificaciones/leer-todas/').data['no_leidas'] == 0


@pytest.mark.django_db
def test_cada_uno_ve_solo_sus_notificaciones(api_client, user, equipo_user):
    notificar([equipo_user], 'sistema', 'Para Lau')
    assert api_client.get('/api/notificaciones/').data['resultados'] == []
    n = Notificacion.objects.get()
    api_client.post(f'/api/notificaciones/{n.id}/leer/')
    n.refresh_from_db()
    assert n.leida_en is None


@pytest.mark.django_db
def test_preferencia_de_email_en_el_perfil(equipo_client, equipo_user):
    r = equipo_client.put('/api/me/config/', {'notif_email': False}, format='json')
    assert r.status_code == 200 and r.data['notif_email'] is False
