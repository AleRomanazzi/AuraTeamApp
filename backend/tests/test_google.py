from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from django.core.cache import cache

from apps.accounts import google
from apps.accounts.models import CuentaGoogle


class _Resp:
    def __init__(self, status, data):
        self.status_code = status
        self._data = data
        self.headers = {'content-type': 'application/json'}

    def json(self):
        return self._data


@pytest.fixture(autouse=True)
def _config(settings):
    settings.AURA_GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com'
    settings.AURA_GOOGLE_CLIENT_SECRET = 'secreto'
    settings.AURA_GOOGLE_REDIRECT_URI = 'https://api.test/api/auth/google/callback/'
    settings.FRONTEND_URL = 'https://panel.test'


@pytest.fixture
def google_falso(monkeypatch):
    llamadas = []

    def post(url, data=None, timeout=None):
        llamadas.append((url, data))
        if url == google.TOKEN_URL and data['grant_type'] == 'authorization_code':
            return _Resp(200, {'access_token': 'at-1', 'refresh_token': 'rt-1', 'expires_in': 3599, 'scope': google.SCOPES})
        if url == google.TOKEN_URL and data['grant_type'] == 'refresh_token':
            if data['refresh_token'] != 'rt-1':
                return _Resp(400, {'error': 'invalid_grant'})
            return _Resp(200, {'access_token': 'at-2', 'expires_in': 3599})
        return _Resp(200, {})

    monkeypatch.setattr(httpx, 'post', post)
    monkeypatch.setattr(httpx, 'get', lambda url, headers=None, timeout=None: _Resp(200, {'emailAddress': 'aura@gmail.com'}))
    return llamadas


def _conectar(api_client):
    url = api_client.post('/api/auth/google/conectar/').data['url']
    state = parse_qs(urlparse(url).query)['state'][0]
    return api_client.get('/api/auth/google/callback/', {'code': 'c0de', 'state': state})


@pytest.mark.django_db
def test_conectar_guarda_refresh_token_cifrado(api_client, google_falso):
    url = api_client.post('/api/auth/google/conectar/').data['url']
    q = parse_qs(urlparse(url).query)
    assert q['access_type'] == ['offline'] and q['prompt'] == ['consent']

    r = _conectar(api_client)
    assert r.status_code == 302 and r['Location'] == 'https://panel.test/config?tab=google&google=ok'
    c = CuentaGoogle.objects.get()
    assert c.email == 'aura@gmail.com' and c.refresh_token != 'rt-1'
    assert api_client.get('/api/auth/me/').data['google_conectado'] is True
    assert api_client.get('/api/auth/google/').data['email'] == 'aura@gmail.com'


@pytest.mark.django_db
def test_token_se_renueva_con_refresh_token(api_client, google_falso):
    _conectar(api_client)
    assert api_client.get('/api/auth/google/token/').data['access_token'] == 'at-1'
    cache.clear()
    r = api_client.get('/api/auth/google/token/')
    assert r.data['access_token'] == 'at-2' and r.data['expires_in'] > 3000


@pytest.mark.django_db
def test_refresh_revocado_desconecta(api_client, google_falso):
    _conectar(api_client)
    CuentaGoogle.objects.update(refresh_token=google._cifrar('otro'))
    cache.clear()
    r = api_client.get('/api/auth/google/token/')
    assert r.status_code == 409 and r.data['desconectada'] is True
    assert not CuentaGoogle.objects.exists()


@pytest.mark.django_db
def test_state_invalido_y_permisos(api_client, equipo_client, google_falso):
    r = api_client.get('/api/auth/google/callback/', {'code': 'x', 'state': 'trucho'})
    assert r.status_code == 302 and 'google=error' in r['Location']
    assert not CuentaGoogle.objects.exists()
    assert equipo_client.post('/api/auth/google/conectar/').status_code == 403
    assert equipo_client.get('/api/auth/google/token/').status_code == 403
    assert equipo_client.get('/api/auth/google/').status_code == 200


@pytest.mark.django_db
def test_desconectar_revoca(api_client, google_falso):
    _conectar(api_client)
    assert api_client.post('/api/auth/google/desconectar/').status_code == 204
    assert not CuentaGoogle.objects.exists()
    assert any(url == google.REVOKE_URL for url, _ in google_falso)
