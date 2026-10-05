from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from apps.clientes import envios
from apps.clientes.models import Cliente, Cobro, ConfigEnvios, Contrato, EnvioCliente
from apps.equipo.models import Tarea
from apps.notificaciones import email as correo
from apps.notificaciones.models import Notificacion
from apps.servicios.models import AvisoServicio, Servicio

ART = ZoneInfo('America/Argentina/Buenos_Aires')


@pytest.fixture
def emails(monkeypatch):
    enviados = []

    def enviar(para, asunto, html, bcc=None):
        enviados.append({'para': para, 'asunto': asunto, 'html': html, 'bcc': bcc})
        return True

    monkeypatch.setattr(correo, 'enviar', enviar)
    return enviados


@pytest.fixture
def cliente(db):
    return Cliente.objects.create(nombre='Café Roma', email='hola@caferoma.com', contacto='Juli', recordatorios_cobro=True)


def _cobro(cliente, vencimiento, monto='150000'):
    contrato = Contrato.objects.create(cliente=cliente, concepto='Fee mensual', monto=Decimal(monto), fecha_inicio=date(2026, 1, 1))
    return Cobro.objects.create(cliente=cliente, contrato=contrato, periodo=vencimiento.strftime('%Y-%m'), concepto='Fee mensual', monto=Decimal(monto), vencimiento=vencimiento)


def _hecha(cliente, titulo, etiqueta, dia):
    t = Tarea.objects.create(titulo=titulo, cliente=cliente, etiqueta=etiqueta, estado='hecha')
    Tarea.objects.filter(pk=t.pk).update(completada_en=datetime.combine(dia, datetime.min.time(), ART) + timedelta(hours=12))
    return t


@pytest.mark.django_db
def test_reporte_sin_datos_internos(cliente):
    _hecha(cliente, 'Reel lanzamiento', 'posteos', date(2026, 9, 10))
    _hecha(cliente, 'Historia promo', 'historias', date(2026, 9, 12))
    _hecha(cliente, 'Plan de socios', 'ceos', date(2026, 9, 12))
    servicio = Servicio.objects.create(nombre='Canva', monto_total=Decimal('9000'))
    pago = _hecha(cliente, 'Pagar Canva', 'posteos', date(2026, 9, 12))
    AvisoServicio.objects.create(servicio=servicio, periodo='2026-09', persona=_persona(), tipo='pago', vencimiento=date(2026, 9, 12), tarea=pago)
    _cobro(cliente, date(2026, 9, 10))

    envio = envios.preparar_reporte(cliente, '2026-09')
    assert envio.estado == 'borrador' and envio.asunto == 'Reporte de septiembre 2026 · Café Roma · AuraTeam'
    assert 'Reel lanzamiento' in envio.html and 'Historia promo' in envio.html
    for prohibido in ('Plan de socios', 'Pagar Canva', '150', 'Fee mensual', '$'):
        assert prohibido not in envio.html


def _persona():
    from apps.equipo.models import Persona

    return Persona.objects.create(nombre='Lau')


@pytest.mark.django_db
def test_cron_deja_borradores_el_dia_1_y_avisa(cliente, user, emails):
    Cliente.objects.create(nombre='Sin email')
    auto = Cliente.objects.create(nombre='Lumen', email='a@lumen.com', reporte_auto=True)
    envios.programados(datetime(2026, 10, 1, 8, tzinfo=ART))
    assert not EnvioCliente.objects.exists()

    envios.programados(datetime(2026, 10, 1, 9, 5, tzinfo=ART))
    envios.programados(datetime(2026, 10, 1, 10, 5, tzinfo=ART))
    reportes = EnvioCliente.objects.filter(tipo='reporte', periodo='2026-09')
    assert reportes.get(cliente=cliente).estado == 'borrador'
    assert reportes.get(cliente=auto).estado == 'enviado'
    assert reportes.count() == 2
    assert [e['para'] for e in emails] == [['a@lumen.com']]
    assert Notificacion.objects.filter(usuario=user, titulo='1 reporte de septiembre 2026 para revisar').count() == 1


