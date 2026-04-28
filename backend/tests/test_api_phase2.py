import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APIClient

from apps.finanzas.models import Transaccion


@pytest.mark.django_db
def test_dashboard_requires_auth():
    r = APIClient().get('/api/dashboard/')
    assert r.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_dashboard_ok(api_client, user):
    Transaccion.objects.create(
        user=user,
        fecha='2026-04-15',
        descripcion='Test',
        categoria='cat',
        tipo='ingreso',
        monto='100.00',
    )
    r = api_client.get('/api/dashboard/', {'mes': '2026-04'})
    assert r.status_code == status.HTTP_200_OK
    assert r.data['mes'] == '2026-04'
    assert r.data['ingresos_mes'] == '100.00'


@pytest.mark.django_db
def test_transacciones_crud(api_client, user):
    r = api_client.post(
        '/api/transacciones/',
        {
            'fecha': '2026-04-01',
            'descripcion': 'Compra',
            'categoria': 'varios',
            'tipo': 'egreso',
            'monto': '50.00',
            'notas': '',
        },
        format='json',
    )
    assert r.status_code == status.HTTP_201_CREATED
    pk = r.data['id']
    r2 = api_client.get('/api/transacciones/')
    assert r2.status_code == status.HTTP_200_OK
    assert len(r2.data) == 1
    r3 = api_client.put(f'/api/transacciones/{pk}/', {'fecha': '2026-04-01', 'descripcion': 'Compra2', 'categoria': 'varios', 'tipo': 'egreso', 'monto': '40.00', 'notas': 'n'}, format='json')
    assert r3.status_code == status.HTTP_200_OK
    assert r3.data['descripcion'] == 'Compra2'
    r4 = api_client.delete(f'/api/transacciones/{pk}/')
    assert r4.status_code == status.HTTP_204_NO_CONTENT


@pytest.mark.django_db
def test_tareas_no_put(api_client, user):
    r = api_client.post('/api/tareas/', {'titulo': 'T1', 'descripcion': ''}, format='json')
    assert r.status_code == status.HTTP_201_CREATED
    pk = r.data['id']
    r2 = api_client.put(f'/api/tareas/{pk}/', {'titulo': 'X'}, format='json')
    assert r2.status_code == status.HTTP_405_METHOD_NOT_ALLOWED


@pytest.mark.django_db
def test_stats_analizar_validation(api_client):
    r = api_client.post('/api/stats/analizar/', {}, format='multipart')
    assert r.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_stats_analizar_creates(api_client, user, tmp_path):
    img = SimpleUploadedFile('a.jpg', b'\xff\xd8\xff\xd9', content_type='image/jpeg')
    r = api_client.post('/api/stats/analizar/', {'antes': img, 'plataforma': 'ig'}, format='multipart')
    assert r.status_code == status.HTTP_201_CREATED
    assert 'interpretacion' in r.data


@pytest.mark.django_db
def test_me_config_put(api_client, user):
    r = api_client.put('/api/me/config/', {'moneda': '€', 'nombre_display': 'Tester'}, format='json')
    assert r.status_code == status.HTTP_200_OK
    assert r.data['moneda'] == '€'
    assert r.data['nombre_display'] == 'Tester'


@pytest.mark.django_db
def test_me_export_import_roundtrip(api_client, user):
    api_client.post(
        '/api/transacciones/',
        {
            'fecha': '2026-03-01',
            'descripcion': 'A',
            'categoria': 'c',
            'tipo': 'ingreso',
            'monto': '10.00',
            'notas': '',
        },
        format='json',
    )
    ex = api_client.get('/api/me/export/')
    assert ex.status_code == status.HTTP_200_OK
    body = ex.data
    api_client.delete('/api/me/data/')
    assert Transaccion.objects.filter(user=user).count() == 0
    imp = api_client.post('/api/me/import/', body, format='json')
    assert imp.status_code == status.HTTP_200_OK
    assert Transaccion.objects.filter(user=user).count() >= 1
