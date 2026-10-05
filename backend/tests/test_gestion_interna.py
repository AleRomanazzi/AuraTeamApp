from datetime import date
from decimal import Decimal

import pytest

from apps.clientes.models import Cliente
from apps.equipo.models import AsignacionTarea, Persona, Tarea
from apps.servicios.models import AvisoServicio, Servicio


@pytest.mark.django_db
def test_cualquiera_del_equipo_edita_y_se_suma_a_una_tarea_interna(user, equipo_client, persona):
    otra = Persona.objects.create(nombre='Mica')
    interna = Tarea.objects.create(titulo='Reunión de equipo', user=user)
    AsignacionTarea.objects.create(persona=otra, tarea=interna)

    r = equipo_client.get('/api/tareas/')
    assert next(t for t in r.data if t['id'] == interna.id)['puede_editar'] is True
    r = equipo_client.patch(f'/api/tareas/{interna.id}/', {'estado': 'en_curso', 'asignados': [otra.id, persona.id]}, format='json')
    assert r.status_code == 200, r.data
    assert set(interna.asignaciones.values_list('persona_id', flat=True)) == {otra.id, persona.id}
    assert equipo_client.delete(f'/api/tareas/{interna.id}/').status_code == 403


@pytest.mark.django_db
def test_las_tareas_de_clientes_siguen_siendo_de_quien_las_tiene(user, equipo_client):
    ajena = Tarea.objects.create(titulo='Reel', cliente=Cliente.objects.create(nombre='Lennon'), user=user)
    assert equipo_client.patch(f'/api/tareas/{ajena.id}/', {'estado': 'hecha'}, format='json').status_code == 403


@pytest.mark.django_db
def test_las_tareas_de_pago_sin_cliente_no_son_internas(user, equipo_client, persona):
    otra = Persona.objects.create(nombre='Mica')
    tarea = Tarea.objects.create(titulo='Pagar Google', user=user)
    servicio = Servicio.objects.create(nombre='Google', monto_total=Decimal('100'), pagador=otra)
    AvisoServicio.objects.create(servicio=servicio, periodo='2026-10', persona=otra, tipo='pago', vencimiento=date(2026, 10, 7), tarea=tarea)
    assert equipo_client.patch(f'/api/tareas/{tarea.id}/', {'estado': 'hecha'}, format='json').status_code == 404


@pytest.mark.django_db
def test_plan_del_mes_de_gestion_interna(api_client, equipo_client, cm_client, persona):
    body = {'cliente': None, 'tareas': [{'titulo': 'Reunión semanal', 'fecha_limite': '2026-11-02', 'etiqueta': 'reuniones', 'asignados': [persona.id]}]}
    assert api_client.post('/api/tareas/plan/', body, format='json').status_code == 201
    assert cm_client.post('/api/tareas/plan/', body, format='json').status_code == 201
    assert equipo_client.post('/api/tareas/plan/', body, format='json').status_code == 403
    assert Tarea.objects.filter(cliente__isnull=True, titulo='Reunión semanal').count() == 2
