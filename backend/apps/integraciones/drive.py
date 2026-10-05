"""Carpetas de Drive de los clientes, en la cuenta de Google de la agencia.

Usa el scope `drive.file`: el panel solo ve y toca lo que creó él mismo.
"""

import httpx
from django.conf import settings

from apps.accounts import google

API = 'https://www.googleapis.com/drive/v3/files'
CARPETA = 'application/vnd.google-apps.folder'
RAIZ = ('AuraTeam', 'Clientes')
SUBCARPETAS = ('Brief', 'Material crudo', 'Ediciones', 'Diseños', 'Reportes')
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


def _carpeta(nombre: str, padre: str | None = None) -> str:
    """Id de la carpeta con ese nombre dentro de `padre` (la crea si no existe)."""
    escapado = nombre.replace('\\', '\\\\').replace("'", "\\'")
    q = f"name = '{escapado}' and mimeType = '{CARPETA}' and trashed = false and '{padre or 'root'}' in parents"
    encontradas = _request('GET', params={'q': q, 'fields': 'files(id)', 'pageSize': 1}).get('files', [])
    if encontradas:
        return encontradas[0]['id']
    body = {'name': nombre, 'mimeType': CARPETA, 'parents': [padre or 'root']}
    return _request('POST', params={'fields': 'id'}, body=body)['id']


def crear_carpeta_cliente(cliente) -> str:
    """Crea AuraTeam/Clientes/{nombre} con sus subcarpetas y guarda el id en el cliente. Devuelve el link."""
    if cliente.drive_folder_id:
        return cliente.drive_url
    padre = None
    for nombre in RAIZ:
        padre = _carpeta(nombre, padre)
    carpeta = _carpeta(cliente.nombre[:120], padre)
    for nombre in SUBCARPETAS:
        _carpeta(nombre, carpeta)
    cliente.drive_folder_id = carpeta
    cliente.save(update_fields=['drive_folder_id'])
    return cliente.drive_url
