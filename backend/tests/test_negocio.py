from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from apps.clientes.models import Cliente, Cobro, Contrato
from apps.equipo.models import Liquidacion, Persona, Tarea
from apps.finanzas.models import Categoria, Transaccion
from apps.servicios.models import Servicio


@pytest.fixture
def cliente(db):
    return Cliente.objects.create(nombre='Panadería Sol')


@pytest.fixture
def contrato(cliente):
    return Contrato.objects.create(cliente=cliente, concepto='Fee redes', monto=Decimal('100000'), dia_vencimiento=31, fecha_inicio='2026-01-01')


@pytest.mark.django_db
def test_generar_cobros_idempotente(api_client, contrato):
    r = api_client.post('/api/cobros/generar/', {'mes': '2026-02'}, format='json')
    assert r.data['creados'] == 1
    r2 = api_client.post('/api/cobros/generar/', {'mes': '2026-02'}, format='json')
    assert r2.data['creados'] == 0
    cobro = Cobro.objects.get()
    assert str(cobro.vencimiento) == '2026-02-28'
    assert cobro.monto == Decimal('100000')


@pytest.mark.django_db
def test_generar_cobros_periodicidad(api_client, cliente):
    Contrato.objects.create(cliente=cliente, concepto='Trimestral', monto=300, periodicidad='trimestral', fecha_inicio='2026-01-10')
    meses = {m: api_client.post('/api/cobros/generar/', {'mes': m}, format='json').data['creados'] for m in ('2026-01', '2026-02', '2026-04')}
    assert meses == {'2026-01': 1, '2026-02': 0, '2026-04': 1}


@pytest.mark.django_db
def test_generar_cobros_mes_requerido(api_client):
    assert api_client.post('/api/cobros/generar/', {}, format='json').status_code == 400


@pytest.mark.django_db
def test_pago_parcial_y_total_crea_un_solo_ingreso(api_client, contrato):
    api_client.post('/api/cobros/generar/', {'mes': '2026-02'}, format='json')
    cobro = Cobro.objects.get()
    r = api_client.post(f'/api/cobros/{cobro.id}/registrar-pago/', {'monto': '40000', 'medio_pago': 'transferencia'}, format='json')
    assert r.status_code == 200
    assert r.data['estado'] == 'parcial'
    assert r.data['saldo'] == '60000.00'
    r = api_client.post(f'/api/cobros/{cobro.id}/registrar-pago/', {'monto': '70000'}, format='json')
    assert r.status_code == 400
    r = api_client.post(f'/api/cobros/{cobro.id}/registrar-pago/', {}, format='json')
    assert r.data['estado'] == 'pagado'
    tx = Transaccion.objects.get()
    assert tx.monto == Decimal('100000') and tx.tipo == 'ingreso' and tx.cliente_id == contrato.cliente_id
    assert tx.categoria.nombre == 'Fee mensual'


@pytest.mark.django_db
def test_revertir_y_borrar_transaccion_resetea_cobro(api_client, contrato):
    api_client.post('/api/cobros/generar/', {'mes': '2026-02'}, format='json')
    cobro = Cobro.objects.get()
    api_client.post(f'/api/cobros/{cobro.id}/registrar-pago/', {}, format='json')
    r = api_client.post(f'/api/cobros/{cobro.id}/revertir-pago/')
    assert r.data['estado'] == 'pendiente'
    assert Transaccion.objects.count() == 0

    api_client.post(f'/api/cobros/{cobro.id}/registrar-pago/', {}, format='json')
    tx = Transaccion.objects.get()
    api_client.delete(f'/api/transacciones/{tx.id}/')
    cobro.refresh_from_db()
    assert cobro.estado == 'pendiente' and cobro.monto_cobrado == 0


@pytest.mark.django_db
def test_no_editar_monto_de_tx_vinculada(api_client, contrato):
    api_client.post('/api/cobros/generar/', {'mes': '2026-02'}, format='json')
    cobro = Cobro.objects.get()
    api_client.post(f'/api/cobros/{cobro.id}/registrar-pago/', {}, format='json')
    tx = Transaccion.objects.get()
    r = api_client.patch(f'/api/transacciones/{tx.id}/', {'monto': '1'}, format='json')
    assert r.status_code == 400


