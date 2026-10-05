from datetime import date, timedelta

import pytest

from apps.accounts.google import GoogleError
from apps.clientes.models import Cliente, PasoOnboarding
from apps.core.utils import today
from apps.equipo.models import AsignacionCliente, Persona, Tarea
from apps.integraciones import drive
from apps.notificaciones.models import Notificacion


@pytest.fixture
def drive_ok(monkeypatch):
    creadas = []

    def crear(cliente):
        creadas.append(cliente.nombre)
        cliente.drive_folder_id = 'carpeta123'
        cliente.save(update_fields=['drive_folder_id'])
        return cliente.drive_url

    monkeypatch.setattr(drive, 'crear_carpeta_cliente', crear)
    return creadas


@pytest.fixture
def drive_falla(monkeypatch):
    def crear(cliente):
        raise GoogleError('Google Drive no da permiso')

    monkeypatch.setattr(drive, 'crear_carpeta_cliente', crear)


@pytest.mark.django_db
def test_plantilla_base_cargada():
    pasos = list(PasoOnboarding.objects.values_list('rol', 'accion'))
    assert len(pasos) == 6 and ('admin', 'drive') in pasos


@pytest.mark.django_db
def test_crear_cliente_inicia_onboarding_con_responsables_por_rol(api_client, user, equipo_user, persona, drive_ok):
    socio = Persona.objects.create(nombre='Ale')
    user.persona = socio
    user.save()
    equipo_user.roles = ['cm']
    equipo_user.save()
    r = api_client.post('/api/clientes/', {'nombre': 'Café Roma', 'fecha_alta': today().isoformat()}, format='json')
    assert r.status_code == 201, r.data
    cliente = Cliente.objects.get(pk=r.data['id'])
    tareas = Tarea.objects.filter(cliente=cliente, onboarding=True)
    assert tareas.count() == 6
    # Sin asignación al cliente todavía: los pasos de CM quedan sin responsable; los de socios, para quien lo creó.
    assert not tareas.get(titulo__startswith='Pedir accesos').asignaciones.exists()
    reunion = tareas.get(titulo__startswith='Reunión inicial')
    assert list(reunion.asignaciones.values_list('persona_id', flat=True)) == [socio.id]
    assert reunion.fecha_limite == today() + timedelta(days=3)

    paso_drive = tareas.get(paso_onboarding__accion='drive')
    assert paso_drive.estado == 'hecha' and paso_drive.links == [{'titulo': 'Carpeta de Drive', 'url': 'https://drive.google.com/drive/folders/carpeta123'}]
    assert drive_ok == ['Café Roma']

    prog = api_client.get(f'/api/clientes/{cliente.id}/onboarding/').data
    assert prog['total'] == 6 and prog['hechas'] == 1 and prog['drive_url'].endswith('carpeta123')
    assert api_client.post(f'/api/clientes/{cliente.id}/onboarding/', {}, format='json').status_code == 400


@pytest.mark.django_db
def test_onboarding_usa_la_asignacion_del_cliente_y_avisa(api_client, equipo_user, persona, drive_ok):
    equipo_user.roles = ['cm']
    equipo_user.save()
    cliente = Cliente.objects.create(nombre='Lumen', fecha_alta=date(2020, 1, 1))
    AsignacionCliente.objects.create(persona=persona, cliente=cliente, rol='Community')
    r = api_client.post(f'/api/clientes/{cliente.id}/onboarding/', {}, format='json')
    assert r.status_code == 200, r.data
    accesos = Tarea.objects.get(cliente=cliente, titulo__startswith='Pedir accesos')
    assert list(accesos.asignaciones.values_list('persona_id', flat=True)) == [persona.id]
    # El alta ya pasó: las fechas se cuentan desde hoy.
    assert accesos.fecha_limite == today() + timedelta(days=1)
    assert Notificacion.objects.filter(usuario=equipo_user, titulo__startswith='Te asignaron 4 tareas').exists()


@pytest.mark.django_db
def test_si_drive_falla_el_paso_queda_manual_y_el_cliente_se_crea(api_client, drive_falla):
    r = api_client.post('/api/clientes/', {'nombre': 'Norte'}, format='json')
    assert r.status_code == 201
    paso = Tarea.objects.get(cliente_id=r.data['id'], paso_onboarding__accion='drive')
    assert paso.estado == 'pendiente' and 'Creala a mano' in paso.descripcion
    assert api_client.post(f'/api/clientes/{r.data["id"]}/drive/').status_code == 502


@pytest.mark.django_db
def test_sin_onboarding_si_se_pide(api_client):
    r = api_client.post('/api/clientes/', {'nombre': 'Sur', 'onboarding': False}, format='json')
    assert not Tarea.objects.filter(cliente_id=r.data['id']).exists()


@pytest.mark.django_db
def test_onboarding_atrasado_en_equipo_hoy(api_client, drive_ok):
    cliente = Cliente.objects.create(nombre='Lumen')
    Tarea.objects.create(titulo='Brief', cliente=cliente, onboarding=True, fecha_limite=today() - timedelta(days=2))
    Tarea.objects.create(titulo='Accesos', cliente=cliente, onboarding=True, fecha_limite=today() - timedelta(days=2), estado='hecha')
    d = api_client.get('/api/equipo/seguimiento/').data
    assert d['onboarding_atrasado'] == [{'cliente': cliente.id, 'nombre': 'Lumen', 'total': 2, 'hechas': 1, 'vencidas': 1}]


@pytest.mark.django_db
def test_plantilla_editable_solo_por_admins(api_client, equipo_client):
    assert equipo_client.get('/api/onboarding-pasos/').status_code == 403
    r = api_client.post('/api/onboarding-pasos/', {'titulo': 'Sesión de fotos', 'rol': 'foto', 'dias_desde_alta': 10, 'etiqueta': 'coberturas'}, format='json')
    assert r.status_code == 201, r.data


@pytest.mark.django_db
def test_drive_crea_la_estructura(monkeypatch, settings):
    from apps.accounts import google

    settings.GOOGLE_CALENDAR_SOLO_LECTURA = False
    monkeypatch.setattr(google, 'access_token', lambda: {'access_token': 'x'})
    llamadas = []

    def request(method, params=None, body=None):
        llamadas.append((method, body and body['name']))
        return {'files': []} if method == 'GET' else {'id': f'id-{len(llamadas)}'}

    monkeypatch.setattr(drive, '_request', request)
    cliente = Cliente.objects.create(nombre='Lumen')
    url = drive.crear_carpeta_cliente(cliente)
    creadas = [n for m, n in llamadas if m == 'POST']
    assert creadas == ['AuraTeam', 'Clientes', 'Lumen', 'Brief', 'Material crudo', 'Ediciones', 'Diseños', 'Reportes']
    assert url.startswith('https://drive.google.com/drive/folders/id-')
