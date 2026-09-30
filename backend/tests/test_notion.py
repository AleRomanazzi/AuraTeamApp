import hashlib
import hmac
import json
import uuid

import httpx
import pytest

from apps.clientes.models import Cliente
from apps.equipo.models import Persona, Tarea
from apps.integraciones import notion
from apps.integraciones.models import EstadoNotion

TAREAS_DS = 'b67f1243-7f10-480c-bb2e-158c7fd75196'
CLIENTES_DS = '4f207fc3-c612-4a54-959b-773e4a71b949'
UID_LAU = str(uuid.uuid4())


def _leer(nombre, valor):
    """Convierte una propiedad en formato de escritura al formato que devuelve la API al leer."""
    tipo = next(iter(valor))
    v = valor[tipo]
    if tipo in ('title', 'rich_text'):
        v = [{'type': 'text', 'plain_text': t['text']['content']} for t in v]
    return {'id': nombre, 'type': tipo, tipo: v}


class NotionFalso:
    def __init__(self):
        self.paginas = {}
        self.llamadas = []

    def agregar(self, ds, props, in_trash=False):
        pid = str(uuid.uuid4())
        self.paginas[pid] = {
            'id': pid,
            'parent': {'type': 'data_source_id', 'data_source_id': ds},
            'in_trash': in_trash,
            'properties': {k: _leer(k, v) for k, v in props.items()},
        }
        return pid

    def __call__(self, method, url, headers=None, json=None, params=None, timeout=None):
        path = url.removeprefix(notion.API)
        self.llamadas.append((method, path, json))
        if method == 'POST' and path.startswith('/data_sources/'):
            ds = path.split('/')[2]
            res = [p for p in self.paginas.values() if p['parent']['data_source_id'] == ds and not p['in_trash']]
            return httpx.Response(200, json={'results': res, 'has_more': False})
        if method == 'POST' and path == '/pages':
            pid = self.agregar(json['parent']['data_source_id'], json['properties'])
            return httpx.Response(200, json=self.paginas[pid])
        if path.startswith('/pages/'):
            pid = str(uuid.UUID(path.split('/')[2]))
            page = self.paginas.get(pid)
            if page is None:
                return httpx.Response(404, json={'message': 'no'})
            if method == 'PATCH':
                page['in_trash'] = json.get('in_trash', page['in_trash'])
                for k, v in (json.get('properties') or {}).items():
                    page['properties'][k] = _leer(k, v)
            return httpx.Response(200, json=page)
        if path == '/users':
            return httpx.Response(200, json={'results': [{'id': UID_LAU, 'type': 'person', 'name': 'Lautaro Fuentes', 'person': {'email': 'l@x.com'}}], 'has_more': False})
        raise AssertionError(f'Llamada inesperada {method} {path}')


def _props_tarea(titulo, estado='Por hacer', cliente=None, personas=()):
    return {
        'Tarea': {'title': [{'text': {'content': titulo}}]},
        'Notas': {'rich_text': []},
        'Estado': {'select': {'name': estado}},
        'Prioridad': {'select': {'name': 'Alta'}},
        'Fecha': {'date': {'start': '2026-10-05'}},
        'Cliente': {'relation': [{'id': cliente}] if cliente else []},
        'Responsable': {'people': [{'id': u} for u in personas]},
    }


@pytest.fixture
def falso(settings, monkeypatch):
    settings.NOTION_TOKEN = 'ntn_test'
    settings.NOTION_TAREAS_DS = TAREAS_DS
    settings.NOTION_CLIENTES_DS = CLIENTES_DS
    f = NotionFalso()
    monkeypatch.setattr(httpx, 'request', f)
    return f


@pytest.mark.django_db
def test_crear_editar_y_borrar_en_el_panel_se_refleja_en_notion(api_client, falso, persona):
    persona.notion_user_id = UID_LAU
    persona.save()
    r = api_client.post('/api/tareas/', {'titulo': 'Grilla de octubre', 'estado': 'bloqueada', 'asignados': [persona.id]}, format='json')
    assert r.status_code == 201 and r.data['notion_url']
    tarea = Tarea.objects.get()
    page = falso.paginas[tarea.notion_page_id]
    assert page['properties']['Estado']['select']['name'] == 'Bloqueada'
    assert page['properties']['Responsable']['people'] == [{'id': UID_LAU}]

    api_client.patch(f'/api/tareas/{tarea.id}/', {'estado': 'en_revision'}, format='json')
    assert page['properties']['Estado']['select']['name'] == 'En revisión'

    api_client.delete(f'/api/tareas/{tarea.id}/')
    assert page['in_trash'] is True


