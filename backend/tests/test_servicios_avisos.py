from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.test import override_settings

from apps.core import cron
from apps.equipo.models import Persona, Tarea
from apps.finanzas.models import Transaccion
from apps.notificaciones import email as correo
from apps.notificaciones.models import EstadoCron, Notificacion
from apps.servicios.models import AvisoServicio, PagoServicio, Servicio
from apps.servicios.services import avisos_de_servicios, generar_tareas_de_servicios, vencimientos_proximos

ART = ZoneInfo('America/Argentina/Buenos_Aires')


@pytest.fixture
def emails(monkeypatch):
    enviados = []
    monkeypatch.setattr(correo, 'enviar', lambda para, asunto, html, bcc=None: enviados.append((para, asunto)) or True)
    return enviados


@pytest.fixture
def google_one(db, persona):
    caro = Persona.objects.create(nombre='Caro')
    return Servicio.objects.create(
        nombre='Google One', monto_total=Decimal('9000'), mi_parte=Decimal('3000'), dia_vencimiento=10, pagador=persona,
        metodo='personalizado',
        detalle=[{'nombre': 'Lau', 'monto': '3000', 'persona': persona.id}, {'nombre': 'Caro', 'monto': '3000', 'persona': caro.id},
                 {'nombre': 'Agencia', 'monto': '3000'}],
    )


@pytest.mark.django_db
def test_genera_tarea_de_pago_y_aportes_desde_dias_de_aviso(google_one, persona, equipo_user, emails):
    assert generar_tareas_de_servicios(date(2026, 10, 6)) == 0
    assert generar_tareas_de_servicios(date(2026, 10, 7)) == 2
    assert generar_tareas_de_servicios(date(2026, 10, 8)) == 0

    pago = AvisoServicio.objects.get(tipo='pago')
    assert pago.persona == persona and pago.periodo == '2026-10' and pago.tarea.titulo == 'Pagar Google One'
    assert pago.tarea.fecha_limite == date(2026, 10, 10) and pago.tarea.etiqueta == 'pagos'
    aporte = AvisoServicio.objects.get(tipo='aporte')
    assert aporte.persona.nombre == 'Caro' and aporte.tarea.titulo == 'Transferir $ 3.000 a Lau · Google One'
    assert Notificacion.objects.filter(usuario=equipo_user, tipo='servicio').count() == 1


@pytest.mark.django_db
def test_completar_la_tarea_de_pago_registra_el_egreso(google_one, equipo_client, user, emails):
    generar_tareas_de_servicios(date(2026, 10, 7))
    tarea = AvisoServicio.objects.get(tipo='pago').tarea
    r = equipo_client.patch(f'/api/tareas/{tarea.id}/', {'estado': 'hecha'}, format='json')
    assert r.status_code == 200, r.data
    pago = PagoServicio.objects.get(servicio=google_one, periodo='2026-10')
    assert pago.transaccion.monto == Decimal('3000') and pago.transaccion.tipo == 'egreso'
    assert Notificacion.objects.filter(usuario=user, titulo='Lau pagó Google One').exists()
    assert not vencimientos_proximos(date(2026, 10, 8), 3)

    equipo_client.patch(f'/api/tareas/{tarea.id}/', {'estado': 'pendiente'}, format='json')
    equipo_client.patch(f'/api/tareas/{tarea.id}/', {'estado': 'hecha'}, format='json')
    assert Transaccion.objects.count() == 1


@pytest.mark.django_db
def test_registrar_pago_desde_la_api_cierra_la_tarea(google_one, api_client, emails):
    generar_tareas_de_servicios(date(2026, 10, 7))
    r = api_client.post(f'/api/servicios/{google_one.id}/registrar-pago/', {'mes': '2026-10'}, format='json')
    assert r.status_code == 200 and r.data == {'creado': True}
    assert AvisoServicio.objects.get(tipo='pago').tarea.estado == 'hecha'
    assert AvisoServicio.objects.get(tipo='aporte').tarea.estado == 'pendiente'
    assert api_client.post(f'/api/servicios/{google_one.id}/registrar-pago/', {'mes': '2026-10'}, format='json').data == {'creado': False}


