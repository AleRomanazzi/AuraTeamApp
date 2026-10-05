"""Emails desde la cuenta de Gmail de la agencia (API de Gmail con el token de `accounts.google`).

Fuera de producción no se envía nada: se registra en el log (`EMAILS_SOLO_LOG`).
"""

import base64
import logging
from email.message import EmailMessage
from html import escape

import httpx
from django.conf import settings

from apps.accounts import google

logger = logging.getLogger(__name__)

SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
TIMEOUT = 20
PANEL_URL = 'https://aurateamapp.netlify.app'


class EmailError(Exception):
    pass


def url_panel(ruta: str = '') -> str:
    base = settings.FRONTEND_URL or PANEL_URL
    return f'{base}{ruta}' if ruta.startswith('/') else ruta or base


def plantilla(titulo: str, bloques: list[str], boton: tuple[str, str] | None = None, pie: str = '') -> str:
    """HTML simple con la marca de la agencia. `bloques` ya viene escapado (párrafos o listas)."""
    cta = ''
    if boton:
        texto, ruta = boton
        cta = (
            f'<p style="margin:24px 0 8px"><a href="{escape(url_panel(ruta))}" '
            'style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">'
            f'{escape(texto)}</a></p>'
        )
    cuerpo = ''.join(bloques)
    return (
        '<div style="font-family:Inter,Arial,sans-serif;background:#0b1020;padding:24px">'
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px;color:#111827">'
        '<div style="font-weight:800;letter-spacing:2px;color:#2563eb;font-size:13px">AURATEAM</div>'
        f'<h1 style="font-size:20px;margin:8px 0 16px">{escape(titulo)}</h1>'
        f'{cuerpo}{cta}'
        f'<p style="color:#6b7280;font-size:12px;margin-top:28px">{pie or "Enviado desde el panel de AuraTeam."}</p>'
        '</div></div>'
    )


def parrafo(texto: str) -> str:
    return f'<p style="margin:0 0 12px;line-height:1.5">{escape(texto)}</p>'


def lista(items: list[str]) -> str:
    if not items:
        return ''
    return '<ul style="margin:0 0 12px;padding-left:20px;line-height:1.6">' + ''.join(f'<li>{escape(i)}</li>' for i in items) + '</ul>'


def subtitulo(texto: str) -> str:
    return f'<h2 style="font-size:15px;margin:18px 0 8px">{escape(texto)}</h2>'


def enviar(para: list[str] | str, asunto: str, html: str, bcc: list[str] | None = None) -> bool:
    """Envía un email; devuelve True si salió (o se registró en modo solo log). Lanza EmailError si Google falla."""
    para = [para] if isinstance(para, str) else [p for p in para if p]
    if not para:
        return False
    if settings.EMAILS_SOLO_LOG:
        logger.info('Email (solo log) a %s: %s', ', '.join(para), asunto)
        return True
    msg = EmailMessage()
    msg['To'] = ', '.join(para)
    if bcc:
        msg['Bcc'] = ', '.join(bcc)
    msg['Subject'] = asunto
    msg.set_content('Abrí este email en un cliente que muestre HTML.')
    msg.add_alternative(html, subtype='html')
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        token = google.access_token()['access_token']
        r = httpx.post(SEND_URL, headers={'Authorization': f'Bearer {token}'}, json={'raw': raw}, timeout=TIMEOUT)
    except google.GoogleError as e:
        raise EmailError(str(e)) from e
    except httpx.HTTPError as e:
        raise EmailError(f'No se pudo contactar a Gmail ({e.__class__.__name__}).') from e
    if r.status_code >= 400:
        raise EmailError(f'Gmail respondió {r.status_code}.')
    return True


def enviar_seguro(para, asunto: str, html: str, bcc=None) -> bool:
    """Como `enviar`, pero un fallo solo queda en el log: nunca corta la operación que lo disparó."""
    try:
        return enviar(para, asunto, html, bcc)
    except EmailError as e:
        logger.warning('No se pudo enviar el email «%s»: %s', asunto, e)
    except Exception:
        logger.exception('Error inesperado enviando el email «%s»', asunto)
    return False
