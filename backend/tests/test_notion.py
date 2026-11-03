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
BOT = str(uuid.uuid4())


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
        self.bloques = {}
        self.llamadas = []
        self.al_crear = None

    def agregar(self, ds, props, in_trash=False, autor=UID_LAU):
        pid = str(uuid.uuid4())
        self.paginas[pid] = {
            'id': pid,
            'parent': {'type': 'data_source_id', 'data_source_id': ds},
            'created_by': {'object': 'user', 'id': autor},
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
            pid = self.agregar(json['parent']['data_source_id'], json['properties'], autor=BOT)
            if self.al_crear:
                self.al_crear(self.paginas[pid])
            return httpx.Response(200, json=self.paginas[pid])
        if path == '/users/me':
            return httpx.Response(200, json={'object': 'user', 'id': BOT, 'type': 'bot'})
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
        if path.startswith('/blocks/'):
            partes = path.strip('/').split('/')
            bid = str(uuid.UUID(partes[1]))
            if partes[-1] == 'children':
                if method == 'GET':
                    res = [b for b in self.bloques.get(bid, []) if not b.get('in_trash')]
                    return httpx.Response(200, json={'results': res, 'has_more': False})
                if method != 'PATCH':
                    return httpx.Response(400, json={'message': 'Invalid request URL.'})
                creados = []
                for child in (json or {}).get('children') or []:
                    nuevo = str(uuid.uuid4())
                    bloque = {'id': nuevo, 'type': child.get('type'), 'in_trash': False, 'to_do': child.get('to_do') or {}}
                    self.bloques.setdefault(bid, []).append(bloque)
                    creados.append(bloque)
                return httpx.Response(200, json={'results': creados, 'has_more': False})
            if method == 'PATCH':
                for lista in self.bloques.values():
                    for bloque in lista:
                        if bloque['id'] == bid:
                            if json.get('in_trash'):
                                bloque['in_trash'] = True
                            if json.get('to_do'):
                                bloque['to_do'] = json['to_do']
                            return httpx.Response(200, json=bloque)
                return httpx.Response(404, json={'message': 'no'})
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
def test_cliente_vinculado_despues_actualiza_tareas_de_ambos_lados(api_client, falso):
    lennon = Cliente.objects.create(nombre='Redes Lennon')
    cid = falso.agregar(CLIENTES_DS, {'Cliente': {'title': [{'text': {'content': 'Lennon'}}]}})
    falso.agregar(TAREAS_DS, _props_tarea('Grilla Lennon', cliente=cid))
    del_panel = Tarea.objects.create(titulo='Reel Lennon', cliente=lennon)

    r = api_client.post('/api/notion/sincronizar/', {'completa': True}, format='json')
    assert r.data['clientes']['solo_en_panel'] == ['Redes Lennon']
    del_panel.refresh_from_db()
    assert del_panel.cliente == lennon
    assert falso.paginas[del_panel.notion_page_id]['properties']['Cliente']['relation'] == []
    assert Tarea.objects.get(titulo='Grilla Lennon').cliente is None

    lennon.nombre = 'Lennon'
    lennon.save()
    r = api_client.post('/api/notion/sincronizar/', {'completa': True}, format='json')
    assert r.data['clientes']['vinculados'] == 1
    assert falso.paginas[del_panel.notion_page_id]['properties']['Cliente']['relation'] == [{'id': cid}]
    assert Tarea.objects.get(titulo='Grilla Lennon').cliente == lennon
    del_panel.refresh_from_db()
    assert del_panel.cliente == lennon


@pytest.mark.django_db
def test_vincular_persona_a_mano_reenvia_sus_tareas(api_client, falso, persona):
    r = api_client.post('/api/tareas/', {'titulo': 'Edición', 'asignados': [persona.id]}, format='json')
    page = falso.paginas[Tarea.objects.get(pk=r.data['id']).notion_page_id]
    assert page['properties']['Responsable']['people'] == []
    assert api_client.patch(f'/api/personal/{persona.id}/', {'notion_user_id': UID_LAU}, format='json').status_code == 200
    assert page['properties']['Responsable']['people'] == [{'id': UID_LAU}]


@pytest.mark.django_db
def test_incremental_se_limita_y_la_puede_pedir_el_equipo(equipo_client, falso):
    falso.agregar(TAREAS_DS, _props_tarea('Algo'))
    assert equipo_client.post('/api/notion/sincronizar/', {'completa': True}, format='json').data['creadas'] == 1
    assert EstadoNotion.get().ultima_sync_completa is None
    assert equipo_client.post('/api/notion/sincronizar/').data == {'omitida': True}


@pytest.mark.django_db
def test_el_eco_del_webhook_no_duplica_la_tarea(api_client, falso, persona):
    # El webhook de la página recién creada llega antes de que el panel guarde el vínculo.
    falso.al_crear = lambda page: notion.aplicar_pagina(page)
    api_client.post('/api/tareas/', {'titulo': 'Historia'}, format='json')
    assert Tarea.objects.count() == 1 and Tarea.objects.get().notion_page_id

    # Y si igual se coló un eco (p. ej. creado antes de este arreglo), se descarta al vincular.
    falso.al_crear = lambda page: Tarea.objects.create(titulo='Eco', notion_page_id=notion._norm(page['id']))
    api_client.post('/api/tareas/', {'titulo': 'Otra'}, format='json')
    assert sorted(Tarea.objects.values_list('titulo', flat=True)) == ['Historia', 'Otra']


@pytest.mark.django_db
def test_las_recurrentes_llegan_a_notion_de_a_tandas(api_client, falso, persona, monkeypatch):
    monkeypatch.setattr(notion, 'LIMITE_ENVIO', 2)
    r = api_client.post('/api/tareas-recurrentes/', {'titulo': 'Historia', 'dias': list(range(7)), 'personas': [persona.id]}, format='json')
    hasta = notion.fin_de_ventana()
    en_ventana = Tarea.objects.filter(recurrente=r.data['id'], fecha_limite__lte=hasta)
    total = en_ventana.count()
    assert total > 2
    primera = notion.sincronizar()
    assert primera['enviadas'] == 2 and primera['pendientes'] == total - 2
    enviadas = 2
    while enviadas < total:
        EstadoNotion.objects.filter(pk=1).update(ultima_sync=None)
        enviadas += notion.sincronizar()['enviadas']
    assert enviadas == total and not en_ventana.filter(notion_page_id__isnull=True).exists()
    # Las de después de la ventana esperan en el panel.
    assert not Tarea.objects.filter(recurrente=r.data['id'], fecha_limite__gt=hasta).exclude(notion_page_id=None).exists()
    # Las más próximas salen primero.
    assert Tarea.objects.order_by('fecha_limite').first().notion_page_id in falso.paginas


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


PRIVADAS_DS = '845fb2f7-9b20-4c21-bd0a-a255025d5de9'


@pytest.mark.django_db
def test_las_tareas_privadas_van_a_su_base_y_se_mudan(api_client, equipo_client, falso):
    r = api_client.post('/api/tareas/', {'titulo': 'Reunión de socios', 'etiqueta': 'ceos'}, format='json')
    assert r.status_code == 201, r.data
    tarea = Tarea.objects.get()
    assert tarea.notion_privada and falso.paginas[tarea.notion_page_id]['parent']['data_source_id'] == PRIVADAS_DS
    assert equipo_client.post('/api/tareas/', {'titulo': 'X', 'etiqueta': 'ceos'}, format='json').status_code == 400
    assert not [t for t in _lista(equipo_client.get('/api/tareas/').data) if t['id'] == tarea.id]

    vieja = tarea.notion_page_id
    api_client.patch(f'/api/tareas/{tarea.id}/', {'etiqueta': 'reuniones'}, format='json')
    tarea.refresh_from_db()
    assert falso.paginas[vieja]['in_trash'] and not tarea.notion_privada
    assert falso.paginas[tarea.notion_page_id]['parent']['data_source_id'] == TAREAS_DS


@pytest.mark.django_db
def test_lo_cargado_en_la_base_privada_llega_como_ceos(api_client, falso):
    falso.agregar(PRIVADAS_DS, _props_tarea('Revisar números'))
    r = api_client.post('/api/notion/sincronizar/', {'completa': True}, format='json')
    assert r.status_code == 200, r.data
    tarea = Tarea.objects.get(titulo='Revisar números')
    assert tarea.etiqueta == 'ceos' and tarea.notion_privada


@pytest.mark.django_db
def test_sin_acceso_a_la_base_privada_lo_demas_sincroniza(api_client, falso, monkeypatch):
    original = falso.__call__

    def sin_privada(method, url, **kw):
        if PRIVADAS_DS in url or (kw.get('json') or {}).get('parent', {}).get('data_source_id') == PRIVADAS_DS:
            return httpx.Response(404, json={'message': 'no'})
        return original(method, url, **kw)

    monkeypatch.setattr(httpx, 'request', sin_privada)
    falso.agregar(TAREAS_DS, _props_tarea('Grilla'))
    Tarea.objects.create(titulo='Socios', etiqueta='ceos')
    r = api_client.post('/api/notion/sincronizar/', {'completa': True}, format='json')
    assert r.status_code == 200, r.data
    assert r.data['privadas_sin_conectar'] and Tarea.objects.filter(titulo='Grilla').exists()
    assert Tarea.objects.get(titulo='Socios').notion_page_id is None


def _lista(data):
    return data['results'] if isinstance(data, dict) else data


def _titulo_bloque(bloque):
    return ''.join((t.get('text') or {}).get('content', '') for t in bloque['to_do']['rich_text'])


def _todos(falso, page_id):
    return [b for b in falso.bloques.get(page_id, []) if b['type'] == 'to_do' and not b.get('in_trash')]


@pytest.mark.django_db(transaction=True)
def test_subtareas_son_to_do_y_el_eco_no_reaplica(api_client, falso):
    r = api_client.post('/api/tareas/', {
        'titulo': 'Subir historia',
        'subtareas': [{'titulo': f'Historia {i}', 'hecha': False} for i in range(1, 4)],
    }, format='json')
    assert r.status_code == 201, r.data
    tarea = Tarea.objects.get()
    falso.bloques[tarea.notion_page_id].insert(0, {
        'id': str(uuid.uuid4()), 'type': 'paragraph', 'in_trash': False,
        'paragraph': {'rich_text': [{'text': {'content': 'Se conserva'}}]},
    })
    assert [_titulo_bloque(b) for b in _todos(falso, tarea.notion_page_id)] == ['Historia 1', 'Historia 2', 'Historia 3']

    for sub in tarea.subtareas.order_by('orden'):
        assert api_client.patch(f'/api/tareas/{tarea.id}/subtareas/{sub.id}/', {'hecha': True}, format='json').status_code == 200
    tarea.refresh_from_db()
    page = falso.paginas[tarea.notion_page_id]
    assert tarea.estado == 'hecha' and page['properties']['Estado']['select']['name'] == 'Hecha'
    assert all(b['to_do']['checked'] for b in _todos(falso, tarea.notion_page_id))
    assert any(b['type'] == 'paragraph' and not b.get('in_trash') for b in falso.bloques[tarea.notion_page_id])

    antes = notion.aplicar_pagina(page)
    assert antes is None and Tarea.objects.count() == 1

    primero = _todos(falso, tarea.notion_page_id)[0]
    primero['to_do'] = {**primero['to_do'], 'checked': False}
    assert notion.aplicar_pagina(page) == 'actualizada'
    tarea.refresh_from_db()
    assert tarea.estado == 'en_curso' and tarea.completada_en is None
    assert [s.hecha for s in tarea.subtareas.order_by('orden')] == [False, True, True]
    assert page['properties']['Estado']['select']['name'] == 'En progreso'
    assert notion.aplicar_pagina(falso.paginas[tarea.notion_page_id]) is None



@pytest.mark.django_db
def test_rango_y_horario_van_en_la_fecha_y_el_eco_no_reaplica(api_client, falso):
    r = api_client.post('/api/tareas/', {
        'titulo': 'Rodaje', 'fecha_inicio': '2026-11-10', 'fecha_limite': '2026-11-12', 'hora_inicio': '09:00', 'hora_fin': '18:30',
    }, format='json')
    assert r.status_code == 201, r.data
    tarea = Tarea.objects.get()
    page = falso.paginas[tarea.notion_page_id]
    assert page['properties']['Fecha']['date'] == {
        'start': '2026-11-10T09:00:00', 'end': '2026-11-12T18:30:00', 'time_zone': 'America/Argentina/Buenos_Aires',
    }
    assert notion.aplicar_pagina(page) is None

    # Como lo devuelve Notion (con offset), cambiado allá a un solo día con horario.
    page['properties']['Fecha']['date'] = {'start': '2026-11-15T10:00:00.000-03:00', 'end': '2026-11-15T11:00:00.000-03:00'}
    assert notion.aplicar_pagina(page) == 'actualizada'
    tarea.refresh_from_db()
    assert (tarea.fecha_inicio, str(tarea.fecha_limite), str(tarea.hora_inicio), str(tarea.hora_fin)) == (None, '2026-11-15', '10:00:00', '11:00:00')


@pytest.mark.django_db(transaction=True)
def test_desde_notion_no_se_avanza_una_bloqueada_y_completar_la_previa_desbloquea(api_client, falso):
    previa = api_client.post('/api/tareas/', {'titulo': 'Guion'}, format='json').data
    r = api_client.post('/api/tareas/', {'titulo': 'Edición', 'depende_de': [previa['id']]}, format='json')
    tarea = Tarea.objects.get(pk=r.data['id'])
    page = falso.paginas[tarea.notion_page_id]
    assert page['properties']['Estado']['select']['name'] == 'Bloqueada'

    page['properties']['Estado'] = {'id': 'Estado', 'type': 'select', 'select': {'name': 'En progreso'}}
    notion.aplicar_pagina(page)
    tarea.refresh_from_db()
    assert tarea.estado == 'bloqueada' and tarea.bloqueo_auto
    assert page['properties']['Estado']['select']['name'] == 'Bloqueada'

    pagina_previa = falso.paginas[Tarea.objects.get(pk=previa['id']).notion_page_id]
    pagina_previa['properties']['Estado'] = {'id': 'Estado', 'type': 'select', 'select': {'name': 'Hecha'}}
    notion.aplicar_pagina(pagina_previa)
    tarea.refresh_from_db()
    assert tarea.estado == 'pendiente'
    assert page['properties']['Estado']['select']['name'] == 'Por hacer'


@pytest.mark.django_db(transaction=True)
def test_dependencias_van_como_bloqueada_por(api_client, falso):
    previa = api_client.post('/api/tareas/', {'titulo': 'Guion'}, format='json').data
    tarea = api_client.post('/api/tareas/', {'titulo': 'Edición', 'depende_de': [previa['id']]}, format='json').data
    pid_previa = Tarea.objects.get(pk=previa['id']).notion_page_id
    page = falso.paginas[Tarea.objects.get(pk=tarea['id']).notion_page_id]
    assert page['properties']['Bloqueada por']['relation'] == [{'id': pid_previa}]
    assert notion.aplicar_pagina(page) is None  # el eco no reaplica

    # Sacada en Notion: se libera en el panel.
    page['properties']['Bloqueada por'] = {'id': 'Bloqueada por', 'type': 'relation', 'relation': []}
    notion.aplicar_pagina(page)
    t = Tarea.objects.get(pk=tarea['id'])
    assert not t.depende_de.exists() and t.estado == 'pendiente'

    # Agregada en Notion: se bloquea en el panel.
    otra = api_client.post('/api/tareas/', {'titulo': 'Música'}, format='json').data
    pid_otra = Tarea.objects.get(pk=otra['id']).notion_page_id
    page['properties']['Bloqueada por'] = {'id': 'Bloqueada por', 'type': 'relation', 'relation': [{'id': pid_otra}]}
    notion.aplicar_pagina(page)
    t.refresh_from_db()
    assert list(t.depende_de.values_list('pk', flat=True)) == [otra['id']] and t.estado == 'bloqueada'


@pytest.mark.django_db
def test_la_previa_sin_pagina_se_suma_cuando_la_tiene(api_client, falso, settings):
    token = settings.NOTION_TOKEN
    settings.NOTION_TOKEN = ''
    previa = api_client.post('/api/tareas/', {'titulo': 'Guion'}, format='json').data
    settings.NOTION_TOKEN = token
    tarea = api_client.post('/api/tareas/', {'titulo': 'Edición', 'depende_de': [previa['id']]}, format='json').data
    page = falso.paginas[Tarea.objects.get(pk=tarea['id']).notion_page_id]
    assert page['properties']['Bloqueada por']['relation'] == []
    notion.enviar_tarea(Tarea.objects.get(pk=previa['id']))
    assert page['properties']['Bloqueada por']['relation'] == [{'id': Tarea.objects.get(pk=previa['id']).notion_page_id}]


def test_fin_de_ventana():
    from datetime import date

    assert notion.fin_de_ventana(date(2026, 11, 3)) == date(2026, 11, 8)  # martes → este domingo
    assert notion.fin_de_ventana(date(2026, 11, 6)) == date(2026, 11, 8)  # viernes
    assert notion.fin_de_ventana(date(2026, 11, 7)) == date(2026, 11, 15)  # sábado → la semana que entra
    assert notion.fin_de_ventana(date(2026, 11, 8)) == date(2026, 11, 15)  # domingo


@pytest.mark.django_db(transaction=True)
def test_hechas_viejas_y_recurrentes_futuras_salen_de_notion_sin_borrarse(api_client, falso, persona, monkeypatch):
    from datetime import timedelta

    from django.utils import timezone

    from apps.equipo.models import TareaRecurrente

    vieja = api_client.post('/api/tareas/', {'titulo': 'Grilla', 'subtareas': [{'titulo': 'A'}]}, format='json').data
    api_client.patch(f'/api/tareas/{vieja["id"]}/', {'estado': 'hecha'}, format='json')
    tarea = Tarea.objects.get(pk=vieja['id'])
    pid = tarea.notion_page_id
    Tarea.objects.filter(pk=tarea.pk).update(completada_en=timezone.now() - timedelta(days=8))
    # Una recurrente subida antes de la ventana (como las de noviembre que ya estaban).
    plantilla = TareaRecurrente.objects.create(titulo='Historia', dias=[0])
    futura = Tarea.objects.create(titulo='Historia', recurrente=plantilla, fecha_limite=notion.fin_de_ventana() + timedelta(days=3))
    notion.enviar_tarea(futura)
    pid_futura = Tarea.objects.get(pk=futura.pk).notion_page_id

    assert notion.mantenimiento() == {'archivadas': 2, 'enviadas': 0}
    assert falso.paginas[pid]['in_trash'] and falso.paginas[pid_futura]['in_trash']
    tarea.refresh_from_db()
    assert tarea.notion_page_id is None and tarea.estado == 'hecha'
    # El webhook de la página en la papelera no borra la tarea del panel.
    assert notion.aplicar_pagina(falso.paginas[pid]) is None and Tarea.objects.filter(pk=tarea.pk).exists()
    assert not tarea.subtareas.exclude(notion_block_id='').exists()
    # No se vuelve a subir...
    assert notion.enviar_pendientes() == 0
    # ...salvo que se reabra.
    api_client.patch(f'/api/tareas/{tarea.id}/', {'estado': 'en_curso'}, format='json')
    tarea.refresh_from_db()
    assert tarea.notion_page_id and tarea.notion_page_id != pid


@pytest.mark.django_db
def test_con_notion_lleno_igual_se_archiva(api_client, falso, monkeypatch):
    from datetime import timedelta

    from django.utils import timezone

    hecha = api_client.post('/api/tareas/', {'titulo': 'Grilla', 'estado': 'hecha'}, format='json').data
    Tarea.objects.filter(pk=hecha['id']).update(completada_en=timezone.now() - timedelta(days=8))
    pid = Tarea.objects.get(pk=hecha['id']).notion_page_id
    Tarea.objects.create(titulo='Sin página')
    original = falso.__call__

    def lleno(method, url, **kw):
        if method == 'POST' and url.endswith('/pages'):
            return httpx.Response(400, json={'code': 'validation_error', 'message': 'Your workspace has used all of its free blocks.'})
        return original(method, url, **kw)

    monkeypatch.setattr(httpx, 'request', lleno)
    r = notion.mantenimiento()
    assert r['archivadas'] == 1 and r['error'] and falso.paginas[pid]['in_trash']
