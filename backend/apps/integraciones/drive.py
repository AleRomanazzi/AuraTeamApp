"""Carpetas de Drive de los clientes, en la cuenta de Google de la agencia: Mi unidad → CLIENTES → {cliente}.

Usa el scope completo `drive` para encontrar las carpetas que ya existen. Antes de crear la de un cliente busca una con
su nombre (o razón social) dentro de CLIENTES y, si la hay, la vincula. CLIENTES nunca se crea: si no aparece, falla.
"""

import re
import unicodedata

import httpx
from django.conf import settings

from apps.accounts import google

API = 'https://www.googleapis.com/drive/v3/files'
SCOPE = 'https://www.googleapis.com/auth/drive'
CARPETA = 'application/vnd.google-apps.folder'
RAIZ = 'CLIENTES'
TIMEOUT = 15


def _request(method, params=None, body=None):
    if method != 'GET' and settings.GOOGLE_CALENDAR_SOLO_LECTURA:
        raise google.GoogleError('Google está en modo solo lectura (GOOGLE_CALENDAR_SOLO_LECTURA).')
    token = google.access_token()['access_token']
    try:
        r = httpx.request(method, API, headers={'Authorization': f'Bearer {token}'}, params=params, json=body, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        raise google.GoogleError(f'No se pudo contactar a Google Drive ({e.__class__.__name__}).') from e
    if r.status_code == 403:
        raise google.GoogleError('Google Drive no da permiso: reconectá la cuenta de Google en Configuración para habilitar Drive.')
    if r.status_code >= 400:
        try:
            detalle = r.json().get('error', {}).get('message', '')
        except ValueError:
            detalle = ''
        raise google.GoogleError(f'Google Drive respondió {r.status_code}. {detalle}'.strip())
    return r.json() if r.content else {}


def tiene_permiso() -> bool:
    c = google.cuenta()
    return bool(c and SCOPE in c.scopes.split())


def _exigir_permiso():
    # Con un permiso parcial (drive.file) Drive no muestra las carpetas existentes y se crearían duplicadas.
    if not tiene_permiso():
        raise google.GoogleError('Falta el permiso completo de Google Drive: reconectá la cuenta de Google en Configuración.')


def normalizar(nombre: str) -> str:
    sin_tildes = unicodedata.normalize('NFKD', nombre or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', ' ', sin_tildes.lower()).strip()


def id_de_link(texto: str) -> str:
    """Id de carpeta a partir de un link de Drive (o el id pegado tal cual). Vacío si no se reconoce."""
    texto = (texto or '').strip()
    m = re.search(r'/folders/([\w-]{10,})', texto) or re.search(r'[?&]id=([\w-]{10,})', texto)
    if m:
        return m.group(1)
    return texto if re.fullmatch(r'[\w-]{10,}', texto) else ''


def _subcarpetas(padre: str) -> list[dict]:
    q = f"mimeType = '{CARPETA}' and trashed = false and '{padre}' in parents"
    carpetas, page = [], None
    while True:
        params = {'q': q, 'fields': 'nextPageToken, files(id, name)', 'pageSize': 1000}
        if page:
            params['pageToken'] = page
        data = _request('GET', params=params)
        carpetas += data.get('files', [])
        page = data.get('nextPageToken')
        if not page:
            return carpetas


def carpeta_raiz() -> str:
    if settings.DRIVE_CARPETA_CLIENTES:
        return settings.DRIVE_CARPETA_CLIENTES
    for c in _subcarpetas('root'):
        if normalizar(c['name']) == normalizar(RAIZ):
            return c['id']
    raise google.GoogleError(f'No encontré la carpeta «{RAIZ}» en Mi unidad de la cuenta de la agencia.')


def _buscar(cliente, carpetas: list[dict]) -> str:
    nombres = {normalizar(n) for n in (cliente.nombre, cliente.razon_social) if normalizar(n)}
    return next((c['id'] for c in carpetas if normalizar(c['name']) in nombres), '')


def vincular(cliente, carpeta_id: str) -> str:
    cliente.drive_folder_id = carpeta_id
    cliente.save(update_fields=['drive_folder_id'])
    return cliente.drive_url


def crear_carpeta_cliente(cliente) -> str:
    """Vincula la carpeta del cliente dentro de CLIENTES (la crea solo si no existe). Devuelve el link."""
    if cliente.drive_folder_id:
        return cliente.drive_url
    _exigir_permiso()
    raiz = carpeta_raiz()
    existente = _buscar(cliente, _subcarpetas(raiz))
    if existente:
        return vincular(cliente, existente)
    nueva = _request('POST', params={'fields': 'id'}, body={'name': cliente.nombre[:120], 'mimeType': CARPETA, 'parents': [raiz]})
    return vincular(cliente, nueva['id'])


def vincular_existentes(clientes) -> dict:
    """Vincula a cada cliente sin carpeta la suya dentro de CLIENTES. Nunca crea carpetas."""
    _exigir_permiso()
    carpetas = _subcarpetas(carpeta_raiz())
    vinculados, sin_carpeta = [], []
    for cliente in clientes:
        if cliente.drive_folder_id:
            continue
        existente = _buscar(cliente, carpetas)
        if existente:
            vincular(cliente, existente)
            vinculados.append(cliente.nombre)
        else:
            sin_carpeta.append(cliente.nombre)
    return {'vinculados': vinculados, 'sin_carpeta': sin_carpeta}
