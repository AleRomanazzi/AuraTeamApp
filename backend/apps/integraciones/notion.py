"""Sincronización de Tareas entre el panel y la base «Tareas» de Notion (en los dos sentidos).

Las tareas con etiquetas privadas (solo admins, p. ej. CEOs) van a una base aparte, «Tareas · CEOs», compartida solo
con los socios; si cambian de etiqueta, su página se mueve de base.

- Panel → Notion: cada alta, edición o baja de una tarea en el panel se envía en el momento.
- Notion → Panel: llega por webhook y, como respaldo, por una consulta incremental (throttled) y una completa manual.
- Para no reaplicar ecos propios se guarda en cada tarea una huella de los campos sincronizados.

Las subtareas van como bloques `to_do` del cuerpo de la página; la propiedad Notas sigue siendo la descripción.
Los demás bloques no se tocan. Los nombres de propiedades y opciones deben coincidir con los de Notion
(ver la página «Coordinación Claude ↔ Cursor»). Un fallo de Notion nunca debe impedir guardar en el panel.
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
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.calendario.etiquetas import privadas as etiquetas_privadas
from apps.clientes.models import Cliente
from apps.equipo.models import AsignacionTarea, Persona, Subtarea, Tarea
from apps.equipo.services import estado_segun_subtareas, fijar_estado

from .models import EstadoNotion

logger = logging.getLogger(__name__)

API = 'https://api.notion.com/v1'
VERSION = '2025-09-03'
TIMEOUT = 20
LIMITE_TEXTO = 2000
INTERVALO_INCREMENTAL = timedelta(seconds=60)
DIAS_HECHAS_A_ENVIAR = 30
# Tope de tareas recurrentes que sube cada sincronización incremental, para no pasar el timeout del servidor.
LIMITE_ENVIO = 25
# Páginas por tanda. Cada una pide sus checkboxes: una sincronización completa no entra en el tiempo del servidor.
LIMITE_PAGINAS = 15

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
        raise NotionError(f'Notion respondió {r.status_code} en {method} {path}. {detalle}'.strip())
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


_BOT = {}


def _bot_id() -> str:
    """Usuario (bot) de la integración: las páginas que crea son siempre de tareas del panel."""
    if settings.NOTION_TOKEN not in _BOT:
        _BOT[settings.NOTION_TOKEN] = _norm(_request('GET', '/users/me')['id'])
    return _BOT[settings.NOTION_TOKEN]


def _creada_por_el_panel(page) -> bool:
    autor = (page.get('created_by') or {}).get('id')
    return bool(autor) and _norm(autor) == _bot_id()


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


def _datos_pagina(page, privada=False) -> dict:
    p = page.get('properties') or {}
    datos = {
        'titulo': _texto(p.get(P_TITULO)).strip()[:200],
        'descripcion': _texto(p.get(P_NOTAS)),
        'estado': ESTADOS_INV.get(_select(p.get(P_ESTADO)), 'pendiente'),
        'prioridad': PRIORIDADES_INV.get(_select(p.get(P_PRIORIDAD)), 'media'),
        'fecha_limite': _fecha(p.get(P_FECHA)),
        'cliente': _ids(p.get(P_CLIENTE), 'relation'),
        'personas': _ids(p.get(P_RESPONSABLE), 'people'),
    }
    # Solo se agrega en las privadas para no alterar las huellas ya guardadas de las demás.
    if privada:
        datos['privada'] = True
    return datos


def _marcas(tarea: Tarea) -> list:
    # El listado deja las subtareas en caché: un tildado posterior no se vería.
    if hasattr(tarea, '_prefetched_objects_cache'):
        tarea._prefetched_objects_cache.pop('subtareas', None)
    return [[s.titulo.strip()[:200], bool(s.hecha)] for s in tarea.subtareas.all()]


def _datos_tarea(tarea: Tarea, privada=False) -> dict:
    uids = Persona.objects.filter(asignaciones__tarea=tarea).exclude(notion_user_id='').values_list('notion_user_id', flat=True)
    cliente = tarea.cliente if tarea.cliente_id else None
    datos = {
        'titulo': tarea.titulo.strip()[:200],
        'descripcion': tarea.descripcion,
        'estado': tarea.estado,
        'prioridad': tarea.prioridad,
        'cliente': [_norm(cliente.notion_page_id)] if cliente and cliente.notion_page_id else [],
        'personas': sorted(_norm(u) for u in uids),
    }
    fecha = tarea.fecha_limite
    datos['fecha_limite'] = fecha.isoformat() if hasattr(fecha, 'isoformat') else (fecha or None)
    marcas = _marcas(tarea)
    if marcas:
        datos['subtareas'] = marcas
    if privada:
        datos['privada'] = True
    return datos


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


def _texto_rico(rich) -> str:
    return ''.join(t.get('plain_text') or ((t.get('text') or {}).get('content') or '') for t in rich or []).strip()


def _bloques_todo(page_id) -> list:
    """Checkboxes del cuerpo, en orden. El resto de los bloques no entra."""
    bloques, params = [], {'page_size': 100}
    while True:
        data = _request('GET', f'/blocks/{page_id}/children', params=params)
        for bloque in data.get('results', []):
            if bloque.get('type') != 'to_do' or bloque.get('in_trash') or bloque.get('archived'):
                continue
            titulo = _texto_rico((bloque.get('to_do') or {}).get('rich_text'))[:200]
            if not titulo:
                continue
            bloques.append({
                'id': _norm(bloque['id']),
                'titulo': titulo,
                'hecha': bool((bloque.get('to_do') or {}).get('checked')),
            })
        if not data.get('has_more'):
            return bloques
        params['start_cursor'] = data['next_cursor']


def _sincronizar_bloques(tarea: Tarea, page_id):
    """Crea, actualiza o archiva solo los to_do para que coincidan con las subtareas."""
    if hasattr(tarea, '_prefetched_objects_cache'):
        tarea._prefetched_objects_cache.pop('subtareas', None)
    actuales = _bloques_todo(page_id)
    subs = list(tarea.subtareas.all())
    ids_pagina = [b['id'] for b in actuales]
    ids_subs = [s.notion_block_id for s in subs]
    if subs and ids_subs == ids_pagina and all(ids_subs):
        for sub, bloque in zip(subs, actuales):
            if sub.titulo != bloque['titulo'] or sub.hecha != bloque['hecha']:
                _request('PATCH', f'/blocks/{sub.notion_block_id}', {
                    'to_do': {'rich_text': _rich(sub.titulo), 'checked': sub.hecha},
                })
        return
    for bloque in actuales:
        try:
            _request('PATCH', f'/blocks/{bloque["id"]}', {'in_trash': True})
        except NoEncontrada:
            pass
    if not subs:
        return
    # Notion solo acepta PATCH en esta ruta; un POST responde 400 «Invalid request URL».
    resp = _request('PATCH', f'/blocks/{page_id}/children', {
        'children': [
            {'object': 'block', 'type': 'to_do', 'to_do': {'rich_text': _rich(s.titulo), 'checked': s.hecha}}
            for s in subs
        ],
    })
    resultados = resp.get('results') or []
    if len(resultados) != len(subs):
        raise NotionError('Notion no devolvió todas las subtareas.')
    for sub, bloque in zip(subs, resultados):
        sub.notion_block_id = _norm(bloque['id'])
    Subtarea.objects.bulk_update(subs, ['notion_block_id'])


def _aplicar_checklist(tarea: Tarea, bloques: list):
    """Copia los to_do a las subtareas. No borra las que el panel todavía no subió."""
    actuales = list(tarea.subtareas.all())
    por_bloque = {s.notion_block_id: s for s in actuales if s.notion_block_id}
    locales = [s for s in actuales if not s.notion_block_id]
    antes = [(s.notion_block_id, s.hecha) for s in actuales if s.notion_block_id]
    ids = set()
    for i, bloque in enumerate(bloques):
        sub = por_bloque.get(bloque['id'])
        if sub is None and locales:
            sub = next((s for s in locales if s.titulo == bloque['titulo']), locales[0])
            locales.remove(sub)
        if sub is None:
            sub = Subtarea.objects.create(
                tarea=tarea, titulo=bloque['titulo'], hecha=bloque['hecha'], orden=i, notion_block_id=bloque['id'],
            )
        else:
            sub.titulo = bloque['titulo']
            sub.hecha = bloque['hecha']
            sub.orden = i
            sub.notion_block_id = bloque['id']
            sub.save(update_fields=['titulo', 'hecha', 'orden', 'notion_block_id'])
        ids.add(sub.id)
    for j, sub in enumerate(locales):
        if sub.orden != len(bloques) + j:
            sub.orden = len(bloques) + j
            sub.save(update_fields=['orden'])
    sobrantes = [s.pk for s in actuales if s.notion_block_id and s.notion_block_id not in {b['id'] for b in bloques} and s.id not in ids]
    if sobrantes:
        Subtarea.objects.filter(pk__in=sobrantes).delete()
    if hasattr(tarea, '_prefetched_objects_cache'):
        tarea._prefetched_objects_cache.pop('subtareas', None)
    return antes != [(b['id'], b['hecha']) for b in bloques] or bool(sobrantes)


def _empujar_si_difiere(tarea: Tarea, datos: dict):
    """Si al aplicar la página el panel quedó distinto (por ejemplo, todas tildadas), lo devuelve a Notion."""
    if _huella(_datos_tarea(tarea, 'privada' in datos)) == _huella(datos):
        return
    pk = tarea.pk

    def enviar(pk=pk):
        t = Tarea.objects.filter(pk=pk).first()
        if t is not None:
            t._checklist_tocado = True
            al_guardar_tarea(t)

    transaction.on_commit(enviar)


# --- Panel → Notion --------------------------------------------------------------------------------------------------


def _ds_de(privada: bool) -> str:
    return settings.NOTION_TAREAS_PRIVADAS_DS if privada else settings.NOTION_TAREAS_DS


def _bases():
    """(data source, privada) de las bases de tareas configuradas."""
    return [(ds, privada) for privada in (False, True) if (ds := _ds_de(privada))]


def enviar_tarea(tarea: Tarea):
    privada = tarea.etiqueta in etiquetas_privadas()
    ds = _ds_de(privada)
    datos = _datos_tarea(tarea, privada)
    props = _propiedades(datos)
    page_id = vieja = tarea.notion_page_id
    if page_id and tarea.notion_privada != privada:
        page_id = None
    elif page_id:
        try:
            _request('PATCH', f'/pages/{page_id}', {'properties': props})
        except NoEncontrada:
            page_id = None
    if not page_id and ds:
        try:
            page = _request('POST', '/pages', {'parent': {'type': 'data_source_id', 'data_source_id': ds}, 'properties': props})
        except NoEncontrada as e:
            if privada:
                raise NotionError('La integración no está conectada a la base «Tareas · CEOs» de Notion.') from e
            raise
        page_id = _norm(page['id'])
        # El webhook de la página recién creada puede llegar antes de guardar el vínculo y crear un eco: se descarta.
        Tarea.objects.filter(notion_page_id=page_id).exclude(pk=tarea.pk).delete()
    if page_id and (getattr(tarea, '_checklist_tocado', False) or tarea.subtareas.exists()):
        _sincronizar_bloques(tarea, page_id)
        datos = _datos_tarea(tarea, privada)
    tarea.notion_page_id = page_id
    tarea.notion_huella = _huella(datos) if page_id else ''
    tarea.notion_privada = privada
    Tarea.objects.filter(pk=tarea.pk).update(notion_page_id=page_id, notion_huella=tarea.notion_huella, notion_privada=privada)
    if vieja and vieja != page_id:
        # Cambió de base: la página vieja se borra después de vincular la nueva, así su webhook no borra la tarea.
        try:
            _request('PATCH', f'/pages/{vieja}', {'in_trash': True})
        except NoEncontrada:
            pass


def _seguro(fn, *args):
    try:
        fn(*args)
    except NotionError as e:
        registrar_error(str(e))
    except Exception:
        logger.exception('Error sincronizando con Notion')
        registrar_error('Error inesperado sincronizando con Notion (ver logs del servidor).')


def _es_de_servicio(tarea: Tarea) -> bool:
    # Pagos y aportes de servicios llevan montos: el dinero vive solo en el panel, no van a Notion.
    return Tarea.objects.filter(pk=tarea.pk, aviso_servicio__isnull=False).exists()


def al_guardar_tarea(tarea: Tarea):
    """Se llama desde la API del panel; un fallo de Notion nunca debe impedir guardar la tarea."""
    if configurado() and not _es_de_servicio(tarea):
        _seguro(enviar_tarea, tarea)


def al_vincular_persona(persona: Persona):
    if configurado():
        _seguro(reenviar_tareas, Q(asignaciones__persona=persona))


def al_cambiar_privacidad(etiqueta: str):
    """Una etiqueta pasó a ser (o dejó de ser) privada: sus tareas se mudan de base en Notion."""
    if configurado():
        _seguro(reenviar_tareas, Q(etiqueta=etiqueta))


def al_borrar_tarea(page_id):
    if configurado() and page_id:
        _seguro(lambda: _request('PATCH', f'/pages/{page_id}', {'in_trash': True}))


# --- Notion → Panel --------------------------------------------------------------------------------------------------


def aplicar_pagina(page, candidatos=None, forzar_clientes=(), privada=False):
    """Aplica una página de una base de tareas al panel. Devuelve 'creada', 'actualizada', 'vinculada', 'borrada' o None.

    `forzar_clientes`: páginas de clientes recién vinculados; sus tareas se reaplican aunque la huella no cambie.
    `privada`: la página es de la base privada; sus tareas llevan una etiqueta privada.
    """
    pid = _norm(page['id'])
    tarea = Tarea.objects.filter(notion_page_id=pid).first()
    if page.get('in_trash') or page.get('archived'):
        if tarea:
            tarea.delete()
            return 'borrada'
        return None
    bloques = _bloques_todo(pid)
    datos = _datos_pagina(page, privada)
    if bloques:
        datos['subtareas'] = [[b['titulo'], b['hecha']] for b in bloques]
    if not datos['titulo']:
        return None
    huella = _huella(datos)
    forzada = bool(datos['cliente']) and datos['cliente'][0] in forzar_clientes
    if tarea and tarea.notion_huella == huella and not forzada:
        return None

    resultado = 'actualizada'
    if tarea is None and candidatos:
        tarea = candidatos.pop(_clave(datos['titulo']), None)
        resultado = 'vinculada' if tarea else resultado
    if tarea is None:
        if _creada_por_el_panel(page):
            # Página de una tarea del panel cuyo vínculo todavía no se guardó (o se borró): no se duplica.
            return None
        tarea = Tarea()
        resultado = 'creada'

    anterior = tarea.estado if tarea.pk else None
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
            # Un cliente del panel sin página en Notion no se puede representar allá: no se pierde por eso.
            if tarea.cliente_id is None or tarea.cliente.notion_page_id:
                tarea.cliente = None
        else:
            cliente = Cliente.objects.filter(notion_page_id=datos['cliente'][0]).first()
            if cliente:
                tarea.cliente = cliente
        privadas = etiquetas_privadas()
        if privada and tarea.etiqueta not in privadas:
            tarea.etiqueta = 'ceos'
        elif not privada and tarea.etiqueta in privadas:
            tarea.etiqueta = Tarea._meta.get_field('etiqueta').default
        tarea.notion_privada = privada
        tarea.notion_huella = huella
        tarea.save()
        _aplicar_responsables(tarea, datos['personas'])
        # Si el checklist cambió, manda él (todas hechas → hecha; destildar una hecha → en curso).
        # Si no cambió y en Notion la pasaron a Hecha, se tildan todas.
        cambio = _aplicar_checklist(tarea, bloques)
        if datos['estado'] == 'hecha' and anterior != 'hecha':
            tarea.subtareas.filter(hecha=False).update(hecha=True)
        elif cambio:
            fijar_estado(tarea, estado_segun_subtareas(tarea, tarea.estado))
        _empujar_si_difiere(tarea, datos)
    if anterior and anterior != tarea.estado:
        from apps.notificaciones.services import al_cambiar_estado

        transaction.on_commit(lambda: al_cambiar_estado(tarea, anterior))
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
    if deseadas - actuales:
        from apps.notificaciones.services import al_asignar

        transaction.on_commit(lambda: al_asignar(tarea, list(deseadas - actuales)))


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
    ds = _norm((page.get('parent') or {}).get('data_source_id') or '')
    for base, privada in _bases():
        if ds == _norm(base):
            return aplicar_pagina(page, privada=privada)
    return None


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
    nuevos, sin_panel = [], []
    for page in _consultar(settings.NOTION_CLIENTES_DS):
        pid = _norm(page['id'])
        if pid in ya or page.get('in_trash'):
            continue
        nombre = _texto((page.get('properties') or {}).get(P_CLIENTE_NOMBRE)).strip()
        cliente = libres.pop(_clave(nombre), None)
        if cliente:
            Cliente.objects.filter(pk=cliente.pk).update(notion_page_id=pid)
            nuevos.append(pid)
        elif nombre:
            sin_panel.append(nombre)
    return {
        'vinculados': len(nuevos),
        'nuevos': nuevos,
        'solo_en_notion': sin_panel,
        'solo_en_panel': sorted(c.nombre for c in libres.values() if c.estado != 'baja'),
    }


def _sin_pagina(sin_privadas=False):
    limite = timezone.now() - timedelta(days=DIAS_HECHAS_A_ENVIAR)
    qs = Tarea.objects.filter(notion_page_id__isnull=True, aviso_servicio__isnull=True).exclude(estado='hecha', completada_en__lt=limite)
    if sin_privadas or not settings.NOTION_TAREAS_PRIVADAS_DS:
        qs = qs.exclude(etiqueta__in=etiquetas_privadas())
    return qs


def enviar_pendientes(sin_privadas=False) -> int:
    """Sube de a LIMITE_ENVIO las tareas que todavía no tienen página (recurrentes, planes del mes, envíos fallidos)."""
    n = 0
    for pk in _sin_pagina(sin_privadas).values_list('pk', flat=True)[:LIMITE_ENVIO]:
        # El bloqueo evita que dos sincronizaciones simultáneas creen dos páginas para la misma tarea.
        with transaction.atomic():
            tarea = Tarea.objects.select_for_update(skip_locked=True).filter(pk=pk, notion_page_id__isnull=True).first()
            if tarea:
                enviar_tarea(tarea)
                n += 1
    return n


def reenviar_tareas(filtro) -> int:
    """Vuelve a enviar a Notion tareas ya vinculadas (p. ej. tras vincular su cliente o una persona)."""
    n = 0
    for tarea in Tarea.objects.filter(filtro).exclude(notion_page_id=None).select_related('cliente').distinct():
        enviar_tarea(tarea)
        n += 1
    return n


def vincular_personas() -> list:
    lista = usuarios()
    usados = set(Persona.objects.exclude(notion_user_id='').values_list('notion_user_id', flat=True))
    vinculadas = []
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
            vinculadas.append(persona.pk)
    return vinculadas


# --- Sincronización --------------------------------------------------------------------------------------------------


def _momento(iso):
    if not iso:
        return None
    cuando = parse_datetime(iso)
    if cuando and timezone.is_naive(cuando):
        cuando = timezone.make_aware(cuando, timezone.get_current_timezone())
    return cuando


def sincronizar(completa=False, cursor=None) -> dict:
    estado = EstadoNotion.get()
    inicio = timezone.now()
    if not completa and not cursor and estado.ultima_sync and inicio - estado.ultima_sync < INTERVALO_INCREMENTAL:
        return {'omitida': True}

    resumen = {'creadas': 0, 'actualizadas': 0, 'vinculadas': 0, 'borradas': 0, 'enviadas': 0}
    forzar_clientes = set()
    try:
        if completa and not cursor:
            clientes = vincular_clientes()
            forzar_clientes = set(clientes.pop('nuevos'))
            personas = vincular_personas()
            resumen['clientes'] = clientes
            resumen['personas_vinculadas'] = len(personas)
            # Lo que el panel ya tenía de esos clientes/personas tiene que llegar a Notion antes de leerlo de vuelta.
            reenviar_tareas(Q(cliente__notion_page_id__in=forzar_clientes) | Q(asignaciones__persona_id__in=personas))
        desde = _momento(cursor) if cursor else None
        if desde is None and not completa and estado.ultima_sync:
            # Recién sincronizado: se solapan 5 min por si algo se editó en el medio.
            # Si quedó atrasada es un corte de tanda: se sigue desde ahí, sin releer las mismas páginas.
            desde = estado.ultima_sync - timedelta(minutes=5) if inicio - estado.ultima_sync < timedelta(minutes=3) else estado.ultima_sync
        filtro = {'timestamp': 'last_edited_time', 'last_edited_time': {'on_or_after': desde.isoformat()}} if desde else None
        candidatos = {_clave(t.titulo): t for t in Tarea.objects.filter(notion_page_id__isnull=True)} if completa else None

        vistas, sin_leer, paginas = set(), [], []
        for ds, privada in _bases():
            try:
                leidas = list(_consultar(ds, filtro))
            except NoEncontrada:
                if not privada:
                    raise
                # La base privada todavía no está conectada a la integración: el resto se sincroniza igual.
                sin_leer.append(privada)
                resumen['privadas_sin_conectar'] = True
                continue
            for page in leidas:
                page['_privada'] = privada
                paginas.append(page)
        paginas.sort(key=lambda p: p.get('last_edited_time') or '')
        # Sin fecha (los tests) se procesa todo: en Notion las páginas siempre traen last_edited_time.
        corte = len(paginas) > LIMITE_PAGINAS and all(p.get('last_edited_time') for p in paginas)
        if corte:
            paginas = paginas[:LIMITE_PAGINAS]
        for page in paginas:
            vistas.add(_norm(page['id']))
            r = aplicar_pagina(page, candidatos, forzar_clientes, page.pop('_privada', False))
            if r:
                resumen[{'creada': 'creadas', 'actualizada': 'actualizadas', 'vinculada': 'vinculadas', 'borrada': 'borradas'}[r]] += 1

        if corte:
            resumen['continuar'] = True
            resumen['cursor'] = (paginas[-1].get('last_edited_time') if paginas else None)
        elif completa and cursor is None:
            sobrantes = Tarea.objects.exclude(notion_page_id=None).exclude(notion_page_id__in=vistas).exclude(notion_privada__in=sin_leer)
            for tarea in sobrantes:
                try:
                    page = _request('GET', f'/pages/{tarea.notion_page_id}')
                except NoEncontrada:
                    page = {'in_trash': True}
                if page.get('in_trash') or page.get('archived'):
                    tarea.delete()
                    resumen['borradas'] += 1
                else:
                    Tarea.objects.filter(pk=tarea.pk).update(notion_page_id=None, notion_huella='')
            for tarea in _sin_pagina(bool(sin_leer)).select_related('cliente'):
                enviar_tarea(tarea)
                resumen['enviadas'] += 1
        else:
            resumen['enviadas'] = enviar_pendientes(bool(sin_leer))
            resumen['pendientes'] = _sin_pagina(bool(sin_leer)).count()
            if completa and resumen['pendientes']:
                resumen['continuar'] = True
                resumen['cursor'] = cursor
    except NotionError as e:
        registrar_error(str(e))
        raise

    if resumen.get('continuar') and resumen.get('cursor'):
        estado.ultima_sync = _momento(resumen['cursor']) or inicio
    else:
        estado.ultima_sync = inicio
        if completa:
            estado.ultima_sync_completa = inicio
    estado.ultimo_error = ''
    estado.save(update_fields=['ultima_sync', 'ultima_sync_completa', 'ultimo_error'])
    return resumen
