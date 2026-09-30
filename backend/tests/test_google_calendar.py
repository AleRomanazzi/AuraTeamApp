from datetime import timedelta
from urllib.parse import unquote

import httpx
import pytest
from django.utils import timezone

from apps.accounts import google
from apps.calendario import google_calendar
from apps.calendario.models import CalendarioGoogle, EstadoCalendarioGoogle, EventoUnico
from apps.clientes.models import Cliente
from apps.equipo.models import Tarea

PRINCIPAL = 'aura@gmail.com'
NOMBRES = {
    PRINCIPAL: 'AuraTeam CEOs',
    'ops@group': 'Operaciones AuraTeam',
    'cob@group': 'Coberturas',
    'reu@group': 'Reuniones&Briefing',
    'pos@group': 'Posteos',
    'edi@group': 'Edición',
}


class CalendarFalso:
    """Google Calendar en memoria: calendarios con eventos y un registro de cambios para los syncToken."""

    def __init__(self):
        self.calendarios = {cid: {'summary': nombre, 'eventos': {}, 'cambios': []} for cid, nombre in NOMBRES.items()}
        self.n = 0
        self.falla = False

    def agregar_evento(self, cal_id, **datos):
        cal = self.calendarios[cal_id]
        self.n += 1
        ev = {'id': f'ev{self.n}', 'status': 'confirmed', **datos}
        cal['eventos'][ev['id']] = ev
        cal['cambios'].append(dict(ev))
        return ev

    def editar(self, cal_id, eid, **datos):
        cal = self.calendarios[cal_id]
        cal['eventos'][eid].update(datos)
        cal['cambios'].append(dict(cal['eventos'][eid]))

    def borrar_evento(self, cal_id, eid):
        cal = self.calendarios[cal_id]
        ev = cal['eventos'].pop(eid)
        cal['cambios'].append({**ev, 'status': 'cancelled'})

    def mover(self, origen, eid, destino):
        ev = self.calendarios[origen]['eventos'][eid]
        self.borrar_evento(origen, eid)
        self.calendarios[destino]['eventos'][eid] = ev
        self.calendarios[destino]['cambios'].append(dict(ev))
        return ev

    def eventos(self, cal_id):
        return self.calendarios[cal_id]['eventos']

    def __call__(self, method, url, headers=None, json=None, params=None, timeout=None):
        if self.falla:
            return httpx.Response(500, json={'error': {'message': 'caído'}})
        p = [unquote(x) for x in url.removeprefix(google_calendar.API).split('/')[1:]]
        params = params or {}
        if p == ['users', 'me', 'calendarList']:
            return httpx.Response(200, json={'items': [{'id': cid, 'summary': c['summary']} for cid, c in self.calendarios.items()]})
        cid = PRINCIPAL if p[1] == 'primary' else p[1]
        cal = self.calendarios.get(cid)
        if cal is None:
            return httpx.Response(404, json={'error': {'message': 'Not Found'}})
        if len(p) == 3 and method == 'GET':
            if params.get('syncToken'):
                items = cal['cambios'][int(params['syncToken']):]
            else:
                items = list(cal['eventos'].values())
            return httpx.Response(200, json={'items': items, 'nextSyncToken': str(len(cal['cambios']))})
        if len(p) == 3 and method == 'POST':
            return httpx.Response(200, json=self.agregar_evento(cid, **json))
        ev = cal['eventos'].get(p[3])
        if ev is None:
            return httpx.Response(404, json={'error': {'message': 'Not Found'}})
        if len(p) == 5 and p[4] == 'move':
            return httpx.Response(200, json=self.mover(cid, p[3], params['destination']))
        if method == 'PATCH':
            self.editar(cid, p[3], **json)
            return httpx.Response(200, json=ev)
        if method == 'DELETE':
            self.borrar_evento(cid, p[3])
            return httpx.Response(204)
        raise AssertionError(f'Llamada inesperada {method} {p}')


@pytest.fixture
def gcal(monkeypatch):
    f = CalendarFalso()
    monkeypatch.setattr(httpx, 'request', f)
    monkeypatch.setattr(google_calendar, 'configurado', lambda: True)
    monkeypatch.setattr(google_calendar, '_principal', lambda: PRINCIPAL)
    monkeypatch.setattr(google, 'access_token', lambda: {'access_token': 'at'})
    return f


