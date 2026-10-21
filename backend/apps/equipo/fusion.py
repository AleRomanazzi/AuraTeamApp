"""Agrupa las historias abiertas de Cycles Ferreyra y Lennon en una tarea con subtareas.

En seco no escribe. Las tareas de un día que ya están todas hechas quedan como historial.
"""

import re
import unicodedata
from collections import defaultdict

from django.db import transaction

from apps.calendario import google_calendar
from apps.clientes.models import Cliente
from apps.equipo.models import Subtarea, Tarea, TareaRecurrente
from apps.equipo.services import estado_segun_subtareas, fijar_estado
from apps.integraciones import notion

OBJETIVOS = (
    ('Cycles Ferreyra', 'cycles'),
    ('Lennon', 'lennon'),
)


def _palabras(nombre):
    sin = unicodedata.normalize('NFKD', nombre or '').encode('ascii', 'ignore').decode().lower()
    return re.findall(r'[a-z0-9]+', sin)


def _es(tipo, nombre):
    palabras = _palabras(nombre)
    if tipo == 'cycles':
        return 'cyclesferreyra' in ''.join(palabras) or {'cycles', 'ferreyra'} <= set(palabras)
    return 'lennon' in palabras


def _indice(plantilla, tarea):
    m = re.fullmatch(rf'{re.escape(plantilla.titulo)} (\d+)/\d+', tarea.titulo)
    return int(m.group(1)) if m else None


def preparar():
    """Arma el plan sin escribir. Si un nombre matchea más de un cliente, aborta."""
    encontrados, ambiguos, faltan = [], [], []
    for etiqueta, tipo in OBJETIVOS:
        matches = [c for c in Cliente.objects.all() if _es(tipo, c.nombre)]
        if len(matches) > 1:
            ambiguos.append({'buscado': etiqueta, 'nombres': [c.nombre for c in matches]})
        elif len(matches) == 1:
            encontrados.append(matches[0])
        else:
            faltan.append(etiqueta)
    plan = {
        'abortar': bool(ambiguos), 'ambiguos': ambiguos, 'faltan': faltan,
        'clientes': [], 'plantilla_ids': [], 'grupos': [],
    }
    if plan['abortar']:
        return plan
    plantillas = list(TareaRecurrente.objects.filter(
        cliente__in=encontrados, etiqueta='historias', por_dia__gt=1,
    ).select_related('cliente'))
    plan['plantilla_ids'] = [p.pk for p in plantillas]
    for plantilla in plantillas:
        plan['clientes'].append(plantilla.cliente.nombre)
        tareas = Tarea.objects.filter(recurrente=plantilla).prefetch_related('subtareas')
        por_dia = defaultdict(list)
        for tarea in tareas:
            por_dia[tarea.fecha_limite].append(tarea)
        for fecha, grupo in sorted(por_dia.items(), key=lambda x: (x[0] is None, str(x[0] or ''))):
            if all(t.estado == 'hecha' for t in grupo):
                continue
            if len(grupo) == 1 and grupo[0].titulo == plantilla.titulo and list(grupo[0].subtareas.all()):
                continue
            principal = min(grupo, key=lambda t: (_indice(plantilla, t) is None, _indice(plantilla, t) or 9999, t.pk))
            hechas = {i: t.estado == 'hecha' for t in grupo if (i := _indice(plantilla, t))}
            plan['grupos'].append({
                'plantilla': plantilla,
                'fecha': fecha,
                'principal': principal,
                'borrar': [t for t in grupo if t.pk != principal.pk],
                'subtareas': [
                    (f'Historia {i}', hechas.get(i, False)) for i in range(1, plantilla.por_dia + 1)
                ],
            })
    plan['clientes'] = sorted(set(plan['clientes']))
    return plan


def aplicar(plan):
    """Escribe el plan. No manda avisos de asignación ni de cambio de estado."""
    if plan['abortar']:
        return 0
    for plantilla in TareaRecurrente.objects.filter(pk__in=plan['plantilla_ids']):
        plantilla.agrupar_subtareas = True
        plantilla.titulo_subtarea = 'Historia'
        plantilla.save(update_fields=['agrupar_subtareas', 'titulo_subtarea'])
    for grupo in plan['grupos']:
        _fusionar(grupo)
    return len(plan['grupos'])


def _fusionar(grupo):
    principal = grupo['principal']
    bajas = [(t.notion_page_id, t.google_event_id, t.google_calendar_id) for t in grupo['borrar']]
    with transaction.atomic():
        principal.titulo = grupo['plantilla'].titulo
        principal.save(update_fields=['titulo'])
        principal.subtareas.all().delete()
        Subtarea.objects.bulk_create([
            Subtarea(tarea=principal, titulo=titulo, hecha=hecha, orden=i)
            for i, (titulo, hecha) in enumerate(grupo['subtareas'], start=1)
        ])
        fijar_estado(principal, estado_segun_subtareas(principal, principal.estado))
        for tarea in grupo['borrar']:
            tarea.delete()
    principal._checklist_tocado = True
    notion.al_guardar_tarea(principal)
    google_calendar.al_guardar_tarea(principal)
    for page_id, gid, cal_id in bajas:
        notion.al_borrar_tarea(page_id)
        google_calendar.al_borrar_tarea(gid, cal_id)