@pytest.mark.django_db
def test_ajuste_precio(api_client, contrato):
    api_client.post('/api/cobros/generar/', {'mes': '2026-03'}, format='json')
    r = api_client.post(f'/api/contratos/{contrato.id}/ajustar/', {'fecha_desde': '2026-03-01', 'porcentaje': '10'}, format='json')
    assert r.status_code == 201
    assert r.data['ajuste']['monto_nuevo'] == '110000.00'
    assert Cobro.objects.get().monto == Decimal('110000')
    contrato.refresh_from_db()
    assert contrato.monto_para(__import__('datetime').date(2026, 2, 1)) == Decimal('100000')


@pytest.mark.django_db
def test_cliente_con_cobros_no_se_borra(api_client, contrato):
    api_client.post('/api/cobros/generar/', {'mes': '2026-02'}, format='json')
    r = api_client.delete(f'/api/clientes/{contrato.cliente_id}/')
    assert r.status_code == 400


@pytest.mark.django_db
def test_cliente_deuda_y_fee(api_client, contrato):
    api_client.post('/api/cobros/generar/', {'mes': '2026-01'}, format='json')
    data = api_client.get('/api/clientes/').data[0]
    assert data['deuda'] == '100000.00'
    assert data['deuda_vencida'] == '100000.00'
    assert data['fee_mensual'] == '100000.00'


@pytest.mark.django_db
def test_repartir_ya_pagado_registra_egresos(api_client, persona, contrato):
    otra = Persona.objects.create(nombre='Andi')
    r = api_client.post(
        '/api/liquidaciones/repartir/',
        {
            'cliente': contrato.cliente_id, 'periodo': '2026-03', 'concepto': 'Fee marzo', 'pagado': True,
            'fecha': '2026-03-12', 'medio_pago': 'transferencia',
            'filas': [{'persona': persona.id, 'monto': '30000'}, {'persona': otra.id, 'monto': '50000'}],
        },
        format='json',
    )
    assert r.status_code == 201
    assert {l['estado'] for l in r.data} == {'pagada'}
    egresos = Transaccion.objects.filter(tipo='egreso', cliente=contrato.cliente)
    assert egresos.count() == 2 and sum(e.monto for e in egresos) == Decimal('80000')
    assert {str(e.fecha) for e in egresos} == {'2026-03-12'}


@pytest.mark.django_db
def test_liquidaciones_repartir_y_pagar(api_client, persona, contrato):
    api_client.post('/api/cobros/generar/', {'mes': '2026-02'}, format='json')
    cobro = Cobro.objects.get()
    api_client.post(f'/api/cobros/{cobro.id}/registrar-pago/', {'fecha': '2026-02-10'}, format='json')

    base = {'cliente': contrato.cliente_id, 'periodo': '2026-02', 'filas': [{'persona': persona.id, 'monto': '20000'}]}
    duplicada = {**base, 'filas': base['filas'] * 2}
    assert api_client.post('/api/liquidaciones/repartir/', duplicada, format='json').status_code == 400
    r = api_client.post('/api/liquidaciones/repartir/', base, format='json')
    assert r.status_code == 201 and r.data[0]['estado'] == 'pendiente'
    assert not Transaccion.objects.filter(tipo='egreso').exists()
    liq = Liquidacion.objects.get()
    assert liq.origen == 'manual' and liq.total == Decimal('20000') and liq.concepto == contrato.cliente.nombre

    r = api_client.patch(
        f'/api/liquidaciones/{liq.id}/', {'items': [{'concepto': 'Reel extra', 'cantidad': '2', 'monto_unitario': '1500'}]}, format='json'
    )
    assert r.data['total'] == '23000.00'
    r = api_client.post(f'/api/liquidaciones/{liq.id}/pagar/', {'medio_pago': 'transferencia'}, format='json')
    assert r.data['estado'] == 'pagada'
    egreso = Transaccion.objects.get(tipo='egreso')
    assert egreso.monto == Decimal('23000') and egreso.persona_id == persona.id
    assert egreso.categoria.nombre == 'Honorarios del equipo'
    assert api_client.patch(f'/api/liquidaciones/{liq.id}/', {'notas': 'x'}, format='json').status_code == 400

    rent = api_client.get('/api/rentabilidad/', {'mes': '2026-02'}).data['clientes'][0]
    assert rent['ingresos'] == '100000.00'
    assert rent['costo_equipo'] == '23000.00'
    assert rent['margen'] == '77000.00'

    r = api_client.post(f'/api/liquidaciones/{liq.id}/revertir/')
    assert r.data['estado'] == 'aprobada'
    assert not Transaccion.objects.filter(tipo='egreso').exists()


