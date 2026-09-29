import io

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient


@pytest.fixture(autouse=True)
def _aislar(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path / 'media'
    settings.AI_ASYNC = False
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def user(db):
    User = get_user_model()
    return User.objects.create_user(username='testuser', password='testpass1234', email='test@example.com', rol='admin')


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def persona(db):
    from apps.equipo.models import Persona

    return Persona.objects.create(nombre='Lau')


@pytest.fixture
def equipo_user(db, persona):
    User = get_user_model()
    return User.objects.create_user(username='equipo', password='testpass1234', rol='equipo', persona=persona)


@pytest.fixture
def equipo_client(equipo_user):
    client = APIClient()
    client.force_authenticate(user=equipo_user)
    return client


@pytest.fixture
def imagen_png():
    def _crear(nombre='a.png'):
        buf = io.BytesIO()
        Image.new('RGB', (4, 4), (200, 10, 10)).save(buf, format='PNG')
        return SimpleUploadedFile(nombre, buf.getvalue(), content_type='image/png')

    return _crear
