import uuid
from datetime import date

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from apps.clientes.models import Cliente
from apps.equipo import services
from apps.equipo.models import Subtarea, Tarea, TareaRecurrente


def _silenciar_sync(monkeypatch):
    monkeypatch.setattr('apps.equipo.views.notion.al_guardar_tarea', lambda *a, **k: None)
    monkeypatch.setattr('apps.equipo.views.google_calendar.al_guardar_tarea', lambda *a, **k: None)


@pytest.mark.django_db
def test_tildar_la_ultima_pasa_a_hecha_y_destildar_reabre(api_client, monkeypatch):
    servicios = []
    _silenciar_sync(monkeypatch)
    monkeypatch.setattr('apps.equipo.views.servicios_al_completar', lambda tarea, user=None: servicios.append(tarea.pk))
    r = api_client.post('/api/tareas/', {
        'titulo': 'Subir historia',
        'subtareas': [{'titulo': 'Historia 1'}, {'titulo': 'Historia 2'}, {'titulo': 'Historia 3'}],
    }, format='json')
    assert r.status_code == 201, r.data
    assert r.data['progreso'] == {'hechas': 0, 'total': 3, 'porcentaje': 0}
    tarea_id, subs = r.data['id'], r.data['subtareas']

    r = api_client.patch(f'/api/tareas/{tarea_id}/subtareas/{subs[0]["id"]}/', {'hecha': True}, format='json')
    assert r.data['estado'] == 'pendiente' and r.data['progreso'] == {'hechas': 1, 'total': 3, 'porcentaje': 33}
    api_client.patch(f'/api/tareas/{tarea_id}/subtareas/{subs[1]["id"]}/', {'hecha': True}, format='json')
    r = api_client.patch(f'/api/tareas/{tarea_id}/subtareas/{subs[2]["id"]}/', {'hecha': True}, format='json')
    assert r.data['estado'] == 'hecha' and r.data['progreso']['porcentaje'] == 100 and r.data['completada_en']
    assert servicios == [tarea_id]

    r = api_client.patch(f'/api/tareas/{tarea_id}/subtareas/{subs[2]["id"]}/', {'hecha': False}, format='json')
    assert r.data['estado'] == 'en_curso' and r.data['completada_en'] is None
    assert servicios == [tarea_id]


@pytest.mark.django_db
def test_marcar_hecha_tilda_todas_y_bloqueada_espera_al_tildado(api_client, monkeypatch):
    _silenciar_sync(monkeypatch)
    r = api_client.post('/api/tareas/', {
        'titulo': 'Subir historia', 'estado': 'bloqueada',
        'subtareas': [{'titulo': 'Historia 1', 'hecha': True}, {'titulo': 'Historia 2'}],
    }, format='json')
    assert r.data['estado'] == 'bloqueada' and r.data['progreso']['hechas'] == 1
    tarea_id = r.data['id']
    pendiente = next(s for s in r.data['subtareas'] if not s['hecha'])

    r = api_client.patch(f'/api/tareas/{tarea_id}/', {'estado': 'hecha'}, format='json')
    assert r.data['estado'] == 'hecha' and r.data['progreso']['hechas'] == r.data['progreso']['total']

    api_client.patch(f'/api/tareas/{tarea_id}/', {'estado': 'bloqueada'}, format='json')
    tarea = Tarea.objects.get(pk=tarea_id)
    assert tarea.estado == 'bloqueada' and tarea.subtareas.filter(hecha=False).count() == 0

    r = api_client.patch(f'/api/tareas/{tarea_id}/subtareas/{pendiente["id"]}/', {'hecha': False}, format='json')
    assert r.data['estado'] == 'bloqueada'
    r = api_client.patch(f'/api/tareas/{tarea_id}/subtareas/{pendiente["id"]}/', {'hecha': True}, format='json')
    assert r.data['estado'] == 'hecha'


@pytest.mark.django_db
def test_el_equipo_tilda_solo_sus_subtareas(api_client, equipo_client, equipo_user, monkeypatch):
    _silenciar_sync(monkeypatch)
    persona = equipo_user.persona
    ajena_cliente = Cliente.objects.create(nombre='Ajeno')
    mia = api_client.post('/api/tareas/', {
        'titulo': 'Mía', 'asignados': [persona.id], 'subtareas': [{'titulo': 'Historia 1'}],
    }, format='json')
    ajena = api_client.post('/api/tareas/', {
        'titulo': 'Ajena', 'cliente': ajena_cliente.id, 'subtareas': [{'titulo': 'Historia 1'}],
    }, format='json')
    assert equipo_client.patch(
        f'/api/tareas/{mia.data["id"]}/subtareas/{mia.data["subtareas"][0]["id"]}/', {'hecha': True}, format='json',
    ).status_code == 200
    assert equipo_client.patch(
        f'/api/tareas/{ajena.data["id"]}/subtareas/{ajena.data["subtareas"][0]["id"]}/', {'hecha': True}, format='json',
    ).status_code == 403