@pytest.mark.django_db
def test_suscripciones_generar_egresos(api_client):
    s = Servicio.objects.create(nombre='Canva', monto_total=Decimal('30000'), mi_parte=Decimal('10000'), dia_vencimiento=31)
    r = api_client.post('/api/servicios/generar-egresos/', {'mes': '2026-02'}, format='json')
    assert r.data['creados'] == 1
    assert api_client.post('/api/servicios/generar-egresos/', {'mes': '2026-02'}, format='json').data['creados'] == 0
    tx = Transaccion.objects.get()
    assert tx.monto == Decimal('10000') and str(tx.fecha) == '2026-02-28'
    assert api_client.get('/api/servicios/', {'mes': '2026-02'}).data[0]['pagado_mes'] is True
    r = api_client.patch(f'/api/servicios/{s.id}/', {'mi_parte': '99999'}, format='json')
    assert r.status_code == 400


@pytest.mark.django_db
def test_suscripcion_reparto_debe_sumar_total(api_client):
    r = api_client.post(
        '/api/servicios/',
        {'nombre': 'X', 'monto_total': '100', 'metodo': 'personalizado', 'detalle': [{'nombre': 'A', 'monto': '30'}]},
        format='json',
    )
    assert r.status_code == 400


@pytest.mark.django_db
def test_rol_equipo_no_ve_finanzas(equipo_client):
    for url in ('/api/transacciones/', '/api/dashboard/', '/api/cobros/', '/api/servicios/', '/api/usuarios/', '/api/me/export/'):
        assert equipo_client.get(url).status_code == 403, url


@pytest.mark.django_db
def test_rol_equipo_ve_todas_las_tareas_y_edita_las_suyas(equipo_client, equipo_user, persona, cliente):
    from apps.equipo.models import Persona

    otra = Persona.objects.create(nombre='Otra')
    mia = Tarea.objects.create(titulo='Mía', cliente=cliente)
    mia.asignaciones.create(persona=persona)
    ajena = Tarea.objects.create(titulo='Ajena')
    ajena.asignaciones.create(persona=otra)
    data = {t['titulo']: t for t in equipo_client.get('/api/tareas/').data}
    assert set(data) == {'Mía', 'Ajena'}
    assert data['Mía']['puede_editar'] and not data['Ajena']['puede_editar']

    assert equipo_client.patch(f'/api/tareas/{mia.id}/', {'estado': 'hecha', 'titulo': 'Mía 2'}, format='json').status_code == 200
    assert equipo_client.patch(f'/api/tareas/{ajena.id}/', {'estado': 'hecha'}, format='json').status_code == 403
    assert equipo_client.patch(f'/api/tareas/{mia.id}/', {'asignados': [otra.id]}, format='json').status_code == 403
    assert equipo_client.delete(f'/api/tareas/{mia.id}/').status_code == 403

    r = equipo_client.post('/api/tareas/', {'titulo': 'Nueva'}, format='json')
    assert r.status_code == 201 and r.data['asignados'] == [persona.id] and r.data['creado_por'] == equipo_user.id
    r = equipo_client.patch(f'/api/tareas/{r.data["id"]}/', {'asignados': [persona.id, otra.id]}, format='json')
    assert r.status_code == 200, r.data

    clientes = equipo_client.get('/api/clientes/').data
    assert set(clientes[0].keys()) == {'id', 'nombre', 'color', 'estado'}
    panel = equipo_client.get('/api/mi-panel/').data
    assert panel['persona']['nombre'] == persona.nombre


