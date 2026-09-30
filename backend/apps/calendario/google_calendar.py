"""Eventos y tareas del panel en los calendarios (etiquetas) de la cuenta de Google de la agencia.

Cada evento va al calendario de su etiqueta (CEOs, Coberturas, Operaciones, Reuniones & Briefing) con el color de su
cliente; las tareas con fecha van como eventos de día completo a Operaciones. Panel → Google al guardar desde la API;
Google → panel con la sincronización incremental (syncToken de cada calendario) al abrir Tareas o Calendario, y
completa desde Configuración → Google. En lo cargado directo en Google, el cliente se reconoce por el color del evento
o por sus palabras clave en el título.
"""

import hashlib
import json
import logging
import re
import unicodedata
from datetime import datetime, time, timedelta
from urllib.parse import quote

import httpx
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from apps.accounts import google
from apps.clientes.models import Cliente
from apps.equipo.models import Tarea

from .models import ETIQUETAS, ETIQUETAS_PRIVADAS, CalendarioGoogle, EstadoCalendarioGoogle, EventoUnico

logger = logging.getLogger(__name__)

API = 'https://www.googleapis.com/calendar/v3'
TIMEOUT = 20
INTERVALO_INCREMENTAL = timedelta(seconds=60)
TRAER_DESDE = timedelta(days=30)
TRAER_HASTA = timedelta(days=180)
DURACION_DEFECTO = timedelta(hours=1)
ENVIAR_DESDE = timedelta(days=30)
COLOR_DEFECTO = EventoUnico._meta.get_field('color').default
ETIQUETAS_NOMBRE = dict(ETIQUETAS)
# Cómo reconocer cada etiqueta por el nombre del calendario (sin tildes ni espacios).
PISTAS_ETIQUETA = {'ceos': ('ceo',), 'coberturas': ('cobertura',), 'operaciones': ('operacion',), 'reuniones': ('reunion', 'briefing')}
MIN_PALABRA = 3


class NoEncontrado(google.GoogleError):
    pass


class Vencido(NoEncontrado):
    """410: el evento ya no existe o el syncToken venció (hay que listar todo de nuevo)."""


def configurado() -> bool:
    return google.configurado() and google.cuenta() is not None


def _q(valor: str) -> str:
    return quote(valor, safe='')


def _cal(cal_id: str) -> str:
    return f'/calendars/{_q(cal_id)}'


