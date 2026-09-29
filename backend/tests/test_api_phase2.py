import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework import status
from rest_framework.test import APIClient

from apps.finanzas.models import Categoria, Transaccion


def cat(nombre='Fee mensual', tipo='ingreso'):
    return Categoria.objects.get_or_create(nombre=nombre, tipo=tipo)[0]


@pytest.mark.django_db
def test_dashboard_requires_auth():
    r = APIClient().get('/api/dashboard/')
    assert r.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_health_sin_auth():
    r = APIClient().get('/api/health/')
    assert r.status_code == 200


@pytest.mark.django_db
def test_dashboard_ok(api_client, user):
    Transaccion.objects.create(user=user, fecha='2026-04-15', descripcion='Test', categoria=cat(), tipo='ingreso', monto='100.00')
    Transaccion.objects.create(user=user, fecha='2026-03-15', descripcion='Prev', categoria=cat(), tipo='ingreso', monto='50.00')
    r = api_client.get('/api/dashboard/', {'mes': '2026-04'})
    assert r.status_code == status.HTTP_200_OK
    assert r.data['mes'] == '2026-04'
    assert r.data['ingresos_mes'] == '100.00'
    assert r.data['variacion']['ingresos'] == 100.0
    assert len(r.data['series_6_meses']) == 6


@pytest.mark.django_db
def test_dashboard_mes_invalido(api_client):
    r = api_client.get('/api/dashboard/', {'mes': '2026-13'})
    assert r.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_transacciones_crud(api_client, user):
    c = cat('Oficina', 'egreso')
    body = {'fecha': '2026-04-01', 'descripcion': 'Compra', 'categoria': c.id, 'tipo': 'egreso', 'monto': '50.00', 'notas': ''}
    r = api_client.post('/api/transacciones/', body, format='json')
    assert r.status_code == status.HTTP_201_CREATED
    pk = r.data['id']
    assert r.data['categoria_nombre'] == 'Oficina'
    r2 = api_client.get('/api/transacciones/')
    assert len(r2.data) == 1
    r3 = api_client.put(f'/api/transacciones/{pk}/', {**body, 'descripcion': 'Compra2', 'monto': '40.00'}, format='json')
    assert r3.status_code == status.HTTP_200_OK
    assert r3.data['descripcion'] == 'Compra2'
    assert api_client.delete(f'/api/transacciones/{pk}/').status_code == status.HTTP_204_NO_CONTENT


@pytest.mark.django_db
def test_transaccion_categoria_de_otro_tipo(api_client):
    r = api_client.post(
        '/api/transacciones/',
        {'fecha': '2026-04-01', 'descripcion': 'X', 'categoria': cat().id, 'tipo': 'egreso', 'monto': '5'},
        format='json',
    )
    assert r.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_transacciones_paginacion_opcional(api_client, user):
    for i in range(3):
        Transaccion.objects.create(user=user, fecha='2026-04-01', descripcion=f'T{i}', categoria=cat(), tipo='ingreso', monto='1')
    assert isinstance(api_client.get('/api/transacciones/').data, list)
    r = api_client.get('/api/transacciones/', {'page': 1})
    assert r.data['count'] == 3


@pytest.mark.django_db
def test_export_csv_escapa_formulas(api_client, user):
    Transaccion.objects.create(user=user, fecha='2026-04-01', descripcion='=HYPERLINK("x")', categoria=cat(), tipo='ingreso', monto='1234.50')
    r = api_client.get('/api/transacciones/export.csv/')
    contenido = r.content.decode('utf-8-sig')
    assert "'=HYPERLINK" in contenido
    assert '1234,50' in contenido
    assert ';' in contenido.splitlines()[0]


@pytest.mark.django_db
def test_adjunto_valida_contenido_real(api_client, user, imagen_png):
    tx = Transaccion.objects.create(user=user, fecha='2026-04-01', descripcion='X', categoria=cat(), tipo='ingreso', monto='1')
    falso = SimpleUploadedFile('f.pdf', b'<script>alert(1)</script>', content_type='application/pdf')
    assert api_client.post(f'/api/transacciones/{tx.id}/adjuntos/', {'archivo': falso}, format='multipart').status_code == 400
    r = api_client.post(f'/api/transacciones/{tx.id}/adjuntos/', {'archivo': imagen_png()}, format='multipart')
    assert r.status_code == 201
    d = api_client.get(f'/api/adjuntos/{r.data["id"]}/descargar/')
    assert d.status_code == 200