@pytest.mark.django_db
def test_revisar_y_enviar_un_borrador(api_client, cliente, emails):
    r = api_client.post(f'/api/clientes/{cliente.id}/reporte-email/', {'mes': '2026-09'}, format='json')
    assert r.status_code == 200 and 'html' in r.data
    envio_id = r.data['id']
    assert api_client.get(f'/api/envios/{envio_id}/').data['html'].startswith('<div')
    assert [e['id'] for e in api_client.get('/api/envios/', {'estado': 'borrador'}).data] == [envio_id]
    r = api_client.post(f'/api/envios/{envio_id}/enviar/')
    assert r.status_code == 200 and r.data['estado'] == 'enviado'
    assert emails[0]['para'] == ['hola@caferoma.com']
    assert api_client.post(f'/api/envios/{envio_id}/enviar/').status_code == 400


@pytest.mark.django_db
def test_calendario_de_recordatorios_y_corte_al_pagar(cliente, emails):
    vence = date(2026, 10, 10)
    cobro = _cobro(cliente, vence)
    enviados = {}
    for dia in range(1, 25):
        hoy = date(2026, 10, dia)
        antes = len(emails)
        envios.recordatorios_de_cobro(hoy)
        envios.recordatorios_de_cobro(hoy)
        if len(emails) > antes:
            enviados[dia] = emails[-1]['asunto']
    assert list(enviados) == [7, 10, 13, 17]
    assert enviados[7].startswith('Recordatorio de pago') and enviados[10].startswith('Hoy vence') and enviados[17].startswith('Pago pendiente')
    assert '$ 150.000' in emails[0]['html']

    otro = _cobro(Cliente.objects.create(nombre='Lumen', email='a@lumen.com', recordatorios_cobro=True), vence)
    Cobro.objects.filter(pk=otro.pk).update(estado='pagado')
    assert envios.recordatorios_de_cobro(date(2026, 10, 10)) == 0
    assert set(cobro.envios.values_list('clave', flat=True)) == {'antes', 'dia', '+3', '+7'}


@pytest.mark.django_db
def test_recordatorios_respetan_la_configuracion_y_el_cliente(cliente, emails):
    ConfigEnvios.objects.update_or_create(pk=1, defaults={'dias_antes': 0, 'dias_despues': '5'})
    _cobro(cliente, date(2026, 10, 10))
    apagado = Cliente.objects.create(nombre='Off', email='off@x.com')
    _cobro(apagado, date(2026, 10, 10))
    dias = [d for d in range(1, 25) if envios.recordatorios_de_cobro(date(2026, 10, d))]
    assert dias == [10, 15]
    assert all(e['para'] == ['hola@caferoma.com'] for e in emails)


@pytest.mark.django_db
def test_enviar_recordatorio_ahora(api_client, cliente, emails):
    cobro = _cobro(cliente, date(2026, 10, 10))
    r = api_client.post(f'/api/cobros/{cobro.id}/recordar/')
    assert r.status_code == 200, r.data
    api_client.post(f'/api/cobros/{cobro.id}/recordar/')
    assert len(emails) == 2
    fila = api_client.get('/api/cobros/', {'cliente': cliente.id}).data
    fila = fila[0] if isinstance(fila, list) else fila['results'][0]
    assert fila['ultimo_recordatorio'] is not None

    sin_email = _cobro(Cliente.objects.create(nombre='Sin email'), date(2026, 10, 10))
    assert api_client.post(f'/api/cobros/{sin_email.id}/recordar/').status_code == 400


@pytest.mark.django_db
def test_config_de_envios(api_client):
    r = api_client.put('/api/envios/config/', {'dia_reporte': 2, 'dias_antes': 5, 'dias_despues': '7, 3,3'}, format='json')
    assert r.status_code == 200 and r.data['dias_despues'] == '3,7'
    assert api_client.put('/api/envios/config/', {'dia_reporte': 2, 'dias_antes': 5, 'dias_despues': 'x'}, format='json').status_code == 400
