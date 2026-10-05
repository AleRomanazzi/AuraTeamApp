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


@pytest.fixture
def drive_falso(monkeypatch, settings):
    """Mi unidad con CLIENTES → «Café Roma» y «Lumen Estudio»."""
    from apps.accounts.models import CuentaGoogle

    settings.GOOGLE_CALENDAR_SOLO_LECTURA = False
    settings.DRIVE_CARPETA_CLIENTES = ''
    CuentaGoogle.objects.create(email='agencia@x.com', refresh_token='x', scopes=f'https://www.googleapis.com/auth/calendar {drive.SCOPE}')
    arbol = {'root': [{'id': 'raiz', 'name': 'Clientes'}, {'id': 'otra', 'name': 'Varios'}], 'raiz': [{'id': 'c1', 'name': 'Café Roma'}, {'id': 'c2', 'name': 'LUMEN  estudio'}]}
    creadas = []

    def request(method, params=None, body=None):
        if method == 'GET':
            padre = params['q'].split("'")[-2]
            return {'files': arbol.get(padre, [])}
        creadas.append((body['name'], body['parents']))
        return {'id': 'nueva'}

    monkeypatch.setattr(drive, '_request', request)
    return creadas


@pytest.mark.django_db
def test_drive_vincula_la_carpeta_existente_sin_crear(drive_falso):
    cliente = Cliente.objects.create(nombre='Cafe roma')
    assert drive.crear_carpeta_cliente(cliente).endswith('/c1')
    assert drive_falso == []


@pytest.mark.django_db
def test_drive_crea_dentro_de_clientes_si_no_existe(drive_falso):
    cliente = Cliente.objects.create(nombre='Nuevo Bar')
    assert drive.crear_carpeta_cliente(cliente).endswith('/nueva')
    assert drive_falso == [('Nuevo Bar', ['raiz'])]


@pytest.mark.django_db
def test_drive_sin_permiso_completo_no_crea_nada(drive_falso):
    from apps.accounts.models import CuentaGoogle

    CuentaGoogle.objects.update(scopes='https://www.googleapis.com/auth/drive.file')
    with pytest.raises(GoogleError):
        drive.crear_carpeta_cliente(Cliente.objects.create(nombre='Nuevo Bar'))
    assert drive_falso == []


@pytest.mark.django_db
def test_vincular_drive_masivo_nunca_crea(api_client, drive_falso):
    Cliente.objects.create(nombre='Café Roma')
    Cliente.objects.create(nombre='Lumen', razon_social='Lumen Estudio')
    Cliente.objects.create(nombre='Sin carpeta')
    r = api_client.post('/api/clientes/vincular-drive/')
    assert r.status_code == 200, r.data
    assert r.data == {'vinculados': ['Café Roma', 'Lumen'], 'sin_carpeta': ['Sin carpeta']}
    assert drive_falso == []
    assert Cliente.objects.get(nombre='Lumen').drive_folder_id == 'c2'


@pytest.mark.django_db
def test_pegar_link_de_carpeta_cierra_el_paso(api_client, drive_falla):
    r = api_client.post('/api/clientes/', {'nombre': 'Café Roma'}, format='json')
    cid = r.data['id']
    link = 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing'
    r = api_client.post(f'/api/clientes/{cid}/drive/', {'link': link}, format='json')
    assert r.status_code == 200 and r.data['drive_url'].endswith('/1AbCdEfGhIjKlMn')
    assert Tarea.objects.get(cliente_id=cid, paso_onboarding__accion='drive').estado == 'hecha'
    assert api_client.post(f'/api/clientes/{cid}/drive/', {'link': 'cualquier cosa'}, format='json').status_code == 400
    assert api_client.post(f'/api/clientes/{cid}/drive/', {'link': ''}, format='json').data['drive_url'] == ''