@pytest.mark.django_db
def test_tareas_crud_y_estado(api_client, persona):
    r = api_client.post('/api/tareas/', {'titulo': 'T1', 'asignados': [persona.id]}, format='json')
    assert r.status_code == status.HTTP_201_CREATED
    assert r.data['asignados'] == [persona.id]
    pk = r.data['id']
    r2 = api_client.patch(f'/api/tareas/{pk}/', {'estado': 'hecha'}, format='json')
    assert r2.data['completada_en'] is not None
    r3 = api_client.patch(f'/api/tareas/{pk}/', {'estado': 'pendiente'}, format='json')
    assert r3.data['completada_en'] is None


@pytest.mark.django_db
def test_stats_analizar_validation(api_client):
    r = api_client.post('/api/stats/analizar/', {}, format='multipart')
    assert r.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_stats_rechaza_imagen_falsa(api_client):
    img = SimpleUploadedFile('a.jpg', b'\xff\xd8\xff\xd9', content_type='image/jpeg')
    r = api_client.post('/api/stats/analizar/', {'antes': img}, format='multipart')
    assert r.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_stats_analizar_creates(api_client, imagen_png, monkeypatch):
    monkeypatch.delenv('AI_API_KEY', raising=False)
    r = api_client.post('/api/stats/analizar/', {'antes': imagen_png(), 'plataforma': 'instagram'}, format='multipart')
    assert r.status_code == status.HTTP_201_CREATED
    assert r.data['estado'] == 'listo'
    pk = r.data['id']
    r2 = api_client.patch(f'/api/stats/{pk}/', {'metricas': [{'nombre': 'Seguidores', 'antes': 10, 'despues': 12}]}, format='json')
    assert r2.status_code == 200
    assert r2.data['metricas'][0]['nombre'] == 'Seguidores'


@pytest.mark.django_db
def test_stats_limite_imagenes(api_client, imagen_png):
    files = [imagen_png(f'{i}.png') for i in range(7)]
    r = api_client.post('/api/stats/analizar/', {'antes': files}, format='multipart')
    assert r.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_me_config_put(api_client):
    r = api_client.put('/api/me/config/', {'nombre_display': 'Tester'}, format='json')
    assert r.status_code == status.HTTP_200_OK
    assert r.data['nombre_display'] == 'Tester'
    assert r.data['es_admin'] is True


@pytest.mark.django_db
def test_me_export_import_roundtrip(api_client, user):
    api_client.post('/api/clientes/', {'nombre': 'Acme'}, format='json')
    cliente_id = api_client.get('/api/clientes/').data[0]['id']
    api_client.post(
        '/api/transacciones/',
        {'fecha': '2026-03-01', 'descripcion': 'A', 'categoria': cat().id, 'tipo': 'ingreso', 'monto': '10.00', 'cliente': cliente_id},
        format='json',
    )
    ex = api_client.get('/api/me/export/')
    assert ex.status_code == status.HTTP_200_OK
    body = ex.json()
    assert body['version'] == 2
    assert api_client.delete('/api/me/data/').status_code == 400
    assert api_client.delete('/api/me/data/?confirmar=BORRAR').status_code == 204
    assert Transaccion.objects.count() == 0
    imp = api_client.post('/api/me/import/', body, format='json')
    assert imp.status_code == status.HTTP_200_OK, imp.data
    assert imp.data['total_errores'] == 0
    tx = Transaccion.objects.get()
    assert tx.cliente.nombre == 'Acme'


@pytest.mark.django_db
def test_import_v1_legacy(api_client):
    body = {
        'version': 1,
        'transacciones': [{'fecha': '2026-01-02', 'descripcion': 'Viejo', 'categoria': 'Varios', 'tipo': 'egreso', 'monto': '5'}],
        'cal_clientes': [{'titulo': 'Cliente Viejo', 'dia_mes': 7, 'monto': '1000'}],
    }
    r = api_client.post('/api/me/import/', body, format='json')
    assert r.status_code == 200, r.data
    assert Transaccion.objects.get().categoria.nombre == 'Varios'
    from apps.clientes.models import Contrato

    assert Contrato.objects.get().dia_vencimiento == 7
