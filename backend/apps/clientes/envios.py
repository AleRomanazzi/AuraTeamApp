"""Emails a clientes desde el Gmail de la agencia: reporte mensual (borrador para revisar) y recordatorios de cobro.

Salen con copia oculta a la cuenta de la agencia; desde local nunca se envían (`EMAILS_SOLO_LOG`).
"""

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.utils import add_months
from apps.notificaciones import email as correo

from . import reporte_cliente
from .models import Cliente, Cobro, ConfigEnvios, EnvioCliente

logger = logging.getLogger(__name__)

HORA_ENVIOS = 9
# Si el cron no corrió el día justo, una etapa del recordatorio se manda igual hasta este margen de días.
MARGEN_DIAS = 2
ABIERTOS = ('pendiente', 'parcial')


def _bcc() -> list[str]:
    from apps.accounts.google import cuenta

    c = cuenta()
    return [c.email] if c and c.email else []


def enviar(envio: EnvioCliente, user=None) -> EnvioCliente:
    """Envía un envío en borrador (o que falló). Un fallo queda registrado en el envío; nunca lanza."""
    para = envio.cliente.email
    if not para:
        envio.estado, envio.error = 'error', 'El cliente no tiene email cargado.'
    else:
        try:
            correo.enviar([para], envio.asunto, envio.html, bcc=_bcc())
            envio.estado, envio.error, envio.para = 'enviado', '', para
            envio.enviado_en, envio.enviado_por = timezone.now(), user
        except correo.EmailError as e:
            envio.estado, envio.error = 'error', str(e)[:300]
        except Exception as e:
            logger.exception('Error enviando el email %s', envio.pk)
            envio.estado, envio.error = 'error', f'{e.__class__.__name__}: {e}'[:300]
    envio.save()
    return envio


# Reporte mensual


def preparar_reporte(cliente: Cliente, periodo: str) -> EnvioCliente:
    """Crea o regenera el borrador del reporte del período (si ya se envió, lo devuelve tal cual)."""
    asunto, html = reporte_cliente.armar(cliente, periodo)
    envio = EnvioCliente.objects.filter(cliente=cliente, tipo='reporte', periodo=periodo).first()
    if envio is None:
        try:
            with transaction.atomic():
                return EnvioCliente.objects.create(cliente=cliente, tipo='reporte', periodo=periodo, asunto=asunto, html=html)
        except IntegrityError:
            envio = EnvioCliente.objects.get(cliente=cliente, tipo='reporte', periodo=periodo)
    if envio.estado != 'enviado':
        envio.asunto, envio.html, envio.estado, envio.error = asunto, html, 'borrador', ''
        envio.save()
    return envio


def reportes_del_mes(periodo: str) -> dict:
    """Borradores del reporte de cada cliente activo con email; los de `reporte_auto` salen directo. Avisa a los admins."""
    from apps.notificaciones.services import admins, notificar

    nuevos = enviados = 0
    for cliente in Cliente.objects.filter(estado='activo').exclude(email=''):
        if EnvioCliente.objects.filter(cliente=cliente, tipo='reporte', periodo=periodo).exists():
            continue
        envio = preparar_reporte(cliente, periodo)
        nuevos += 1
        if cliente.reporte_auto:
            enviar(envio)
            enviados += envio.estado == 'enviado'
    revisar = nuevos - enviados
    if revisar:
        mes = reporte_cliente.nombre_mes(periodo)
        notificar(
            admins(), 'cliente', f'{revisar} reporte{"s" if revisar != 1 else ""} de {mes} para revisar',
            'Revisalos y envialos desde el Dashboard.', '/', clave=f'reportes:{periodo}',
        )
    return {'reportes': nuevos, 'reportes_enviados': enviados}


# Recordatorios de cobro


def _pesos(valor) -> str:
    from apps.servicios.services import pesos

    return pesos(valor)