@pytest.fixture
def clientes(db):
    return {
        'cycles': Cliente.objects.create(nombre='Cicles Bike Store', color='#dc2127', google_color='11', palabras_clave='Cycles, Ferreyra'),
        'lennon': Cliente.objects.create(nombre='Lennon', color='#fbd75b', google_color='5'),
    }


def _evento(api_client, **extra):
    body = {'titulo': 'Grabación', 'inicio': '2026-10-05T10:00:00-03:00', 'fin': '2026-10-05T12:00:00-03:00', **extra}
    r = api_client.post('/api/cal-eventos/', body, format='json')
    assert r.status_code == 201, r.data
    return EventoUnico.objects.get(pk=r.data['id'])


def _incremental():
    EstadoCalendarioGoogle.objects.filter(pk=1).update(ultima_sync=None)
    return google_calendar.sincronizar()


@pytest.mark.django_db
def test_las_etiquetas_se_vinculan_por_nombre(gcal):
    google_calendar.sincronizar()
    assert dict(CalendarioGoogle.objects.values_list('etiqueta', 'calendar_id')) == {
        'ceos': PRINCIPAL, 'historias': 'ops@group', 'coberturas': 'cob@group', 'reuniones': 'reu@group',
        'posteos': 'pos@group', 'edicion': 'edi@group',
    }


@pytest.mark.django_db
def test_evento_va_a_su_etiqueta_con_el_color_del_cliente(api_client, gcal, clientes):
    ev = _evento(api_client, etiqueta='coberturas', cliente=clientes['cycles'].id)
    g = gcal.eventos('cob@group')[ev.google_event_id]
    assert g['colorId'] == '11' and g['summary'] == 'Grabación'

    api_client.patch(f'/api/cal-eventos/{ev.id}/', {'etiqueta': 'reuniones', 'cliente': clientes['lennon'].id}, format='json')
    ev.refresh_from_db()
    assert not gcal.eventos('cob@group') and ev.google_calendar_id == 'reu@group'
    assert gcal.eventos('reu@group')[ev.google_event_id]['colorId'] == '5'

    api_client.delete(f'/api/cal-eventos/{ev.id}/')
    assert not gcal.eventos('reu@group')


@pytest.mark.django_db
def test_ceos_es_solo_para_admin(api_client, equipo_client, gcal):
    r = equipo_client.post('/api/cal-eventos/', {'titulo': 'X', 'inicio': '2026-10-05T10:00:00-03:00', 'etiqueta': 'ceos'}, format='json')
    assert r.status_code == 400
    _evento(api_client, titulo='Socios', etiqueta='ceos')
    _evento(api_client, titulo='Equipo', etiqueta='reuniones')
    assert [e['titulo'] for e in equipo_client.get('/api/cal-eventos/').data] == ['Equipo']
    assert len(api_client.get('/api/cal-eventos/').data) == 2


@pytest.mark.django_db
def test_lo_cargado_en_google_reconoce_al_cliente(gcal, clientes):
    google_calendar.sincronizar()
    manana = (timezone.localdate() + timedelta(days=1)).isoformat()
    hora = {'start': {'dateTime': f'{manana}T20:00:00-03:00'}, 'end': {'dateTime': f'{manana}T20:30:00-03:00'}}
    por_titulo = gcal.agregar_evento('ops@group', summary='Posteo CyclesFerreyra', **hora)
    por_color = gcal.agregar_evento('cob@group', summary='Cobertura', colorId='5', **hora)
    sin_cliente = gcal.agregar_evento('reu@group', summary='Reunión con Vilta', **hora)
    assert _incremental()['creados'] == 3

    ev = EventoUnico.objects.get(google_event_id=por_titulo['id'])
    assert ev.cliente == clientes['cycles'] and ev.etiqueta == 'historias' and ev.color == '#dc2127'
    assert EventoUnico.objects.get(google_event_id=por_color['id']).cliente == clientes['lennon']
    assert EventoUnico.objects.get(google_event_id=sin_cliente['id']).cliente is None

    socios = gcal.agregar_evento(PRINCIPAL, summary='Pauta', colorId='11', **hora)
    _incremental()
    assert EventoUnico.objects.get(google_event_id=socios['id']).cliente is None

    gcal.editar('ops@group', por_titulo['id'], summary='Posteo Lennon')
    _incremental()
    ev.refresh_from_db()
    assert ev.cliente == clientes['lennon'] and ev.color == '#fbd75b'

    gcal.borrar_evento('ops@group', por_titulo['id'])
    assert _incremental()['borrados'] == 1


