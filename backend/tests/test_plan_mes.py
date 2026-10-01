import pytest

from apps.clientes.models import Cliente
from apps.equipo.models import AsignacionCliente, Persona, Tarea

URL = '/api/tareas/plan/'


def _body(cliente, persona, n=3):
    return {
        'cliente': cliente.id,
        'tareas': [
            {'titulo': f'Posteo {i}', 'fecha_limite': f'2026-11-0{i}', 'etiqueta': 'posteos', 'asignados': [persona.id]}
            for i in range(1, n + 1)
        ],
    }


@pytest.mark.django_db
def test_el_admin_crea_el_plan_del_mes(api_client, persona):
    cliente = Cliente.objects.create(nombre='Lennon')
    r = api_client.post(URL, _body(cliente, persona), format='json')
    assert r.status_code == 201, r.data
    assert r.data == {'creadas': 3}
    tareas = Tarea.objects.filter(cliente=cliente).order_by('fecha_limite')
    assert [t.titulo for t in tareas] == ['Posteo 1', 'Posteo 2', 'Posteo 3']
    assert all(t.etiqueta == 'posteos' and t.estado == 'pendiente' and t.recurrente_id is None for t in tareas)
    assert all(list(t.asignaciones.values_list('persona_id', flat=True)) == [persona.id] for t in tareas)


@pytest.mark.django_db
def test_el_cm_arma_el_plan_solo_de_sus_clientes(cm_client):
    caro = Persona.objects.get(nombre='Caro')
    suyo, ajeno = Cliente.objects.create(nombre='Lennon'), Cliente.objects.create(nombre='Cycles')
    AsignacionCliente.objects.create(persona=caro, cliente=suyo)
    assert cm_client.post(URL, _body(suyo, caro, 2), format='json').status_code == 201
    assert cm_client.post(URL, _body(ajeno, caro, 2), format='json').status_code == 403
    assert Tarea.objects.filter(cliente=ajeno).count() == 0


@pytest.mark.django_db
def test_el_resto_del_equipo_no_arma_planes(equipo_client, persona):
    cliente = Cliente.objects.create(nombre='Lennon')
    AsignacionCliente.objects.create(persona=persona, cliente=cliente)
    assert equipo_client.post(URL, _body(cliente, persona), format='json').status_code == 403


@pytest.mark.django_db
def test_el_plan_valida_todas_las_filas_o_no_crea_ninguna(api_client, persona):
    cliente = Cliente.objects.create(nombre='Lennon')
    body = _body(cliente, persona)
    body['tareas'][1]['titulo'] = '  '
    body['tareas'][2].pop('fecha_limite')
    r = api_client.post(URL, body, format='json')
    assert r.status_code == 400
    assert Tarea.objects.count() == 0
    assert api_client.post(URL, {'cliente': cliente.id, 'tareas': []}, format='json').status_code == 400