@pytest.mark.django_db
def test_links_de_tarea_se_normalizan_y_validan(api_client):
    r = api_client.post(
        '/api/tareas/',
        {'titulo': 'Reel', 'links': [{'titulo': 'Drive', 'url': 'drive.google.com/x'}, {'titulo': 'vacío', 'url': ' '}]},
        format='json',
    )
    assert r.status_code == 201, r.data
    assert r.data['links'] == [{'titulo': 'Drive', 'url': 'https://drive.google.com/x'}]
    r = api_client.patch(f'/api/tareas/{r.data["id"]}/', {'links': [{'titulo': 'x', 'url': 'javascript:alert(1)'}]}, format='json')
    assert r.status_code == 400
    r = api_client.post('/api/tareas/', {'titulo': 'Muchos', 'links': [{'url': f'https://a.com/{i}'} for i in range(21)]}, format='json')
    assert r.status_code == 400


@pytest.mark.django_db
def test_clientes_mios_filtra_por_asignacion(equipo_client, cm_client, api_client, persona, cliente):
    from apps.clientes.models import Cliente
    from apps.equipo.models import AsignacionCliente, Persona

    otro = Cliente.objects.create(nombre='Otro')
    AsignacionCliente.objects.create(persona=persona, cliente=cliente, rol='Fotografía')
    AsignacionCliente.objects.create(persona=Persona.objects.get(nombre='Caro'), cliente=cliente, rol='CM')
    assert [c['id'] for c in equipo_client.get('/api/clientes/?mios=1').data] == [cliente.id]
    assert [c['id'] for c in cm_client.get('/api/clientes/?mios=1').data] == [cliente.id]
    assert {c['id'] for c in equipo_client.get('/api/clientes/').data} == {cliente.id, otro.id}
    assert api_client.get('/api/clientes/?mios=1').data == []


@pytest.mark.django_db
def test_rol_cm_ve_fichas_de_clientes_y_estadisticas(cm_client, equipo_client, cliente):
    ficha = cm_client.get(f'/api/clientes/{cliente.id}/').data
    assert 'contacto' in ficha and 'notas' in ficha
    assert not {'deuda', 'fee_mensual', 'cuit', 'razon_social'} & set(ficha)
    assert cm_client.get('/api/stats/').status_code == 200
    assert cm_client.get(f'/api/clientes/{cliente.id}/evolucion/').status_code == 200
    for url in (f'/api/clientes/{cliente.id}/rentabilidad/', f'/api/clientes/{cliente.id}/reporte/', '/api/cobros/', '/api/contratos/'):
        assert cm_client.get(url).status_code == 403, url
    assert cm_client.patch(f'/api/clientes/{cliente.id}/', {'nombre': 'X'}, format='json').status_code == 403
    assert equipo_client.get('/api/stats/').status_code == 403
    assert equipo_client.get(f'/api/clientes/{cliente.id}/evolucion/').status_code == 403
    assert cm_client.get('/api/auth/me/').data['permisos'] == ['clientes', 'estadisticas']
    assert equipo_client.get('/api/auth/me/').data['permisos'] == []


@pytest.mark.django_db
def test_eventos_solo_los_edita_quien_los_creo(api_client, equipo_client, cm_client):
    evento = {'titulo': 'Rodaje', 'inicio': '2026-10-01T10:00:00-03:00'}
    propio = equipo_client.post('/api/cal-eventos/', evento, format='json')
    assert propio.status_code == 201 and propio.data['puede_editar']
    del_admin = api_client.post('/api/cal-eventos/', evento, format='json').data
    assert cm_client.patch(f'/api/cal-eventos/{propio.data["id"]}/', {'titulo': 'X'}, format='json').status_code == 403
    assert equipo_client.delete(f'/api/cal-eventos/{del_admin["id"]}/').status_code == 403
    assert equipo_client.patch(f'/api/cal-eventos/{propio.data["id"]}/', {'titulo': 'Rodaje 2'}, format='json').status_code == 200
    assert api_client.delete(f'/api/cal-eventos/{propio.data["id"]}/').status_code == 204


@pytest.mark.django_db
def test_rol_equipo_ve_solo_sus_liquidaciones(equipo_client, persona):
    from apps.equipo.models import Persona

    otra = Persona.objects.create(nombre='Otra')
    Liquidacion.objects.create(persona=persona, periodo='2026-02', concepto='A', total=10)
    Liquidacion.objects.create(persona=otra, periodo='2026-02', concepto='B', total=10)
    data = equipo_client.get('/api/liquidaciones/').data
    assert [l['concepto'] for l in data] == ['A']


