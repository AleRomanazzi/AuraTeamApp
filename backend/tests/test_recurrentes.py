from datetime import date, timedelta

import pytest

from apps.clientes.models import Cliente
from apps.equipo import services
from apps.equipo.models import Tarea, TareaRecurrente

LUN_A_SAB = [0, 1, 2, 3, 4, 5]
MIE_30_SEP = date(2026, 9, 30)


@pytest.fixture
def hoy(monkeypatch):
    actual = {'dia': MIE_30_SEP}
    monkeypatch.setattr(services, 'today', lambda: actual['dia'])
    return actual


def _plantilla(api_client, persona, **extra):
    cliente = Cliente.objects.create(nombre='Cycles')
    body = {'titulo': 'Cycles · Historia', 'cliente': cliente.id, 'personas': [persona.id], 'dias': LUN_A_SAB, 'por_dia': 3, **extra}
    r = api_client.post('/api/tareas-recurrentes/', body, format='json')
    assert r.status_code == 201, r.data
    return TareaRecurrente.objects.get(pk=r.data['id'])


def _lun_a_sab(desde, hasta):
    return [desde + timedelta(days=i) for i in range((hasta - desde).days + 1) if (desde + timedelta(days=i)).weekday() in LUN_A_SAB]


def test_fin_de_generacion_cubre_el_mes_de_la_semana_proxima():
    assert services.fin_de_generacion(MIE_30_SEP) == date(2026, 10, 31)
    assert services.fin_de_generacion(date(2026, 10, 20)) == date(2026, 10, 31)
    assert services.fin_de_generacion(date(2026, 10, 25)) == date(2026, 11, 30)


@pytest.mark.django_db
def test_la_plantilla_genera_tres_tareas_por_dia_de_lunes_a_sabado_hasta_fin_de_mes(api_client, persona, hoy):
    p = _plantilla(api_client, persona)
    dias = _lun_a_sab(MIE_30_SEP, date(2026, 10, 31))
    tareas = Tarea.objects.filter(recurrente=p).order_by('fecha_limite', 'titulo')
    assert tareas.count() == 3 * len(dias)
    assert sorted({t.fecha_limite for t in tareas}) == dias
    assert [t.titulo for t in tareas[:3]] == ['Cycles · Historia 1/3', 'Cycles · Historia 2/3', 'Cycles · Historia 3/3']
    assert all(t.etiqueta == 'historias' and [a.persona_id for a in t.asignaciones.all()] == [persona.id] for t in tareas)

    assert services.generar_recurrentes() == 0
    api_client.get('/api/tareas/')
    assert Tarea.objects.filter(recurrente=p).count() == 3 * len(dias)


@pytest.mark.django_db
def test_la_ultima_semana_del_mes_genera_el_mes_siguiente(api_client, persona, hoy):
    p = _plantilla(api_client, persona)
    antes = Tarea.objects.count()
    hoy['dia'] = date(2026, 10, 25)
    creadas = services.generar_recurrentes()
    assert creadas == 3 * len(_lun_a_sab(date(2026, 11, 1), date(2026, 11, 30)))
    assert Tarea.objects.count() == antes + creadas
    p.refresh_from_db()
    assert p.generada_hasta == date(2026, 11, 30)


@pytest.mark.django_db
def test_plantilla_inactiva_no_genera_y_validaciones(api_client, persona, hoy):
    r = api_client.post('/api/tareas-recurrentes/', {'titulo': 'X', 'dias': [], 'activa': False}, format='json')
    assert r.status_code == 400 and 'dias' in r.data
    r = api_client.post('/api/tareas-recurrentes/', {'titulo': 'X', 'dias': [7]}, format='json')
    assert r.status_code == 400
    _plantilla(api_client, persona, activa=False)
    assert not Tarea.objects.exists()


@pytest.mark.django_db
def test_solo_admin_gestiona_plantillas(equipo_client):
    assert equipo_client.get('/api/tareas-recurrentes/').status_code == 403