@pytest.mark.django_db
def test_plantilla_con_flag_crea_una_tarea_con_subtareas(api_client, persona, monkeypatch):
    monkeypatch.setattr(services, 'today', lambda: date(2026, 10, 21))
    _silenciar_sync(monkeypatch)
    cliente = Cliente.objects.create(nombre='Cycles')
    r = api_client.post('/api/tareas-recurrentes/', {
        'titulo': 'Subir historia', 'cliente': cliente.id, 'personas': [persona.id], 'dias': [2], 'por_dia': 3,
        'agrupar_subtareas': True, 'titulo_subtarea': 'Historia',
    }, format='json')
    assert r.status_code == 201, r.data
    tareas = Tarea.objects.filter(recurrente=r.data['id'])
    assert tareas.count() == 2
    assert set(tareas.values_list('titulo', flat=True)) == {'Subir historia'}
    assert [s.titulo for s in tareas.order_by('fecha_limite').first().subtareas.all()] == ['Historia 1', 'Historia 2', 'Historia 3']


def _dia(plantilla, fecha, estados):
    tareas = []
    for i, estado in enumerate(estados, start=1):
        tarea = Tarea.objects.create(
            titulo=f'{plantilla.titulo} {i}/3', estado=estado, fecha_limite=fecha, recurrente=plantilla,
            cliente=plantilla.cliente, notion_page_id=str(uuid.uuid4()), google_event_id=f'g-{plantilla.pk}-{fecha}-{i}',
        )
        if estado == 'hecha':
            tarea.completada_en = timezone.now()
            tarea.save(update_fields=['completada_en'])
        tareas.append(tarea)
    return tareas


@pytest.mark.django_db
def test_fusion_en_seco_no_escribe_y_aplicar_fusiona_solo_lo_abierto(monkeypatch):
    avisos, guardadas, borradas = [], [], []
    monkeypatch.setattr('apps.equipo.fusion.notion.al_guardar_tarea', lambda t: guardadas.append(t.pk))
    monkeypatch.setattr('apps.equipo.fusion.notion.al_borrar_tarea', lambda pid: borradas.append(pid))
    monkeypatch.setattr('apps.equipo.fusion.google_calendar.al_guardar_tarea', lambda *a, **k: None)
    monkeypatch.setattr('apps.equipo.fusion.google_calendar.al_borrar_tarea', lambda *a, **k: None)
    monkeypatch.setattr('apps.notificaciones.services.al_cambiar_estado', lambda *a, **k: avisos.append('estado'))
    monkeypatch.setattr('apps.notificaciones.services.al_asignar', lambda *a, **k: avisos.append('asigna'))

    cycles = Cliente.objects.create(nombre='Cycles Ferreyra')
    lennon = Cliente.objects.create(nombre='Redes Lennon')
    Cliente.objects.create(nombre='Otro')
    p = TareaRecurrente.objects.create(titulo='Cycles · Historia', cliente=cycles, dias=[0], por_dia=3, etiqueta='historias')
    p2 = TareaRecurrente.objects.create(titulo='Lennon · Historia', cliente=lennon, dias=[0], por_dia=3, etiqueta='historias')
    posteos = TareaRecurrente.objects.create(titulo='Cycles · Posteo', cliente=cycles, dias=[0], por_dia=2, etiqueta='posteos')
    abierto, hecho = date(2026, 10, 21), date(2026, 10, 20)
    abiertas = _dia(p, abierto, ['hecha', 'pendiente', 'pendiente'])
    hechas = _dia(p, hecho, ['hecha', 'hecha', 'hecha'])
    de_lennon = _dia(p2, abierto, ['pendiente', 'pendiente', 'pendiente'])
    _dia(posteos, abierto, ['pendiente', 'pendiente'])

    call_command('fusionar_historias')
    assert Tarea.objects.count() == 11
    assert not TareaRecurrente.objects.filter(agrupar_subtareas=True).exists()
    assert not guardadas and not borradas and not avisos

    call_command('fusionar_historias', '--aplicar')
    assert not avisos
    p.refresh_from_db()
    p2.refresh_from_db()
    posteos.refresh_from_db()
    assert p.agrupar_subtareas and p.titulo_subtarea == 'Historia'
    assert p2.agrupar_subtareas and not posteos.agrupar_subtareas
    assert Tarea.objects.filter(recurrente=p, fecha_limite=hecho).count() == 3
    assert Tarea.objects.filter(pk__in=[t.pk for t in hechas]).count() == 3

    queda = Tarea.objects.get(recurrente=p, fecha_limite=abierto)
    assert queda.pk == abiertas[0].pk and queda.titulo == 'Cycles · Historia' and queda.estado == 'en_curso'
    assert [(s.titulo, s.hecha) for s in queda.subtareas.all()] == [
        ('Historia 1', True), ('Historia 2', False), ('Historia 3', False),
    ]
    de_lennon_queda = Tarea.objects.get(recurrente=p2, fecha_limite=abierto)
    assert de_lennon_queda.estado == 'pendiente' and de_lennon_queda.subtareas.filter(hecha=True).count() == 0
    assert Tarea.objects.filter(recurrente=posteos, fecha_limite=abierto).count() == 2
    assert set(borradas) == {
        abiertas[1].notion_page_id, abiertas[2].notion_page_id,
        de_lennon[1].notion_page_id, de_lennon[2].notion_page_id,
    }
    assert set(guardadas) == {queda.pk, de_lennon_queda.pk}
    assert not Subtarea.objects.filter(tarea__in=hechas).exists()


@pytest.mark.django_db
def test_fusion_ambigua_no_escribe():
    Cliente.objects.create(nombre='Lennon')
    Cliente.objects.create(nombre='Lennon Norte')
    with pytest.raises(CommandError):
        call_command('fusionar_historias', '--aplicar')
    assert not TareaRecurrente.objects.filter(agrupar_subtareas=True).exists()