@pytest.mark.django_db
def test_usuarios_admin(api_client, user, persona):
    base = {'username': 'nuevo', 'password': 'Clave-Segura-123', 'rol': 'equipo', 'persona': persona.id}
    assert api_client.post('/api/usuarios/', base, format='json').status_code == 400
    assert api_client.post('/api/usuarios/', {**base, 'roles': ['cm', 'jefe']}, format='json').status_code == 400
    r = api_client.post('/api/usuarios/', {**base, 'roles': ['foto', 'disenio']}, format='json')
    assert r.status_code == 201, r.data
    assert r.data['roles'] == ['foto', 'disenio']
    r = api_client.patch(f'/api/usuarios/{r.data["id"]}/', {'rol': 'admin'}, format='json')
    assert r.status_code == 200 and r.data['roles'] == []
    r = api_client.patch(f'/api/usuarios/{user.id}/', {'rol': 'equipo', 'roles': ['cm']}, format='json')
    assert r.status_code == 400


@pytest.mark.django_db
def test_login_logout_rotacion(user):
    c = APIClient()
    r = c.post('/api/auth/login/', {'username': 'testuser', 'password': 'testpass1234'}, format='json')
    assert r.status_code == 200
    refresh = r.data['refresh']
    r2 = c.post('/api/auth/refresh/', {'refresh': refresh}, format='json')
    assert r2.status_code == 200 and 'refresh' in r2.data
    assert c.post('/api/auth/refresh/', {'refresh': refresh}, format='json').status_code == 401
    c.credentials(HTTP_AUTHORIZATION=f'Bearer {r2.data["access"]}')
    assert c.post('/api/auth/logout/', {'refresh': r2.data['refresh']}, format='json').status_code == 204
    assert c.post('/api/auth/refresh/', {'refresh': r2.data['refresh']}, format='json').status_code == 401


@pytest.mark.django_db
def test_login_throttle(user):
    c = APIClient()
    codes = [c.post('/api/auth/login/', {'username': 'x', 'password': 'y'}, format='json').status_code for _ in range(7)]
    assert 429 in codes


@pytest.mark.django_db
def test_vencimientos_calendario(api_client, contrato):
    Servicio.objects.create(nombre='Canva', monto_total=10, dia_vencimiento=5)
    items = api_client.get('/api/calendario/vencimientos/', {'mes': '2026-02'}).data['items']
    tipos = {i['tipo'] for i in items}
    assert {'contrato', 'suscripcion'} <= tipos


@pytest.mark.django_db
def test_eventos_validan_fechas(api_client):
    r = api_client.post(
        '/api/cal-eventos/', {'titulo': 'Reu', 'inicio': '2026-02-02T10:00:00Z', 'fin': '2026-02-02T09:00:00Z'}, format='json'
    )
    assert r.status_code == 400
    assert api_client.get('/api/cal-eventos/', {'desde': 'basura'}).status_code == 400


@pytest.mark.django_db
def test_categoria_con_uso_se_desactiva(api_client, user):
    c = Categoria.objects.create(nombre='Temporal', tipo='egreso')
    Transaccion.objects.create(user=user, fecha='2026-01-01', descripcion='x', categoria=c, tipo='egreso', monto=1)
    r = api_client.delete(f'/api/categorias/{c.id}/')
    assert r.status_code == 200 and r.data['desactivada'] is True


@pytest.mark.django_db
def test_reporte_y_evolucion_cliente(api_client, cliente):
    from apps.stats.models import AnalisisStats

    AnalisisStats.objects.create(cliente=cliente, plataforma='instagram', periodo_hasta='2026-01-31', metricas=[{'nombre': 'Seguidores', 'despues': '1.200'}])
    AnalisisStats.objects.create(cliente=cliente, plataforma='instagram', periodo_hasta='2026-02-28', metricas=[{'nombre': 'Seguidores', 'despues': '1,5K'}])
    ev = api_client.get(f'/api/clientes/{cliente.id}/evolucion/', {'plataforma': 'instagram'}).data
    assert [p['valor'] for p in ev['series']['Seguidores']] == [1200.0, 1500.0]
    rep = api_client.get(f'/api/clientes/{cliente.id}/reporte/', {'mes': '2026-02'})
    assert rep.status_code == 200
    assert len(rep.data['analisis']) == 1
