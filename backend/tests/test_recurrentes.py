from datetime import timedelta

import pytest

from apps.clientes.models import Cliente
from apps.equipo import services
from apps.equipo.models import Tarea, TareaRecurrente

LUN_A_SAB = [0, 1, 2, 3, 4, 5]


def _plantilla(api_client, persona, **extra):
    cliente = Cliente.objects.create(nombre='Cycles')
    body = {'titulo': 'Cycles · Historia', 'cliente': cliente.id, 'personas': [persona.id], 'dias': LUN_A_SAB, 'por_dia': 3, **extra}
    r = api_client.post('/api/tareas-recurrentes/', body, format='json')
    assert r.status_code == 201, r.data
    return TareaRecurrente.objects.get(pk=r.data['id'])


def _dias_esperados(hoy):
    return [hoy + timedelta(days=i) for i in range(services.DIAS_RECURRENTES + 1) if (hoy + timedelta(days=i)).weekday() in LUN_A_SAB]


@pytest.mark.django_db
def test_la_plantilla_genera_tres_tareas_por_dia_de_lunes_a_sabado(api_client, persona):
    p = _plantilla(api_client, persona)
    dias = _dias_esperados(services.today())
    tareas = Tarea.objects.filter(recurrente=p).order_by('fecha_limite', 'titulo')
    assert tareas.count() == 3 * len(dias)
    assert sorted({t.fecha_limite for t in tareas}) == dias
    assert [t.titulo for t in tareas[:3]] == ['Cycles · Historia 1/3', 'Cycles · Historia 2/3', 'Cycles · Historia 3/3']
    assert all(t.etiqueta == 'historias' and [a.persona_id for a in t.asignaciones.all()] == [persona.id] for t in tareas)

    assert services.generar_recurrentes() == 0
    api_client.get('/api/tareas/')
    assert Tarea.objects.filter(recurrente=p).count() == 3 * len(dias)


@pytest.mark.django_db
def test_al_pasar_los_dias_genera_solo_lo_que_falta(api_client, persona, monkeypatch):
    p = _plantilla(api_client, persona)
    hoy = services.today()
    antes = Tarea.objects.count()
    monkeypatch.setattr(services, 'today', lambda: hoy + timedelta(days=1))
    creadas = services.generar_recurrentes()
    nuevo = hoy + timedelta(days=services.DIAS_RECURRENTES + 1)
    assert creadas == (3 if nuevo.weekday() in LUN_A_SAB else 0)
    assert Tarea.objects.count() == antes + creadas
    p.refresh_from_db()
    assert p.generada_hasta == nuevo


@pytest.mark.django_db
def test_plantilla_inactiva_no_genera_y_validaciones(api_client, persona):
    r = api_client.post('/api/tareas-recurrentes/', {'titulo': 'X', 'dias': [], 'activa': False}, format='json')
    assert r.status_code == 400 and 'dias' in r.data
    r = api_client.post('/api/tareas-recurrentes/', {'titulo': 'X', 'dias': [7]}, format='json')
    assert r.status_code == 400
    _plantilla(api_client, persona, activa=False)
    assert not Tarea.objects.exists()


@pytest.mark.django_db
def test_solo_admin_gestiona_plantillas(equipo_client):
    assert equipo_client.get('/api/tareas-recurrentes/').status_code == 403