@pytest.mark.django_db
def test_tareas_de_servicios_solo_las_ve_su_responsable_y_no_van_a_notion(google_one, equipo_client, api_client, emails, monkeypatch):
    from apps.integraciones import notion

    generar_tareas_de_servicios(date(2026, 10, 7))
    titulos = [t['titulo'] for t in equipo_client.get('/api/tareas/').data]
    assert titulos == ['Pagar Google One']
    assert len(api_client.get('/api/tareas/').data) == 2
    assert notion._es_de_servicio(Tarea.objects.get(titulo='Pagar Google One'))


@pytest.mark.django_db
def test_avisos_de_atrasos_a_los_admins(google_one, user, emails):
    generar_tareas_de_servicios(date(2026, 10, 7))
    avisos_de_servicios(date(2026, 10, 10))
    avisos_de_servicios(date(2026, 10, 10))
    assert list(Notificacion.objects.filter(usuario=user).values_list('titulo', flat=True)) == ['Google One vence hoy y no está pago']
    avisos_de_servicios(date(2026, 10, 11))
    titulos = set(Notificacion.objects.filter(usuario=user).values_list('titulo', flat=True))
    assert 'Google One venció sin pagar' in titulos and 'Caro no confirmó su aporte de Google One' in titulos


@pytest.mark.django_db
def test_servicio_de_la_agencia_avisa_a_los_admins_antes_de_vencer(user, emails):
    Servicio.objects.create(nombre='Canva', monto_total=Decimal('10000'), dia_vencimiento=12)
    avisos_de_servicios(date(2026, 10, 9))
    assert Notificacion.objects.filter(usuario=user, titulo='Vence Canva el 12/10').count() == 1
    assert not AvisoServicio.objects.exists()


@pytest.mark.django_db
def test_serializer_valida_la_persona_del_reparto(api_client, persona):
    datos = {'nombre': 'X', 'monto_total': '100', 'metodo': 'personalizado', 'pagador': persona.id,
             'detalle': [{'nombre': 'Lau', 'monto': '100', 'persona': 999}]}
    assert api_client.post('/api/servicios/', datos, format='json').status_code == 400
    datos['detalle'][0]['persona'] = persona.id
    r = api_client.post('/api/servicios/', datos, format='json')
    assert r.status_code == 201, r.data
    assert r.data['pagador_nombre'] == 'Lau' and r.data['detalle'][0]['persona'] == persona.id


# Cron


@pytest.mark.django_db
def test_cron_requiere_token(client, settings):
    settings.CRON_TOKEN = ''
    assert client.post('/api/cron/').status_code == 503
    settings.CRON_TOKEN = 'secreto'
    assert client.post('/api/cron/', HTTP_X_CRON_TOKEN='otro').status_code == 403
    r = client.post('/api/cron/', HTTP_X_CRON_TOKEN='secreto')
    assert r.status_code == 200
    assert EstadoCron.get().ultima_corrida is not None


@pytest.mark.django_db
def test_cron_avisa_deadlines_agrupados_y_el_resumen_sale_una_vez(user, equipo_user, persona, emails):
    from apps.equipo.models import AsignacionTarea

    user.email, equipo_user.email = 'admin@x.com', 'lau@x.com'
    user.save()
    equipo_user.save()
    for titulo in ['Reel', 'Carrusel']:
        t = Tarea.objects.create(titulo=titulo, fecha_limite=date(2026, 10, 7))
        AsignacionTarea.objects.create(persona=persona, tarea=t)

    cron.ejecutar(datetime(2026, 10, 7, 6, tzinfo=ART))
    assert not Notificacion.objects.filter(usuario=equipo_user).exists() and emails == []

    cron.ejecutar(datetime(2026, 10, 7, 8, 5, tzinfo=ART))
    cron.ejecutar(datetime(2026, 10, 7, 9, 5, tzinfo=ART))
    avisos = list(Notificacion.objects.filter(usuario=equipo_user).values_list('tipo', flat=True))
    assert avisos == ['deadline_hoy']
    destinatarios = sorted(para for para, _ in emails)
    assert destinatarios == ['admin@x.com', 'lau@x.com']


@pytest.mark.django_db
@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
def test_respaldo_genera_tareas_si_el_cron_no_corrio(google_one, equipo_client, emails, monkeypatch):
    from django.core.cache import cache
    from django.utils import timezone

    cache.clear()
    monkeypatch.setattr(timezone, 'now', lambda: datetime(2026, 10, 7, 10, tzinfo=ART))
    equipo_client.get('/api/tareas/')
    assert AvisoServicio.objects.count() == 2
