"""Reporte mensual para enviarle al cliente: lo que se hizo en el mes y sus estadísticas.

Nunca lleva datos internos de dinero (ni rentabilidad, ni pagos al equipo, ni cobros) ni tareas privadas o de servicios.
"""

from collections import defaultdict
from html import escape

from django.db.models import Q

from apps.core.utils import parse_mes
from apps.notificaciones import email as correo

MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']


def nombre_mes(periodo: str) -> str:
    y, m = periodo.split('-')
    return f'{MESES[int(m) - 1]} {y}'


def datos(cliente, periodo: str) -> dict:
    from apps.calendario import etiquetas
    from apps.calendario.models import EventoUnico
    from apps.equipo.models import Tarea
    from apps.stats.models import AnalisisStats

    inicio, fin, periodo = parse_mes(periodo, required=True)
    privadas = etiquetas.privadas()
    hechas = (
        Tarea.objects.filter(cliente=cliente, estado='hecha', completada_en__date__gte=inicio, completada_en__date__lte=fin)
        .exclude(etiqueta__in=privadas)
        .filter(aviso_servicio__isnull=True)
        .order_by('completada_en')
    )
    por_etiqueta = defaultdict(list)
    for t in hechas:
        por_etiqueta[t.etiqueta].append(t.titulo)
    eventos = (
        EventoUnico.objects.filter(cliente=cliente, inicio__date__gte=inicio, inicio__date__lte=fin)
        .exclude(etiqueta__in=privadas)
        .order_by('inicio')
    )
    analisis = (
        AnalisisStats.objects.filter(cliente=cliente, estado='listo')
        .filter(Q(periodo_hasta__gte=inicio, periodo_hasta__lte=fin) | Q(periodo_hasta__isnull=True, creado__date__gte=inicio, creado__date__lte=fin))
        .order_by('-creado')
        .first()
    )
    return {
        'periodo': periodo,
        'grupos': [(etiquetas.nombre_de(e), titulos) for e, titulos in sorted(por_etiqueta.items(), key=lambda x: -len(x[1]))],
        'total': hechas.count(),
        'eventos': [(e.inicio, e.nombre) for e in eventos],
        'analisis': analisis,
    }


def _tabla_metricas(metricas) -> str:
    filas = ''
    for m in metricas or []:
        if not isinstance(m, dict) or not m.get('nombre'):
            continue
        filas += (
            '<tr>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">{escape(str(m.get("nombre")))}</td>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">{escape(str(m.get("antes", "")))}</td>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">{escape(str(m.get("despues", "")))}</td>'
            f'<td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">{escape(str(m.get("variacion", "")))}</td>'
            '</tr>'
        )
    if not filas:
        return ''
    cabecera = ''.join(
        f'<th style="padding:6px 8px;text-align:{a};color:#6b7280;font-weight:600">{t}</th>'
        for t, a in (('Métrica', 'left'), ('Antes', 'right'), ('Ahora', 'right'), ('Variación', 'right'))
    )
    return f'<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px"><tr>{cabecera}</tr>{filas}</table>'


def armar(cliente, periodo: str) -> tuple[str, str]:
    """(asunto, html) del reporte del mes."""
    d = datos(cliente, periodo)
    mes = nombre_mes(d['periodo'])
    bloques = [correo.parrafo(f'¡Hola {cliente.contacto or cliente.nombre}! Te compartimos el resumen de lo que hicimos juntos en {mes}.')]
    if d['total']:
        bloques.append(correo.subtitulo(f'Trabajo realizado · {d["total"]} entregas'))
        for nombre, titulos in d['grupos']:
            bloques.append(correo.parrafo(f'{nombre} ({len(titulos)})'))
            bloques.append(correo.lista(titulos[:15] + ([f'y {len(titulos) - 15} más'] if len(titulos) > 15 else [])))
    if d['eventos']:
        bloques.append(correo.subtitulo('Coberturas y reuniones'))
        bloques.append(correo.lista([f'{e.strftime("%d/%m")} · {n}' for e, n in d['eventos']]))
    a = d['analisis']
    if a:
        bloques.append(correo.subtitulo(f'Estadísticas{f" de {a.plataforma}" if a.plataforma else ""}'))
        bloques.append(_tabla_metricas(a.metricas))
        if a.interpretacion:
            bloques.append(correo.parrafo(a.interpretacion))
    if not d['total'] and not d['eventos'] and not a:
        bloques.append(correo.parrafo('Este mes no registramos entregas en el panel.'))
    bloques.append(correo.parrafo('Cualquier duda o idea para el mes que viene, respondé este email. ¡Gracias por confiar en AuraTeam!'))
    html = correo.plantilla(f'Reporte de {mes} · {cliente.nombre}', bloques, pie='AuraTeam · Agencia de marketing')
    return f'Reporte de {mes} · {cliente.nombre} · AuraTeam', html