@pytest.mark.django_db
def test_mover_de_etiqueta_en_google_no_borra(api_client, gcal, clientes):
    ev = _evento(api_client, etiqueta='coberturas', cliente=clientes['cycles'].id)
    google_calendar.sincronizar(completa=True)
    gcal.mover('cob@group', ev.google_event_id, 'ops@group')
    r = _incremental()
    ev.refresh_from_db()
    assert r['borrados'] == 0 and ev.etiqueta == 'historias' and ev.user is not None


@pytest.mark.django_db
def test_lo_subido_desde_el_panel_vuelve_sin_cambios(api_client, gcal, clientes):
    ev = _evento(api_client, fin=None, cliente=clientes['lennon'].id)
    google_calendar.sincronizar(completa=True)
    r = _incremental()
    ev.refresh_from_db()
    assert r['creados'] == r['actualizados'] == 0 and ev.fin is None


@pytest.mark.django_db
def test_tareas_con_fecha_van_a_historias(api_client, gcal, clientes):
    google_calendar.sincronizar()
    fecha = (timezone.localdate() + timedelta(days=3)).isoformat()
    r = api_client.post('/api/tareas/', {'titulo': 'Editar reels', 'fecha_limite': fecha, 'cliente': clientes['cycles'].id}, format='json')
    tarea = Tarea.objects.get(pk=r.data['id'])
    g = gcal.eventos('ops@group')[tarea.google_event_id]
    assert g['start'] == {'date': fecha} and g['colorId'] == '11'
    assert _incremental()['creados'] == 0 and not EventoUnico.objects.exists()

    api_client.patch(f'/api/tareas/{tarea.id}/', {'estado': 'hecha'}, format='json')
    assert not gcal.eventos('ops@group')
    tarea.refresh_from_db()
    assert tarea.google_event_id == ''

    huerfano = gcal.agregar_evento('ops@group', summary='Vieja', start={'date': fecha}, end={'date': fecha},
                                   extendedProperties={'private': {'aura_tarea': '999'}})
    _incremental()
    assert huerfano['id'] not in gcal.eventos('ops@group')


@pytest.mark.django_db
def test_la_tarea_va_al_calendario_de_su_etiqueta_y_se_mueve(api_client, gcal, clientes):
    google_calendar.sincronizar()
    fecha = (timezone.localdate() + timedelta(days=2)).isoformat()
    r = api_client.post('/api/tareas/', {'titulo': 'Reel', 'fecha_limite': fecha, 'etiqueta': 'posteos'}, format='json')
    tarea = Tarea.objects.get(pk=r.data['id'])
    assert tarea.google_event_id in gcal.eventos('pos@group') and tarea.google_calendar_id == 'pos@group'

    api_client.patch(f'/api/tareas/{tarea.id}/', {'etiqueta': 'edicion'}, format='json')
    tarea.refresh_from_db()
    assert not gcal.eventos('pos@group') and tarea.google_event_id in gcal.eventos('edi@group')

    api_client.delete(f'/api/tareas/{tarea.id}/')
    assert not gcal.eventos('edi@group')


@pytest.mark.django_db
def test_tarea_vieja_de_operaciones_se_mueve_desde_historias(api_client, gcal, clientes):
    google_calendar.sincronizar()
    fecha = (timezone.localdate() + timedelta(days=2)).isoformat()
    vieja = gcal.agregar_evento('ops@group', summary='Guion', start={'date': fecha}, end={'date': fecha})
    tarea = Tarea.objects.create(titulo='Guion', fecha_limite=fecha, google_event_id=vieja['id'])
    gcal.editar('ops@group', vieja['id'], extendedProperties={'private': {'aura_tarea': str(tarea.pk)}})
    api_client.patch(f'/api/tareas/{tarea.id}/', {'etiqueta': 'posteos'}, format='json')
    assert vieja['id'] in gcal.eventos('pos@group') and not gcal.eventos('ops@group')


