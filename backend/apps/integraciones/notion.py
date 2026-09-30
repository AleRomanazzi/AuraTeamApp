"""Sincronización de Tareas entre el panel y la base «Tareas» de Notion (en los dos sentidos).

- Panel → Notion: cada alta, edición o baja de una tarea en el panel se envía en el momento.
- Notion → Panel: llega por webhook y, como respaldo, por una consulta incremental (throttled) y una completa manual.
- Para no reaplicar ecos propios se guarda en cada tarea una huella de los campos sincronizados.

Los nombres de propiedades y opciones deben coincidir con los de Notion (ver la página «Coordinación Claude ↔ Cursor»).
"""

import hashlib
import hmac
import json
import logging
import re
import time
import unicodedata
import uuid
from datetime import timedelta

import httpx
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.clientes.models import Cliente
from apps.equipo.models import AsignacionTarea, Persona, Tarea

from .models import EstadoNotion

logger = logging.getLogger(__name__)

API = 'https://api.notion.com/v1'
VERSION = '2025-09-03'
TIMEOUT = 20
LIMITE_TEXTO = 2000
INTERVALO_INCREMENTAL = timedelta(seconds=60)
DIAS_HECHAS_A_ENVIAR = 30

P_TITULO = 'Tarea'
P_NOTAS = 'Notas'
P_ESTADO = 'Estado'
P_PRIORIDAD = 'Prioridad'
P_FECHA = 'Fecha'
P_CLIENTE = 'Cliente'
P_RESPONSABLE = 'Responsable'
P_CLIENTE_NOMBRE = 'Cliente'

ESTADOS = {'pendiente': 'Por hacer', 'en_curso': 'En progreso', 'bloqueada': 'Bloqueada', 'en_revision': 'En revisión', 'hecha': 'Hecha'}
ESTADOS_INV = {v: k for k, v in ESTADOS.items()}
PRIORIDADES = {'alta': 'Alta', 'media': 'Media', 'baja': 'Baja'}
PRIORIDADES_INV = {v: k for k, v in PRIORIDADES.items()}


class NotionError(Exception):
    """Error de la integración con un mensaje apto para mostrar."""


class NoEncontrada(NotionError):
    pass


def configurado() -> bool:
    return bool(settings.NOTION_TOKEN)


def _norm(valor) -> str:
    return str(uuid.UUID(str(valor)))


