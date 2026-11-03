from datetime import date, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone

from apps.clientes.models import Cliente, Cobro, Contrato
from apps.equipo.models import Liquidacion, Persona
from apps.equipo.services import avisos_de_liquidaciones
from apps.finanzas.models import Categoria, Transaccion
from apps.finanzas.proyeccion import proyectar
from apps.notificaciones import email as correo
from apps.notificaciones.models import Notificacion
from apps.servicios.models import AvisoServicio, Servicio
from apps.servicios.services import etapa_de_hoy, generar_tareas_de_servicios, recordatorios_de_servicios, suscripciones_de


@pytest.fixture
def emails(monkeypatch):
    enviados = []
    monkeypatch.setattr(correo, 'enviar', lambda para, asunto, html, bcc=None: enviados.append((para, asunto)) or True)
    return enviados


@pytest.fixture
def servicios(db, persona, equipo_user):
    """Lau paga Canva y Google One; Caro aporta a Google One. Figma lo paga la agencia."""
    equipo_user.email = 'lau@x.com'
    equipo_user.save()
    caro = Persona.objects.create(nombre='Caro')
    canva = Servicio.objects.create(nombre='Canva', monto_total=Decimal('5000'), dia_vencimiento=10, pagador=persona)
    google = Servicio.objects.create(
        nombre='Google One', monto_total=Decimal('9000'), dia_vencimiento=10, pagador=persona, metodo='personalizado',
        detalle=[{'nombre': 'Caro', 'monto': '3000', 'persona': caro.id}],
    )
    figma = Servicio.objects.create(nombre='Figma', monto_total=Decimal('12000'), dia_vencimiento=12)
    return {'canva': canva, 'google': google, 'figma': figma, 'caro': caro}


def test_etapas_del_recordatorio():
    v = date(2026, 11, 10)
    assert etapa_de_hoy(v, 3, date(2026, 11, 6)) is None
    assert etapa_de_hoy(v, 3, date(2026, 11, 7)) == 'antes'
    assert etapa_de_hoy(v, 3, date(2026, 11, 8)) == 'antes'  # margen si el cron no corrió
    assert etapa_de_hoy(v, 3, date(2026, 11, 9)) is None
    assert etapa_de_hoy(v, 3, date(2026, 11, 10)) == 'dia'
    assert etapa_de_hoy(v, 3, date(2026, 11, 12)) == '+2'
    assert etapa_de_hoy(v, 3, date(2026, 11, 14)) is None
    assert etapa_de_hoy(v, 0, date(2026, 11, 9)) is None


@pytest.mark.django_db
def test_un_mail_por_persona_y_dia_con_todas_sus_suscripciones(servicios, user, equipo_user, emails):
    user.email = 'admin@x.com'
    user.save()
    hoy = date(2026, 11, 7)
    generar_tareas_de_servicios(hoy)
    assert emails == []  # crear las tareas avisa solo por la campana

    assert recordatorios_de_servicios(hoy) == 1
    assert emails == [('lau@x.com', '2 pagos de suscripciones pendientes · AuraTeam')]
    assert recordatorios_de_servicios(hoy) == 0 and len(emails) == 1  # una vez por etapa

    # El día del vencimiento: de nuevo, sin lo que ya se pagó.
    canva = AvisoServicio.objects.get(servicio=servicios['canva'], tipo='pago').tarea
    canva.estado = 'hecha'
    canva.save()
    recordatorios_de_servicios(date(2026, 11, 10))
    assert ('lau@x.com', 'Pagar Google One · AuraTeam') in emails
    # Figma (de la agencia) va a los admins el día del vencimiento.
    recordatorios_de_servicios(date(2026, 11, 12))
    assert ('admin@x.com', 'Pagar Figma · AuraTeam') in emails


@pytest.mark.django_db
def test_sin_mail_si_la_persona_los_apago(servicios, equipo_user, emails):
    equipo_user.notif_email = False
    equipo_user.save()
    hoy = date(2026, 11, 7)
    generar_tareas_de_servicios(hoy)
    assert recordatorios_de_servicios(hoy) == 0 and emails == []
    assert Notificacion.objects.filter(usuario=equipo_user, clave__startswith='rec-servicio:').count() == 2


@pytest.mark.django_db
def test_mis_suscripciones_en_mi_panel(servicios, persona, equipo_client):
    hoy = date(2026, 11, 7)
    generar_tareas_de_servicios(hoy)
    mias = suscripciones_de(persona, hoy)
    assert [(s['nombre'], s['rol'], s['monto'], s['al_dia']) for s in mias] == [
        ('Canva', 'pagas', '5000.00', False), ('Google One', 'pagas', '9000.00', False),
    ]
    caro = suscripciones_de(servicios['caro'], hoy)
    assert [(s['nombre'], s['rol'], s['monto'], s['pagador']) for s in caro] == [('Google One', 'aportas', '3000.00', 'Lau')]

    tarea = AvisoServicio.objects.get(servicio=servicios['canva'], tipo='pago').tarea
    tarea.estado = 'hecha'
    tarea.save()
    canva = next(s for s in suscripciones_de(persona, hoy) if s['nombre'] == 'Canva')
    assert canva['al_dia'] and canva['vencimiento'] == '2026-12-10'
    assert 'suscripciones' in equipo_client.get('/api/mi-panel/').data