def _clave(texto: str) -> str:
    sin_tildes = unicodedata.normalize('NFKD', texto or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', sin_tildes.lower())


def _request(method, path, body=None, params=None):
    if method != 'GET' and settings.GOOGLE_CALENDAR_SOLO_LECTURA:
        raise google.GoogleError('Google Calendar está en modo solo lectura (GOOGLE_CALENDAR_SOLO_LECTURA).')
    token = google.access_token()['access_token']
    try:
        r = httpx.request(
            method, f'{API}{path}', headers={'Authorization': f'Bearer {token}'}, json=body, params=params, timeout=TIMEOUT
        )
    except httpx.HTTPError as e:
        raise google.GoogleError(f'No se pudo contactar a Google Calendar ({e.__class__.__name__}).') from e
    if r.status_code == 404:
        raise NoEncontrado('Google Calendar no encuentra el recurso.')
    if r.status_code == 410:
        raise Vencido('El recurso de Google Calendar ya no existe.')
    if r.status_code >= 400:
        try:
            detalle = r.json().get('error', {}).get('message', '')
        except ValueError:
            detalle = ''
        raise google.GoogleError(f'Google Calendar respondió {r.status_code}. {detalle}'.strip())
    return r.json() if r.content else {}


def registrar_error(mensaje: str):
    EstadoCalendarioGoogle.objects.update_or_create(
        pk=1, defaults={'ultimo_error': mensaje[:1000], 'ultimo_error_en': timezone.now()}
    )


def _seguro(fn, *args):
    try:
        fn(*args)
    except google.GoogleError as e:
        registrar_error(str(e))
    except Exception:
        logger.exception('Error sincronizando con Google Calendar')
        registrar_error('Error inesperado sincronizando con Google Calendar (ver logs del servidor).')


def _privadas(item: dict) -> dict:
    return (item.get('extendedProperties') or {}).get('private') or {}


# --- Etiquetas (calendarios de la cuenta) ----------------------------------------------------------------------------


def calendarios_de_la_cuenta() -> list:
    data = _request('GET', '/users/me/calendarList', params={'maxResults': 250, 'minAccessRole': 'writer'})
    return [
        {'id': c['id'], 'nombre': c.get('summaryOverride') or c.get('summary') or c['id'], 'color': c.get('backgroundColor')}
        for c in data.get('items', [])
    ]


def vincular_etiquetas() -> None:
    """Asocia por nombre las etiquetas que todavía no tienen calendario y actualiza los nombres guardados."""
    cuenta = calendarios_de_la_cuenta()
    por_id = {c['id']: c for c in cuenta}
    actuales = {c.etiqueta: c for c in CalendarioGoogle.objects.all()}
    for etiqueta, pistas in PISTAS_ETIQUETA.items():
        cal = actuales.get(etiqueta)
        if cal is not None and cal.calendar_id in por_id:
            if cal.nombre != por_id[cal.calendar_id]['nombre']:
                CalendarioGoogle.objects.filter(pk=cal.pk).update(nombre=por_id[cal.calendar_id]['nombre'])
            continue
        elegido = next((c for c in cuenta if any(p in _clave(c['nombre']) for p in pistas)), None)
        if elegido:
            CalendarioGoogle.objects.update_or_create(
                etiqueta=etiqueta, defaults={'calendar_id': elegido['id'], 'nombre': elegido['nombre'], 'sync_token': ''}
            )


def elegir_calendario(etiqueta: str, calendar_id: str) -> CalendarioGoogle:
    elegido = next((c for c in calendarios_de_la_cuenta() if c['id'] == calendar_id), None)
    if elegido is None:
        raise google.GoogleError('Ese calendario no está en la cuenta o no se puede editar.')
    cal, _ = CalendarioGoogle.objects.update_or_create(
        etiqueta=etiqueta, defaults={'calendar_id': calendar_id, 'nombre': elegido['nombre'], 'sync_token': ''}
    )
    return cal


def calendario_de(etiqueta: str) -> str:
    cal = CalendarioGoogle.objects.filter(etiqueta=etiqueta).first()
    if cal is None:
        vincular_etiquetas()
        cal = CalendarioGoogle.objects.filter(etiqueta=etiqueta).first()
    if cal is None:
        raise google.GoogleError(f'Falta elegir el calendario de «{ETIQUETAS_NOMBRE[etiqueta]}» en Configuración → Google.')
    return cal.calendar_id


def _principal() -> str:
    c = google.cuenta()
    return c.email if c and c.email else 'primary'


def _normalizar(cal_id: str) -> str:
    """El calendario principal de la cuenta se puede nombrar como 'primary', por su email o vacío (eventos viejos)."""
    return _principal() if cal_id in ('', 'primary') else cal_id


# --- Clientes --------------------------------------------------------------------------------------------------------


def _clientes() -> list:
    return list(Cliente.objects.only('id', 'nombre', 'color', 'google_color', 'palabras_clave'))


def palabras_de(cliente) -> list:
    palabras = [cliente.nombre, *cliente.palabras_clave.split(',')]
    return [k for k in (_clave(p) for p in palabras) if len(k) >= MIN_PALABRA]


def cliente_por_titulo(titulo: str, clientes: list):
    titulo, mejor, largo = _clave(titulo), None, 0
    for c in clientes:
        for k in palabras_de(c):
            if k in titulo and len(k) > largo:
                mejor, largo = c, len(k)
    return mejor


def cliente_de(item: dict, clientes: list, etiqueta: str = ''):
    color = item.get('colorId')
    # En las etiquetas privadas los socios usan colores con otro sentido: ahí el color no identifica al cliente.
    if color and etiqueta not in ETIQUETAS_PRIVADAS:
        con_color = [c for c in clientes if c.google_color == color]
        if len(con_color) == 1:
            return con_color[0]
    aura = _privadas(item).get('aura_cliente', '')
    if aura.isdigit():
        por_id = next((c for c in clientes if c.id == int(aura)), None)
        if por_id:
            return por_id
    return cliente_por_titulo(item.get('summary') or '', clientes)


# --- Panel → Google: eventos -----------------------------------------------------------------------------------------


def _cuerpo(ev: EventoUnico) -> dict:
    fin = ev.fin if ev.fin and ev.fin > ev.inicio else ev.inicio + DURACION_DEFECTO
    return {
        'summary': ev.nombre,
        'description': ev.descripcion,
        'start': {'dateTime': ev.inicio.isoformat(), 'timeZone': settings.TIME_ZONE},
        'end': {'dateTime': fin.isoformat(), 'timeZone': settings.TIME_ZONE},
        'status': 'confirmed',
        'colorId': (ev.cliente.google_color or None) if ev.cliente else None,
        'extendedProperties': {'private': {'aura_evento': str(ev.pk), 'aura_cliente': str(ev.cliente_id or '')}},
    }


def _insertar(cal_id: str, cuerpo: dict) -> dict:
    return _request('POST', f'{_cal(cal_id)}/events', {k: v for k, v in cuerpo.items() if v is not None})


def enviar_evento(ev: EventoUnico):
    destino = calendario_de(ev.etiqueta)
    gid = ev.google_event_id
    origen = _normalizar(ev.google_calendar_id)
    if gid and origen != _normalizar(destino):
        try:
            _request('POST', f'{_cal(origen)}/events/{_q(gid)}/move', params={'destination': destino})
        except NoEncontrado:
            gid = ''
    data = None
    if gid:
        try:
            data = _request('PATCH', f'{_cal(destino)}/events/{_q(gid)}', _cuerpo(ev))
        except NoEncontrado:
            data = None
    if data is None:
        data = _insertar(destino, _cuerpo(ev))
    ev.google_event_id, ev.google_calendar_id = data['id'], destino
    EventoUnico.objects.filter(pk=ev.pk).update(google_event_id=data['id'], google_calendar_id=destino)


def borrar_evento(cal_id: str, gid: str):
    try:
        _request('DELETE', f'{_cal(cal_id or _principal())}/events/{_q(gid)}')
    except NoEncontrado:
        pass


def al_guardar_evento(ev: EventoUnico):
    """Se llama desde la API del panel; un fallo de Google nunca debe impedir guardar el evento."""
    if configurado():
        _seguro(enviar_evento, ev)


def al_borrar_evento(cal_id: str, gid: str):
    if configurado() and gid:
        _seguro(borrar_evento, cal_id, gid)


def _repintar(cliente):
    eventos = EventoUnico.objects.filter(cliente=cliente, inicio__gte=timezone.now() - ENVIAR_DESDE).exclude(google_event_id='')
    for ev in eventos.select_related('cliente'):
        enviar_evento(ev)
    for t in Tarea.objects.filter(cliente=cliente).exclude(google_event_id='').select_related('cliente'):
        enviar_tarea(t)


def al_cambiar_color(cliente):
    if configurado():
        _seguro(_repintar, cliente)


def enviar_pendientes() -> int:
    """Sube lo que no está en el calendario de su etiqueta: eventos sin copia, sin color o en otro calendario."""
    destinos = {c.etiqueta: c.calendar_id for c in CalendarioGoogle.objects.all()}
    enviados = 0
    for ev in EventoUnico.objects.filter(inicio__gte=timezone.now() - ENVIAR_DESDE).select_related('cliente'):
        if ev.etiqueta not in destinos or (ev.google_event_id and ev.google_calendar_id == destinos[ev.etiqueta]):
            continue
        enviar_evento(ev)
        enviados += 1
    return enviados


# --- Panel → Google: tareas ------------------------------------------------------------------------------------------


def _va_al_calendario(t: Tarea) -> bool:
    return bool(t.fecha_limite) and t.estado != 'hecha'


def _cuerpo_tarea(t: Tarea) -> dict:
    return {
        'summary': t.titulo,
        'description': t.descripcion,
        'start': {'date': t.fecha_limite.isoformat()},
        'end': {'date': (t.fecha_limite + timedelta(days=1)).isoformat()},
        'transparency': 'transparent',
        'status': 'confirmed',
        'colorId': (t.cliente.google_color or None) if t.cliente else None,
        'extendedProperties': {'private': {'aura_tarea': str(t.pk), 'aura_cliente': str(t.cliente_id or '')}},
    }


def _huella_tarea(t: Tarea) -> str:
    return hashlib.sha256(json.dumps(_cuerpo_tarea(t), sort_keys=True).encode()).hexdigest()


def _tarea_al_dia(t: Tarea) -> bool:
    if not _va_al_calendario(t):
        return not t.google_event_id
    return bool(t.google_event_id) and t.google_huella == _huella_tarea(t)


def enviar_tarea(t: Tarea):
    if _tarea_al_dia(t):
        return
    cal = calendario_de('operaciones')
    if not _va_al_calendario(t):
        borrar_evento(cal, t.google_event_id)
        t.google_event_id = t.google_huella = ''
    else:
        data = None
        if t.google_event_id:
            try:
                data = _request('PATCH', f'{_cal(cal)}/events/{_q(t.google_event_id)}', _cuerpo_tarea(t))
            except NoEncontrado:
                data = None
        if data is None:
            data = _insertar(cal, _cuerpo_tarea(t))
        t.google_event_id, t.google_huella = data['id'], _huella_tarea(t)
    Tarea.objects.filter(pk=t.pk).update(google_event_id=t.google_event_id, google_huella=t.google_huella)


def al_guardar_tarea(t: Tarea):
    if configurado():
        _seguro(enviar_tarea, t)


def al_borrar_tarea(gid: str):
    if configurado() and gid:
        _seguro(lambda: borrar_evento(calendario_de('operaciones'), gid))


def enviar_tareas() -> int:
    enviadas = 0
    desde = timezone.localdate() - ENVIAR_DESDE
    candidatas = Tarea.objects.filter(~Q(google_event_id='') | Q(fecha_limite__gte=desde)).select_related('cliente')
    for t in candidatas:
        if not _tarea_al_dia(t):
            enviar_tarea(t)
            enviadas += 1
    return enviadas


# --- Google → Panel --------------------------------------------------------------------------------------------------


def _momento(d: dict):
    if d.get('dateTime'):
        return parse_datetime(d['dateTime'])
    if d.get('date'):
        return timezone.make_aware(datetime.combine(parse_date(d['date']), time.min))
    return None


def aplicar_evento(item: dict, cal: CalendarioGoogle, ahora, clientes: list) -> str | None:
    """Aplica un evento (no cancelado) de Google al panel. Devuelve 'creados', 'actualizados' o None."""
    inicio = _momento(item.get('start') or {})
    if inicio is None or not (ahora - TRAER_DESDE <= inicio <= ahora + TRAER_HASTA):
        return None
    fin = _momento(item.get('end') or {})
    if 'date' in (item.get('start') or {}) and fin:
        # En Google el fin de un evento de día completo es exclusivo (el día siguiente a las 00:00).
        fin = None if fin - inicio <= timedelta(days=1) else fin - timedelta(seconds=1)
    cliente = cliente_de(item, clientes, cal.etiqueta)
    datos = {
        'nombre': (item.get('summary') or '(Sin título)')[:120],
        'descripcion': item.get('description') or '',
        'inicio': inicio,
        'fin': fin if fin and fin > inicio else None,
        'cliente_id': cliente.id if cliente else None,
        'etiqueta': cal.etiqueta,
        'google_event_id': item['id'],
        'google_calendar_id': cal.calendar_id,
    }
    ev = EventoUnico.objects.filter(google_event_id=item['id']).first()
    if ev is None:
        aura = _privadas(item).get('aura_evento', '')
        if aura.isdigit():
            ev = EventoUnico.objects.filter(pk=int(aura)).filter(Q(google_event_id='') | Q(google_event_id=item['id'])).first()
    if ev is not None and ev.fin is None and datos['fin'] == inicio + DURACION_DEFECTO:
        datos['fin'] = None
    color = cliente.color if cliente else COLOR_DEFECTO
    if ev is None:
        EventoUnico.objects.create(**datos, color=color)
        return 'creados'
    cambios = {k: v for k, v in datos.items() if getattr(ev, k) != v}
    if not cambios:
        return None
    if 'cliente_id' in cambios:
        cambios['color'] = color
    for k, v in cambios.items():
        setattr(ev, k, v)
    ev.save(update_fields=list(cambios))
    return 'actualizados'


def _listar(cal: CalendarioGoogle):
    params = {'singleEvents': 'true', 'maxResults': 250}
    if cal.sync_token:
        params['syncToken'] = cal.sync_token
    items = []
    while True:
        data = _request('GET', f'{_cal(cal.calendar_id)}/events', params=params)
        items += data.get('items', [])
        if not data.get('nextPageToken'):
            return items, data.get('nextSyncToken', '')
        params['pageToken'] = data['nextPageToken']


def _traer(resumen: dict, ahora):
    clientes = _clientes()
    tareas = dict(Tarea.objects.exclude(google_event_id='').values_list('google_event_id', 'id'))
    cancelados = []
    for cal in CalendarioGoogle.objects.all():
        try:
            items, token = _listar(cal)
        except Vencido:
            cal.sync_token = ''
            items, token = _listar(cal)
        for item in items:
            if item.get('status') == 'cancelled':
                cancelados.append((item['id'], cal.calendar_id))
                continue
            aura_tarea = _privadas(item).get('aura_tarea', '')
            if aura_tarea:
                # Tarea borrada (por ejemplo desde Notion): se limpia su evento. Se vuelve a mirar la base por si
                # la tarea se guardó mientras se listaba.
                huerfano = tareas.get(item['id']) is None or str(tareas[item['id']]) != aura_tarea
                if huerfano and not Tarea.objects.filter(pk=aura_tarea if aura_tarea.isdigit() else 0, google_event_id=item['id']).exists():
                    borrar_evento(cal.calendar_id, item['id'])
                continue
            r = aplicar_evento(item, cal, ahora, clientes)
            if r:
                resumen[r] += 1
        CalendarioGoogle.objects.filter(pk=cal.pk).update(sync_token=token)
    # Al final: un evento movido de calendario figura como cancelado en el de origen.
    for gid, cal_id in cancelados:
        resumen['borrados'] += EventoUnico.objects.filter(google_event_id=gid, google_calendar_id=cal_id).delete()[0]


def sincronizar(completa=False) -> dict:
    estado = EstadoCalendarioGoogle.get()
    inicio = timezone.now()
    if not completa and estado.ultima_sync and inicio - estado.ultima_sync < INTERVALO_INCREMENTAL:
        return {'omitida': True}

    resumen = {'creados': 0, 'actualizados': 0, 'borrados': 0, 'enviados': 0, 'tareas': 0}
    try:
        if completa or not CalendarioGoogle.objects.exists():
            vincular_etiquetas()
        if completa:
            resumen['enviados'] = enviar_pendientes()
        if CalendarioGoogle.objects.filter(etiqueta='operaciones').exists():
            resumen['tareas'] = enviar_tareas()
        _traer(resumen, inicio)
    except google.GoogleError as e:
        registrar_error(str(e))
        raise

    estado.ultima_sync = inicio
    if completa:
        estado.ultima_sync_completa = inicio
    estado.ultimo_error = ''
    estado.save(update_fields=['ultima_sync', 'ultima_sync_completa', 'ultimo_error'])
    return resumen


# --- Pintar lo que ya existe en Google -------------------------------------------------------------------------------


def colores_sugeridos() -> list:
    """Eventos de hoy en adelante sin color cuyo título nombra a un cliente con color de Google.

    Los repetitivos aparecen una sola vez (se pinta la serie completa).
    """
    clientes = [c for c in _clientes() if c.google_color]
    ahora = timezone.now()
    sugeridos = []
    for cal in CalendarioGoogle.objects.all():
        params = {'singleEvents': 'false', 'maxResults': 250, 'timeMin': ahora.isoformat(), 'timeMax': (ahora + TRAER_HASTA).isoformat()}
        while True:
            data = _request('GET', f'{_cal(cal.calendar_id)}/events', params=params)
            for item in data.get('items', []):
                if item.get('status') == 'cancelled' or item.get('colorId') or _privadas(item).get('aura_tarea'):
                    continue
                cliente = cliente_por_titulo(item.get('summary') or '', clientes)
                if cliente is None:
                    continue
                sugeridos.append(
                    {
                        'calendar_id': cal.calendar_id,
                        'event_id': item['id'],
                        'titulo': item.get('summary') or '',
                        'etiqueta': cal.etiqueta,
                        'inicio': (item.get('start') or {}).get('dateTime') or (item.get('start') or {}).get('date'),
                        'repetitivo': bool(item.get('recurrence')),
                        'cliente': cliente.id,
                        'cliente_nombre': cliente.nombre,
                        'color_id': cliente.google_color,
                    }
                )
            if not data.get('nextPageToken'):
                break
            params['pageToken'] = data['nextPageToken']
    return sugeridos


def pintar(eventos: list) -> int:
    """Aplica el color sugerido solo a los eventos elegidos que siguen figurando en la sugerencia."""
    elegidos = {(e.get('calendar_id'), e.get('event_id')) for e in eventos}
    pintados = 0
    for s in colores_sugeridos():
        if (s['calendar_id'], s['event_id']) in elegidos:
            _request(
                'PATCH',
                f"{_cal(s['calendar_id'])}/events/{_q(s['event_id'])}",
                {'colorId': s['color_id'], 'extendedProperties': {'private': {'aura_cliente': str(s['cliente'])}}},
            )
            pintados += 1
    return pintados