@pytest.mark.django_db
def test_sin_calendario_de_la_etiqueta_la_sincronizacion_sigue(gcal, clientes):
    del gcal.calendarios['edi@group']
    google_calendar.sincronizar()
    Tarea.objects.create(titulo='Editar', fecha_limite=timezone.localdate() + timedelta(days=1), etiqueta='edicion')
    Tarea.objects.create(titulo='Historia', fecha_limite=timezone.localdate() + timedelta(days=1))
    assert _incremental()['tareas'] == 1


@pytest.mark.django_db
def test_cambiar_el_color_del_cliente_repinta(api_client, gcal, clientes):
    ev = _evento(api_client, etiqueta='coberturas', cliente=clientes['cycles'].id)
    api_client.patch(f"/api/clientes/{clientes['cycles'].id}/", {'google_color': '7'}, format='json')
    assert gcal.eventos('cob@group')[ev.google_event_id]['colorId'] == '7'


@pytest.mark.django_db
def test_pintar_eventos_existentes(api_client, gcal, clientes):
    google_calendar.sincronizar()
    manana = (timezone.localdate() + timedelta(days=1)).isoformat()
    serie = gcal.agregar_evento('ops@group', summary='Posteo CyclesFerreyra', recurrence=['RRULE:FREQ=WEEKLY'],
                                start={'dateTime': f'{manana}T20:00:00-03:00'}, end={'dateTime': f'{manana}T20:30:00-03:00'})
    gcal.agregar_evento('reu@group', summary='Reunión con Vilta', start={'date': manana}, end={'date': manana})
    sugeridos = api_client.get('/api/calendario/google/colores/').data
    assert [(s['event_id'], s['cliente_nombre'], s['color_id'], s['repetitivo']) for s in sugeridos] == [
        (serie['id'], 'Cicles Bike Store', '11', True)
    ]
    r = api_client.post('/api/calendario/google/colores/', {'eventos': [{'calendar_id': 'ops@group', 'event_id': serie['id']}, {'calendar_id': 'x', 'event_id': 'y'}]}, format='json')
    assert r.data == {'pintados': 1} and gcal.eventos('ops@group')[serie['id']]['colorId'] == '11'


@pytest.mark.django_db
def test_un_fallo_de_google_no_impide_guardar(api_client, gcal):
    google_calendar.sincronizar()
    gcal.falla = True
    ev = _evento(api_client)
    assert ev.google_event_id == '' and 'caído' in EstadoCalendarioGoogle.get().ultimo_error
    gcal.falla = False
    assert google_calendar.sincronizar(completa=True)['enviados'] == 1
    ev.refresh_from_db()
    assert ev.google_calendar_id == 'ops@group'


@pytest.mark.django_db
def test_copias_viejas_del_principal_quedan_en_ceos(gcal, clientes):
    viejo = gcal.agregar_evento(PRINCIPAL, summary='Reunión socios')
    ev = EventoUnico.objects.create(
        nombre='Reunión socios', inicio=timezone.now() + timedelta(days=2), cliente=clientes['lennon'], etiqueta='ceos', google_event_id=viejo['id']
    )
    google_calendar.sincronizar(completa=True)
    ev.refresh_from_db()
    assert ev.google_calendar_id == PRINCIPAL and gcal.eventos(PRINCIPAL)[viejo['id']]['colorId'] == '5'


@pytest.mark.django_db
def test_equipo_ve_eventos_sin_cliente_y_de_sus_clientes(api_client, equipo_client, persona):
    from apps.equipo.models import AsignacionCliente

    suyo = Cliente.objects.create(nombre='Cicles')
    ajeno = Cliente.objects.create(nombre='Otro')
    AsignacionCliente.objects.create(persona=persona, cliente=suyo)
    inicio = timezone.now() + timedelta(days=1)
    for nombre, cliente in (('Interno', None), ('De Cicles', suyo), ('De Otro', ajeno)):
        EventoUnico.objects.create(nombre=nombre, inicio=inicio, cliente=cliente)
    assert {e['titulo'] for e in equipo_client.get('/api/cal-eventos/').data} == {'Interno', 'De Cicles'}
    assert {e['titulo'] for e in equipo_client.get('/api/mi-panel/').data['eventos']} == {'Interno', 'De Cicles'}
    assert len(api_client.get('/api/cal-eventos/').data) == 3
