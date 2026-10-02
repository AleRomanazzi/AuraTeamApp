import base64
import hashlib
import time
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.db import transaction

from .models import CuentaGoogle

SCOPES = (
    'https://www.googleapis.com/auth/gmail.readonly '
    'https://www.googleapis.com/auth/gmail.send '
    'https://www.googleapis.com/auth/calendar'
)
AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN_URL = 'https://oauth2.googleapis.com/token'
REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
STATE_SALT = 'aura.google.oauth'
STATE_MAX_AGE = 600
CACHE_KEY = 'aura.google.access_token'
MARGEN_SEGUNDOS = 120
TIMEOUT = 15


class GoogleError(Exception):
    """Error recuperable de la integración (mensaje apto para mostrar)."""


class GoogleDesconectada(GoogleError):
    pass


def configurado() -> bool:
    return bool(settings.AURA_GOOGLE_CLIENT_ID and settings.AURA_GOOGLE_CLIENT_SECRET)


def _fernet() -> Fernet:
    base = settings.AURA_GOOGLE_TOKEN_KEY or settings.SECRET_KEY
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(base.encode()).digest()))


def _cifrar(valor: str) -> str:
    return _fernet().encrypt(valor.encode()).decode()


def _descifrar(valor: str) -> str:
    try:
        return _fernet().decrypt(valor.encode()).decode()
    except InvalidToken as e:
        raise GoogleDesconectada('La clave de cifrado cambió: volvé a conectar la cuenta de Google.') from e


def cuenta() -> CuentaGoogle | None:
    return CuentaGoogle.objects.first()


def redirect_uri(request) -> str:
    return settings.AURA_GOOGLE_REDIRECT_URI or request.build_absolute_uri('/api/auth/google/callback/')


def url_autorizacion(request) -> str:
    if not configurado():
        raise GoogleError('Faltan AURA_GOOGLE_CLIENT_ID y AURA_GOOGLE_CLIENT_SECRET en el servidor.')
    params = {
        'client_id': settings.AURA_GOOGLE_CLIENT_ID,
        'redirect_uri': redirect_uri(request),
        'response_type': 'code',
        'scope': SCOPES,
        'access_type': 'offline',
        'prompt': 'consent',
        'include_granted_scopes': 'true',
        'state': signing.dumps({'u': request.user.id}, salt=STATE_SALT),
    }
    if settings.AURA_GOOGLE_LOGIN_HINT:
        params['login_hint'] = settings.AURA_GOOGLE_LOGIN_HINT
    return f'{AUTH_URL}?{urlencode(params)}'


def leer_state(state: str) -> int:
    try:
        return signing.loads(state, salt=STATE_SALT, max_age=STATE_MAX_AGE)['u']
    except (signing.BadSignature, KeyError, TypeError) as e:
        raise GoogleError('El enlace de conexión venció o no es válido. Probá de nuevo.') from e


def _guardar_access_token(data: dict) -> dict:
    expira = int(data.get('expires_in') or 3600)
    token = {'access_token': data['access_token'], 'expira_en': time.time() + expira}
    cache.set(CACHE_KEY, token, max(expira - MARGEN_SEGUNDOS, 60))
    return token


def _post_token(payload: dict) -> dict:
    payload = {**payload, 'client_id': settings.AURA_GOOGLE_CLIENT_ID, 'client_secret': settings.AURA_GOOGLE_CLIENT_SECRET}
    try:
        r = httpx.post(TOKEN_URL, data=payload, timeout=TIMEOUT)
    except httpx.HTTPError as e:
        raise GoogleError('No se pudo contactar a Google. Probá en un rato.') from e
    data = r.json() if r.headers.get('content-type', '').startswith('application/json') else {}
    if r.status_code != 200:
        if data.get('error') == 'invalid_grant':
            raise GoogleDesconectada('Google revocó el acceso: volvé a conectar la cuenta.')
        raise GoogleError(f"Google rechazó la solicitud ({data.get('error_description') or data.get('error') or r.status_code}).")
    return data


@transaction.atomic
def conectar(code: str, request, user) -> CuentaGoogle:
    data = _post_token({'code': code, 'grant_type': 'authorization_code', 'redirect_uri': redirect_uri(request)})
    if not data.get('refresh_token'):
        raise GoogleError('Google no entregó un permiso permanente. Quitá el acceso de la app en tu cuenta de Google y reintentá.')
    email = ''
    try:
        perfil = httpx.get(PROFILE_URL, headers={'Authorization': f"Bearer {data['access_token']}"}, timeout=TIMEOUT)
        if perfil.status_code == 200:
            email = perfil.json().get('emailAddress', '')
    except httpx.HTTPError:
        pass
    CuentaGoogle.objects.all().delete()
    c = CuentaGoogle.objects.create(
        email=email, refresh_token=_cifrar(data['refresh_token']), scopes=data.get('scope', ''), conectada_por=user
    )
    _guardar_access_token(data)
    return c


def access_token() -> dict:
    """Devuelve un access token vigente (cacheado) renovándolo con el refresh token guardado."""
    token = cache.get(CACHE_KEY)
    if token and token['expira_en'] - time.time() > MARGEN_SEGUNDOS:
        return token
    c = cuenta()
    if c is None:
        raise GoogleDesconectada('La cuenta de Google de la agencia no está conectada.')
    # Si no se puede descifrar (otra clave, p. ej. desde una máquina local contra la base de producción) la cuenta no
    # se borra: solo se borra cuando Google revocó el acceso.
    refresh = _descifrar(c.refresh_token)
    try:
        data = _post_token({'refresh_token': refresh, 'grant_type': 'refresh_token'})
    except GoogleDesconectada:
        CuentaGoogle.objects.all().delete()
        cache.delete(CACHE_KEY)
        raise
    return _guardar_access_token(data)


def desconectar() -> None:
    c = cuenta()
    if c is not None:
        try:
            httpx.post(REVOKE_URL, data={'token': _descifrar(c.refresh_token)}, timeout=TIMEOUT)
        except (httpx.HTTPError, GoogleError):
            pass
    CuentaGoogle.objects.all().delete()
    cache.delete(CACHE_KEY)