def armar_recordatorio(cobro: Cobro, hoy) -> tuple[str, str]:
    mes = reporte_cliente.nombre_mes(cobro.periodo)
    saldo = _pesos(cobro.saldo)
    fecha = cobro.vencimiento.strftime('%d/%m/%Y')
    if cobro.vencimiento < hoy:
        texto = f'Te escribimos para recordarte que quedó pendiente el pago de {cobro.concepto} ({mes}) por {saldo}, que venció el {fecha}.'
        asunto = f'Pago pendiente · {cobro.concepto} ({mes})'
    elif cobro.vencimiento == hoy:
        texto = f'Te recordamos que hoy vence el pago de {cobro.concepto} ({mes}) por {saldo}.'
        asunto = f'Hoy vence · {cobro.concepto} ({mes})'
    else:
        texto = f'Te recordamos que el {fecha} vence el pago de {cobro.concepto} ({mes}) por {saldo}.'
        asunto = f'Recordatorio de pago · {cobro.concepto} ({mes})'
    bloques = [
        correo.parrafo(f'¡Hola {cobro.cliente.contacto or cobro.cliente.nombre}! ¿Cómo va?'),
        correo.parrafo(texto),
        correo.parrafo('Cuando lo abones, si podés respondé este email con el comprobante. ¡Gracias!'),
    ]
    return f'{asunto} · AuraTeam', correo.plantilla('Recordatorio de pago', bloques, pie='AuraTeam · Agencia de marketing')


def etapas(cobro: Cobro, config: ConfigEnvios) -> list[tuple[str, object]]:
    """[(clave, fecha)] en que corresponde recordar el cobro."""
    salida = []
    if config.dias_antes:
        salida.append(('antes', cobro.vencimiento - timedelta(days=config.dias_antes)))
    salida.append(('dia', cobro.vencimiento))
    salida += [(f'+{d}', cobro.vencimiento + timedelta(days=d)) for d in config.lista_despues()]
    return salida


def recordar(cobro: Cobro, clave: str, hoy, user=None) -> EnvioCliente | None:
    asunto, html = armar_recordatorio(cobro, hoy)
    try:
        with transaction.atomic():
            envio = EnvioCliente.objects.create(
                cliente=cobro.cliente, cobro=cobro, tipo='recordatorio', periodo=cobro.periodo, clave=clave, asunto=asunto, html=html,
            )
    except IntegrityError:
        return None
    return enviar(envio, user)


def recordatorios_de_cobro(hoy) -> int:
    """Para clientes con recordatorios activos: la última etapa que toca y no se mandó (una por cobro y corrida)."""
    config = ConfigEnvios.get()
    enviados = 0
    cobros = Cobro.objects.filter(estado__in=ABIERTOS, cliente__recordatorios_cobro=True).exclude(cliente__email='').select_related('cliente')
    for cobro in cobros.filter(vencimiento__gte=hoy - timedelta(days=60), vencimiento__lte=hoy + timedelta(days=config.dias_antes)):
        ya = set(cobro.envios.filter(tipo='recordatorio').values_list('clave', flat=True))
        debidas = [(c, f) for c, f in etapas(cobro, config) if f <= hoy < f + timedelta(days=MARGEN_DIAS)]
        if debidas and debidas[-1][0] not in ya:
            envio = recordar(cobro, debidas[-1][0], hoy)
            enviados += bool(envio and envio.estado == 'enviado')
    return enviados


def programados(ahora) -> dict:
    """Paso del cron: desde las 9 h, recordatorios del día y, desde el día configurado, los reportes del mes anterior."""
    from apps.notificaciones.models import EstadoCron

    local = timezone.localtime(ahora)
    if local.hour < HORA_ENVIOS:
        return {}
    hoy = local.date()
    resultado = {'recordatorios': recordatorios_de_cobro(hoy)}
    y, m = add_months(hoy.year, hoy.month, -1)
    anterior = f'{y:04d}-{m:02d}'
    estado = EstadoCron.get()
    if hoy.day >= ConfigEnvios.get().dia_reporte and estado.ultimo_reporte_clientes != anterior:
        EstadoCron.objects.filter(pk=estado.pk).update(ultimo_reporte_clientes=anterior)
        resultado.update(reportes_del_mes(anterior))
    return resultado