@pytest.mark.django_db
def test_sincronizacion_completa_vincula_y_trae_de_notion(api_client, falso, persona):
    Cliente.objects.create(nombre='Cycles Ferreyra')
    cid = falso.agregar(CLIENTES_DS, {'Cliente': {'title': [{'text': {'content': 'CyclesFerreyra'}}]}})
    falso.agregar(CLIENTES_DS, {'Cliente': {'title': [{'text': {'content': 'Solo Notion'}}]}})
    falso.agregar(TAREAS_DS, _props_tarea('Rodaje en La Rioja', 'En progreso', cliente=cid, personas=[UID_LAU]))
    existente = Tarea.objects.create(titulo='Reel de lanzamiento')
    falso.agregar(TAREAS_DS, _props_tarea('Reel de lanzamiento', 'Hecha'))
    Tarea.objects.create(titulo='Solo en el panel')

    r = api_client.post('/api/notion/sincronizar/', {'completa': True}, format='json')
    assert r.status_code == 200, r.data
    assert r.data['clientes']['vinculados'] == 1 and r.data['clientes']['solo_en_notion'] == ['Solo Notion']
    assert r.data['personas_vinculadas'] == 1
    assert (r.data['creadas'], r.data['vinculadas'], r.data['enviadas']) == (1, 1, 1)

    rodaje = Tarea.objects.get(titulo='Rodaje en La Rioja')
    assert rodaje.estado == 'en_curso' and rodaje.prioridad == 'alta' and str(rodaje.fecha_limite) == '2026-10-05'
    assert rodaje.cliente.nombre == 'Cycles Ferreyra'
    assert list(rodaje.asignaciones.values_list('persona_id', flat=True)) == [persona.id]
    existente.refresh_from_db()
    assert existente.estado == 'hecha' and existente.completada_en is not None
    assert Tarea.objects.get(titulo='Solo en el panel').notion_page_id in falso.paginas

    # Una segunda pasada no reaplica nada (huellas iguales).
    assert api_client.post('/api/notion/sincronizar/', {'completa': True}, format='json').data['actualizadas'] == 0


@pytest.mark.django_db
def test_incremental_se_limita_y_la_puede_pedir_el_equipo(equipo_client, falso):
    falso.agregar(TAREAS_DS, _props_tarea('Algo'))
    assert equipo_client.post('/api/notion/sincronizar/', {'completa': True}, format='json').data['creadas'] == 1
    assert EstadoNotion.get().ultima_sync_completa is None
    assert equipo_client.post('/api/notion/sincronizar/').data == {'omitida': True}


@pytest.mark.django_db
def test_webhook_verificacion_firma_y_evento(client, falso):
    assert client.post('/api/notion/webhook/', {'verification_token': 'secret_abc'}, content_type='application/json').status_code == 200
    assert EstadoNotion.get().webhook_token == 'secret_abc'
    assert client.post('/api/notion/webhook/', {'verification_token': 'otro'}, content_type='application/json').status_code == 409

    pid = falso.agregar(TAREAS_DS, _props_tarea('Desde Notion'))
    cuerpo = json.dumps({'type': 'page.created', 'entity': {'id': pid, 'type': 'page'}}).encode()
    assert client.post('/api/notion/webhook/', cuerpo, content_type='application/json', HTTP_X_NOTION_SIGNATURE='sha256=mal').status_code == 401
    firma = 'sha256=' + hmac.new(b'secret_abc', cuerpo, hashlib.sha256).hexdigest()
    assert client.post('/api/notion/webhook/', cuerpo, content_type='application/json', HTTP_X_NOTION_SIGNATURE=firma).status_code == 200
    assert Tarea.objects.get().titulo == 'Desde Notion'

    falso.paginas[pid]['in_trash'] = True
    cuerpo = json.dumps({'type': 'page.deleted', 'entity': {'id': pid, 'type': 'page'}}).encode()
    firma = 'sha256=' + hmac.new(b'secret_abc', cuerpo, hashlib.sha256).hexdigest()
    client.post('/api/notion/webhook/', cuerpo, content_type='application/json', HTTP_X_NOTION_SIGNATURE=firma)
    assert not Tarea.objects.exists()


@pytest.mark.django_db
def test_si_notion_falla_la_tarea_se_guarda_igual(api_client, settings, monkeypatch):
    settings.NOTION_TOKEN = 'ntn_test'

    def caido(*a, **k):
        raise httpx.ConnectError('sin red')

    monkeypatch.setattr(httpx, 'request', caido)
    assert api_client.post('/api/tareas/', {'titulo': 'Offline'}, format='json').status_code == 201
    assert Tarea.objects.get().notion_page_id is None
    assert 'No se pudo contactar a Notion' in EstadoNotion.get().ultimo_error


@pytest.mark.django_db
def test_sin_token_no_llama_a_notion(api_client, monkeypatch):
    monkeypatch.setattr(httpx, 'request', lambda *a, **k: pytest.fail('no debería llamar'))
    assert api_client.post('/api/tareas/', {'titulo': 'Local'}, format='json').status_code == 201
    assert api_client.post('/api/notion/sincronizar/').data['omitida'] is True
    assert Persona.objects.count() == 0
