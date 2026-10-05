"""Onboarding de clientes: la plantilla de pasos se convierte en tareas asignadas por rol al dar de alta un cliente.

Las tareas llegan a Notion y a Google de a tandas, con las sincronizaciones incrementales (como el plan del mes).
"""

import logging
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.accounts.google import GoogleError
from apps.core.permissions import es_admin, persona_de
from apps.core.utils import today
from apps.equipo.models import AsignacionCliente, AsignacionTarea, Persona, Tarea

from .models import ROLES_ONBOARDING, Cliente, PasoOnboarding

logger = logging.getLogger(__name__)

ROLES = [r for r, _ in ROLES_ONBOARDING]
# Para reconocer el rol en el texto libre de AsignacionCliente.rol cuando la persona no tiene usuario con roles.
ALIAS_ROL = {'cm': ('cm', 'community'), 'editor': ('edit', 'video'), 'disenio': ('diseñ', 'disen'), 'foto': ('foto', 'film')}


class OnboardingYaIniciado(Exception):
    pass


def _usuario(persona):
    return getattr(persona, 'usuario', None)


def responsables_sugeridos(cliente: Cliente, user=None) -> dict:
    """{rol: persona_id | None}: por defecto, la persona asignada al cliente con ese rol; para socios, quien lo inicia."""
    asignaciones = list(
        AsignacionCliente.objects.filter(cliente=cliente, activo=True, persona__activo=True).select_related('persona__usuario')
    )
    salida = {}
    for rol, alias in ALIAS_ROL.items():
        elegida = next((a.persona for a in asignaciones if rol in ((_usuario(a.persona) and _usuario(a.persona).roles) or [])), None)
        elegida = elegida or next((a.persona for a in asignaciones if any(x in a.rol.lower() for x in alias)), None)
        salida[rol] = elegida.id if elegida else None
    socio = persona_de(user) if user is not None and es_admin(user) else None
    if socio is None:
        socio = Persona.objects.filter(activo=True, usuario__rol='admin', usuario__is_active=True).order_by('id').first()
    salida['admin'] = socio.id if socio else None
    return salida


def iniciar_onboarding(cliente: Cliente, responsables=None, user=None) -> list:
    """Crea las tareas de la plantilla con fecha = alta (o hoy, si el alta ya pasó) + días del paso."""
    from apps.notificaciones.services import asignadas_en_tanda

    if Tarea.objects.filter(cliente=cliente, onboarding=True).exists():
        raise OnboardingYaIniciado(f'{cliente.nombre} ya tiene el onboarding iniciado.')
    pasos = list(PasoOnboarding.objects.filter(activo=True))
    elegidos = responsables_sugeridos(cliente, user)
    for rol, pid in (responsables or {}).items():
        if rol in ROLES:
            elegidos[rol] = int(pid) if pid else None
    base = max(cliente.fecha_alta or today(), today())

    creadas = []
    with transaction.atomic():
        for paso in pasos:
            tarea = Tarea.objects.create(
                titulo=f'{paso.titulo} · {cliente.nombre}'[:200], descripcion=paso.descripcion, cliente=cliente, prioridad='alta',
                fecha_limite=base + timedelta(days=paso.dias_desde_alta), etiqueta=paso.etiqueta, onboarding=True,
                paso_onboarding=paso, user=user,
            )
            if elegidos.get(paso.rol):
                AsignacionTarea.objects.create(persona_id=elegidos[paso.rol], tarea=tarea)
            creadas.append(tarea)
        Cliente.objects.filter(pk=cliente.pk).update(onboarding_iniciado=timezone.now())

    for tarea in creadas:
        if tarea.paso_onboarding and tarea.paso_onboarding.accion == 'drive':
            crear_drive(cliente, tarea)
    asignadas_en_tanda([t for t in creadas if t.estado != 'hecha'], f'del onboarding de {cliente.nombre}', user, email=True)
    return creadas


def crear_drive(cliente: Cliente, tarea: Tarea | None = None) -> str:
    """Vincula o crea la carpeta de Drive del cliente y cierra la tarea del paso. Si Google falla, la tarea queda manual."""
    from apps.integraciones import drive

    try:
        url = drive.crear_carpeta_cliente(cliente)
    except GoogleError as e:
        logger.warning('Onboarding: no se pudo crear la carpeta de Drive de %s: %s', cliente.pk, e)
        if tarea is not None:
            nota = f'No se pudo crear sola ({e}). Creala a mano y pegá el link.'
            Tarea.objects.filter(pk=tarea.pk).update(descripcion=f'{tarea.descripcion}\n\n{nota}'.strip())
        return ''
    cerrar_paso_drive(cliente, url, tarea)
    return url


def cerrar_paso_drive(cliente: Cliente, url: str, tarea: Tarea | None = None) -> None:
    tarea = tarea or Tarea.objects.filter(cliente=cliente, onboarding=True, paso_onboarding__accion='drive').exclude(estado='hecha').first()
    if tarea is not None:
        links = [*(tarea.links or []), {'titulo': 'Carpeta de Drive', 'url': url}]
        Tarea.objects.filter(pk=tarea.pk).update(estado='hecha', completada_en=timezone.now(), links=links)
        tarea.estado = 'hecha'


def progreso(cliente: Cliente) -> dict:
    hoy = today()
    tareas = list(Tarea.objects.filter(cliente=cliente, onboarding=True).prefetch_related('asignaciones__persona').order_by('fecha_limite', 'id'))
    return {
        'iniciado': cliente.onboarding_iniciado,
        'total': len(tareas),
        'hechas': sum(1 for t in tareas if t.estado == 'hecha'),
        'vencidas': sum(1 for t in tareas if t.estado != 'hecha' and t.fecha_limite and t.fecha_limite < hoy),
        'drive_url': cliente.drive_url,
        'tareas': tareas,
    }


def atrasados(fecha) -> list:
    """Clientes con pasos de onboarding vencidos sin hacer, para «Equipo hoy» y el Dashboard."""
    salida = []
    con_vencidas = Tarea.objects.filter(onboarding=True, fecha_limite__lt=fecha).exclude(estado='hecha').values('cliente_id')
    for c in Cliente.objects.filter(id__in=con_vencidas).exclude(estado='baja'):
        tareas = list(c.tareas.filter(onboarding=True).values_list('estado', 'fecha_limite'))
        vencidas = sum(1 for e, f in tareas if e != 'hecha' and f and f < fecha)
        if vencidas:
            salida.append({
                'cliente': c.id, 'nombre': c.nombre, 'total': len(tareas), 'hechas': sum(1 for e, _ in tareas if e == 'hecha'),
                'vencidas': vencidas,
            })
    return salida