def _clave(texto: str) -> str:
    sin_tildes = unicodedata.normalize('NFKD', texto or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', sin_tildes.lower())


def _request(method, path, body=None, params=None):
    if not configurado():
        raise NotionError('Falta NOTION_TOKEN en el servidor.')
    headers = {'Authorization': f'Bearer {settings.NOTION_TOKEN}', 'Notion-Version': VERSION}
    for intento in range(3):
        try:
            r = httpx.request(method, f'{API}{path}', headers=headers, json=body, params=params, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            raise NotionError(f'No se pudo contactar a Notion ({e.__class__.__name__}).') from e
        if r.status_code == 429 and intento < 2:
            time.sleep(min(float(r.headers.get('retry-after') or 1), 5))
            continue
        break
    if r.status_code == 404:
        raise NoEncontrada('Notion no encuentra el recurso (¿la integración está conectada a la base?).')
    if r.status_code >= 400:
        try:
            detalle = r.json().get('message', '')
        except ValueError:
            detalle = ''
        raise NotionError(f'Notion respondió {r.status_code}. {detalle}'.strip())
    return r.json()


def _consultar(ds_id, filtro=None):
    body = {'page_size': 100}
    if filtro:
        body['filter'] = filtro
    while True:
        data = _request('POST', f'/data_sources/{ds_id}/query', body)
        yield from data.get('results', [])
        if not data.get('has_more'):
            return
        body['start_cursor'] = data['next_cursor']


def registrar_error(mensaje: str):
    EstadoNotion.objects.update_or_create(pk=1, defaults={'ultimo_error': mensaje[:1000], 'ultimo_error_en': timezone.now()})


# --- Conversión de propiedades -------------------------------------------------------------------------------------


def _texto(prop) -> str:
    if not prop:
        return ''
    return ''.join(t.get('plain_text', '') for t in prop.get(prop.get('type'), None) or [])


def _select(prop):
    s = (prop or {}).get('select')
    return s.get('name') if s else None


def _fecha(prop):
    d = (prop or {}).get('date')
    return d['start'][:10] if d and d.get('start') else None


def _ids(prop, tipo):
    return sorted(_norm(x['id']) for x in (prop or {}).get(tipo) or [])


def _rich(texto: str):
    trozos = [texto[i : i + LIMITE_TEXTO] for i in range(0, len(texto), LIMITE_TEXTO)][:100]
    return [{'type': 'text', 'text': {'content': t}} for t in trozos]


def _datos_pagina(page) -> dict:
    p = page.get('properties') or {}
    return {
        'titulo': _texto(p.get(P_TITULO)).strip()[:200],
        'descripcion': _texto(p.get(P_NOTAS)),
        'estado': ESTADOS_INV.get(_select(p.get(P_ESTADO)), 'pendiente'),
        'prioridad': PRIORIDADES_INV.get(_select(p.get(P_PRIORIDAD)), 'media'),
        'fecha_limite': _fecha(p.get(P_FECHA)),
        'cliente': _ids(p.get(P_CLIENTE), 'relation'),
        'personas': _ids(p.get(P_RESPONSABLE), 'people'),
    }


def _datos_tarea(tarea: Tarea) -> dict:
    uids = Persona.objects.filter(asignaciones__tarea=tarea).exclude(notion_user_id='').values_list('notion_user_id', flat=True)
    cliente = tarea.cliente if tarea.cliente_id else None
    return {
        'titulo': tarea.titulo.strip()[:200],
        'descripcion': tarea.descripcion,
        'estado': tarea.estado,
        'prioridad': tarea.prioridad,
        'fecha_limite': tarea.fecha_limite.isoformat() if tarea.fecha_limite else None,
        'cliente': [_norm(cliente.notion_page_id)] if cliente and cliente.notion_page_id else [],
        'personas': sorted(_norm(u) for u in uids),
    }


def _huella(datos: dict) -> str:
    return hashlib.sha256(json.dumps(datos, sort_keys=True).encode()).hexdigest()


def _propiedades(d: dict) -> dict:
    return {
        P_TITULO: {'title': _rich(d['titulo'])},
        P_NOTAS: {'rich_text': _rich(d['descripcion'])},
        P_ESTADO: {'select': {'name': ESTADOS[d['estado']]}},
        P_PRIORIDAD: {'select': {'name': PRIORIDADES[d['prioridad']]}},
        P_FECHA: {'date': {'start': d['fecha_limite']} if d['fecha_limite'] else None},
        P_CLIENTE: {'relation': [{'id': x} for x in d['cliente']]},
        P_RESPONSABLE: {'people': [{'id': x} for x in d['personas']]},
    }


# --- Panel → Notion --------------------------------------------------------------------------------------------------


def enviar_tarea(tarea: Tarea):
    datos = _datos_tarea(tarea)
    props = _propiedades(datos)
    page_id = tarea.notion_page_id
    if page_id:
        try:
            _request('PATCH', f'/pages/{page_id}', {'properties': props})
        except NoEncontrada:
            page_id = None
    if not page_id:
        page = _request(
            'POST', '/pages', {'parent': {'type': 'data_source_id', 'data_source_id': settings.NOTION_TAREAS_DS}, 'properties': props}
        )
        page_id = _norm(page['id'])
    tarea.notion_page_id = page_id
    tarea.notion_huella = _huella(datos)
    Tarea.objects.filter(pk=tarea.pk).update(notion_page_id=page_id, notion_huella=tarea.notion_huella)


def _seguro(fn, *args):
    try:
        fn(*args)
    except NotionError as e:
        registrar_error(str(e))
    except Exception:
        logger.exception('Error sincronizando con Notion')
        registrar_error('Error inesperado sincronizando con Notion (ver logs del servidor).')


def al_guardar_tarea(tarea: Tarea):
    """Se llama desde la API del panel; un fallo de Notion nunca debe impedir guardar la tarea."""
    if configurado():
        _seguro(enviar_tarea, tarea)


def al_borrar_tarea(page_id):
    if configurado() and page_id:
        _seguro(lambda: _request('PATCH', f'/pages/{page_id}', {'in_trash': True}))


# --- Notion → Panel --------------------------------------------------------------------------------------------------


def aplicar_pagina(page, candidatos=None):
    """Aplica una página de la base Tareas al panel. Devuelve 'creada', 'actualizada', 'vinculada', 'borrada' o None."""
    pid = _norm(page['id'])
    tarea = Tarea.objects.filter(notion_page_id=pid).first()
    if page.get('in_trash') or page.get('archived'):
        if tarea:
            tarea.delete()
            return 'borrada'
        return None
    datos = _datos_pagina(page)
    if not datos['titulo']:
        return None
    huella = _huella(datos)
    if tarea and tarea.notion_huella == huella:
        return None

    resultado = 'actualizada'
    if tarea is None and candidatos:
        tarea = candidatos.pop(_clave(datos['titulo']), None)
        resultado = 'vinculada' if tarea else resultado
    if tarea is None:
        tarea = Tarea()
        resultado = 'creada'

    with transaction.atomic():
        if datos['estado'] == 'hecha' and tarea.estado != 'hecha':
            tarea.completada_en = timezone.now()
        elif datos['estado'] != 'hecha':
            tarea.completada_en = None
        tarea.notion_page_id = pid
        tarea.titulo = datos['titulo']
        tarea.descripcion = datos['descripcion']
        tarea.estado = datos['estado']
        tarea.prioridad = datos['prioridad']
        tarea.fecha_limite = datos['fecha_limite']
        if not datos['cliente']:
            tarea.cliente = None
        else:
            cliente = Cliente.objects.filter(notion_page_id=datos['cliente'][0]).first()
            if cliente:
                tarea.cliente = cliente
        tarea.notion_huella = huella
        tarea.save()
        _aplicar_responsables(tarea, datos['personas'])
    return resultado


def _aplicar_responsables(tarea: Tarea, uids):
    """Solo toca asignaciones de personas vinculadas a un usuario de Notion; el resto se respeta."""
    vinculadas = {_norm(p.notion_user_id): p for p in Persona.objects.exclude(notion_user_id='')}
    deseadas = {vinculadas[u].id for u in uids if u in vinculadas}
    ids_vinculadas = [p.id for p in vinculadas.values()]
    tarea.asignaciones.filter(persona_id__in=ids_vinculadas).exclude(persona_id__in=deseadas).delete()
    actuales = set(tarea.asignaciones.values_list('persona_id', flat=True))
    for pid in deseadas - actuales:
        AsignacionTarea.objects.create(persona_id=pid, tarea=tarea)


def procesar_evento(evento: dict):
    entidad = evento.get('entity') or {}
    if entidad.get('type') != 'page' or not str(evento.get('type', '')).startswith('page.'):
        return None
    pid = _norm(entidad['id'])
    try:
        page = _request('GET', f'/pages/{pid}')
    except NoEncontrada:
        borradas, _ = Tarea.objects.filter(notion_page_id=pid).delete()
        return 'borrada' if borradas else None
    ds = (page.get('parent') or {}).get('data_source_id')
    if not ds or _norm(ds) != _norm(settings.NOTION_TAREAS_DS):
        return None
    return aplicar_pagina(page)


def firma_valida(cuerpo: bytes, firma: str, token: str) -> bool:
    esperado = 'sha256=' + hmac.new(token.encode(), cuerpo, hashlib.sha256).hexdigest()
    return hmac.compare_digest(esperado, firma or '')


# --- Vínculos de clientes y personas ------------------------------------------------------------------------------


def usuarios():
    lista, params = [], {'page_size': 100}
    while True:
        data = _request('GET', '/users', params=params)
        for u in data.get('results', []):
            if u.get('type') == 'person':
                lista.append({'id': _norm(u['id']), 'nombre': u.get('name') or '', 'email': (u.get('person') or {}).get('email', '')})
        if not data.get('has_more'):
            return lista
        params['start_cursor'] = data['next_cursor']


def vincular_clientes() -> dict:
    libres = {_clave(c.nombre): c for c in Cliente.objects.filter(notion_page_id__isnull=True)}
    ya = set(Cliente.objects.exclude(notion_page_id=None).values_list('notion_page_id', flat=True))
    vinculados, sin_panel = 0, []
    for page in _consultar(settings.NOTION_CLIENTES_DS):
        pid = _norm(page['id'])
        if pid in ya or page.get('in_trash'):
            continue
        nombre = _texto((page.get('properties') or {}).get(P_CLIENTE_NOMBRE)).strip()
        cliente = libres.pop(_clave(nombre), None)
        if cliente:
            Cliente.objects.filter(pk=cliente.pk).update(notion_page_id=pid)
            vinculados += 1
        elif nombre:
            sin_panel.append(nombre)
    return {'vinculados': vinculados, 'solo_en_notion': sin_panel, 'solo_en_panel': sorted(c.nombre for c in libres.values())}


def vincular_personas() -> int:
    lista = usuarios()
    usados = set(Persona.objects.exclude(notion_user_id='').values_list('notion_user_id', flat=True))
    vinculadas = 0
    for persona in Persona.objects.filter(notion_user_id='', activo=True):
        clave = _clave(persona.nombre)
        primer = _clave(persona.nombre.split()[0]) if persona.nombre.split() else ''
        opciones = [
            u for u in lista
            if u['id'] not in usados and clave and (clave in _clave(u['nombre']) or primer == _clave(u['nombre'].split()[0] if u['nombre'].split() else ''))
        ]
        if len(opciones) == 1:
            Persona.objects.filter(pk=persona.pk).update(notion_user_id=opciones[0]['id'])
            usados.add(opciones[0]['id'])
            vinculadas += 1
    return vinculadas


# --- Sincronización --------------------------------------------------------------------------------------------------


def sincronizar(completa=False) -> dict:
    estado = EstadoNotion.get()
    inicio = timezone.now()
    if not completa and estado.ultima_sync and inicio - estado.ultima_sync < INTERVALO_INCREMENTAL:
        return {'omitida': True}

    resumen = {'creadas': 0, 'actualizadas': 0, 'vinculadas': 0, 'borradas': 0, 'enviadas': 0}
    try:
        if completa:
            resumen['clientes'] = vincular_clientes()
            resumen['personas_vinculadas'] = vincular_personas()
        filtro = None
        if not completa and estado.ultima_sync:
            desde = estado.ultima_sync - timedelta(minutes=5)
            filtro = {'timestamp': 'last_edited_time', 'last_edited_time': {'on_or_after': desde.isoformat()}}
        candidatos = {_clave(t.titulo): t for t in Tarea.objects.filter(notion_page_id__isnull=True)} if completa else None

        vistas = set()
        for page in _consultar(settings.NOTION_TAREAS_DS, filtro):
            vistas.add(_norm(page['id']))
            r = aplicar_pagina(page, candidatos)
            if r:
                resumen[{'creada': 'creadas', 'actualizada': 'actualizadas', 'vinculada': 'vinculadas', 'borrada': 'borradas'}[r]] += 1

        if completa:
            for tarea in Tarea.objects.exclude(notion_page_id=None).exclude(notion_page_id__in=vistas):
                try:
                    page = _request('GET', f'/pages/{tarea.notion_page_id}')
                except NoEncontrada:
                    page = {'in_trash': True}
                if page.get('in_trash') or page.get('archived'):
                    tarea.delete()
                    resumen['borradas'] += 1
                else:
                    Tarea.objects.filter(pk=tarea.pk).update(notion_page_id=None, notion_huella='')
            limite = timezone.now() - timedelta(days=DIAS_HECHAS_A_ENVIAR)
            pendientes = Tarea.objects.filter(notion_page_id__isnull=True).exclude(estado='hecha', completada_en__lt=limite)
            for tarea in pendientes.select_related('cliente'):
                enviar_tarea(tarea)
                resumen['enviadas'] += 1
    except NotionError as e:
        registrar_error(str(e))
        raise

    estado.ultima_sync = inicio
    if completa:
        estado.ultima_sync_completa = inicio
    estado.ultimo_error = ''
    estado.save(update_fields=['ultima_sync', 'ultima_sync_completa', 'ultimo_error'])
    return resumen