@pytest.mark.django_db
def test_pagar_una_liquidacion_manda_el_detalle_a_la_persona(api_client, persona, equipo_user, emails, django_capture_on_commit_callbacks):
    equipo_user.email = 'lau@x.com'
    equipo_user.save()
    cliente = Cliente.objects.create(nombre='Lennon')
    liq = Liquidacion.objects.create(persona=persona, periodo='2026-10', concepto='Historias', cliente=cliente, monto_base=Decimal('50000'))
    with django_capture_on_commit_callbacks(execute=True):
        r = api_client.post(f'/api/liquidaciones/{liq.id}/pagar/', {'medio_pago': 'transferencia', 'comprobante': 'TR-1'}, format='json')
    assert r.status_code == 200, r.data
    assert emails == [('lau@x.com', 'Te pagamos $ 50.000 · AuraTeam')]
    aviso = Notificacion.objects.get(usuario=equipo_user, tipo='pago_equipo')
    assert aviso.url == f'/pagos-equipo/{liq.id}/recibo' and aviso.email_enviado


@pytest.mark.django_db
def test_liquidaciones_atrasadas_avisan_a_los_admins_una_vez(user, persona):
    liq = Liquidacion.objects.create(persona=persona, periodo='2026-10', concepto='Historias', monto_base=Decimal('1'), total=Decimal('1'))
    hoy = timezone.localdate()
    assert avisos_de_liquidaciones(hoy) == 0
    Liquidacion.objects.filter(pk=liq.pk).update(creado=timezone.now() - timedelta(days=8))
    assert avisos_de_liquidaciones(hoy) == 1
    assert avisos_de_liquidaciones(hoy) == 0


@pytest.mark.django_db
def test_flujo_de_caja_proyectado(api_client, equipo_client, servicios, persona):
    hoy = date(2026, 11, 7)
    cliente = Cliente.objects.create(nombre='Lennon')
    contrato = Contrato.objects.create(cliente=cliente, concepto='Fee', monto=Decimal('100000'), fecha_inicio=date(2026, 1, 1), dia_vencimiento=10)
    # Noviembre ya generado y cobrado a medias; octubre quedó con saldo.
    Cobro.objects.create(cliente=cliente, contrato=contrato, periodo='2026-11', concepto='Fee', monto=Decimal('100000'), monto_cobrado=Decimal('40000'),
                         estado='parcial', vencimiento=date(2026, 11, 10))
    Cobro.objects.create(cliente=cliente, periodo='2026-10', concepto='Fee', monto=Decimal('100000'), vencimiento=date(2026, 10, 10))
    # Promedios: pagos al equipo y otros gastos de los 3 meses anteriores.
    gasto, _ = Categoria.objects.get_or_create(nombre='Alquiler oficina', tipo='egreso')
    for mes in ('2026-08', '2026-09', '2026-10'):
        Liquidacion.objects.create(persona=persona, periodo=mes, concepto='X', monto_base=Decimal('30000'), total=Decimal('30000'), estado='pagada')
        Transaccion.objects.create(fecha=date(int(mes[:4]), int(mes[5:]), 5), descripcion='Alquiler', categoria=gasto, tipo='egreso',
                                   monto=Decimal('6000'))

    d = proyectar(hoy, 2)
    nov, dic = d['meses']
    assert nov['periodo'] == '2026-11' and dic['periodo'] == '2026-12'
    assert nov['ingresos']['cobrado'] == '40000.00' and nov['ingresos']['a_cobrar'] == '60000.00'
    assert nov['ingresos']['atrasado'] == '100000.00' and nov['ingresos']['sin_generar'] == '0.00'
    assert dic['ingresos']['sin_generar'] == '100000.00'
    # Suscripciones: Canva 5000 + Google One 9000 + Figma 12000, todas sin pagar.
    assert nov['egresos']['suscripciones_pendientes'] == '26000.00'
    assert nov['egresos']['equipo_estimado'] == '30000.00' and nov['egresos']['otros_estimado'] == '6000.00'
    assert Decimal(dic['acumulado']) == Decimal(nov['neto']) + Decimal(dic['neto'])

    assert api_client.get('/api/finanzas/proyeccion/?meses=2').status_code == 200
    assert equipo_client.get('/api/finanzas/proyeccion/').status_code == 403
