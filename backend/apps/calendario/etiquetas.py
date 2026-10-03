"""Etiquetas de eventos y tareas: las base más los calendarios que se van creando en la cuenta de Google de la agencia.

Las privadas solo las ven los administradores (en el panel, en Google y, para tareas, en la base privada de Notion);
las ocultas no se ofrecen en los formularios ni se sincronizan.
"""

from rest_framework import serializers

from apps.core.permissions import es_admin

from .models import ETIQUETAS, ETIQUETAS_PRIVADAS, CalendarioGoogle

BASE = dict(ETIQUETAS)


def _item(valor, nombre, cal):
    return {
        'valor': valor,
        'nombre': nombre,
        'base': valor in BASE,
        'privada': valor in ETIQUETAS_PRIVADAS or bool(cal and cal.privada),
        'oculta': bool(cal and cal.oculta),
        'calendar_id': cal.calendar_id if cal else None,
        'calendario': cal.nombre if cal else None,
    }


def todas() -> list:
    filas = {c.etiqueta: c for c in CalendarioGoogle.objects.all()}
    lista = [_item(valor, nombre, filas.pop(valor, None)) for valor, nombre in ETIQUETAS]
    for cal in sorted(filas.values(), key=lambda c: (c.nombre or c.etiqueta).lower()):
        lista.append(_item(cal.etiqueta, cal.nombre or cal.etiqueta, cal))
    return sorted(lista, key=lambda e: e['privada'])


def para(user) -> list:
    lista = [e for e in todas() if not e['oculta']]
    return lista if es_admin(user) else [e for e in lista if not e['privada']]


def privadas() -> set:
    return set(ETIQUETAS_PRIVADAS) | set(CalendarioGoogle.objects.filter(privada=True).values_list('etiqueta', flat=True))


def nombre_de(valor: str) -> str:
    if valor in BASE:
        return BASE[valor]
    cal = CalendarioGoogle.objects.filter(etiqueta=valor).first()
    return (cal.nombre if cal else '') or valor


def validar(valor: str, user, actual: str | None = None) -> str:
    """Para los serializers: la etiqueta tiene que existir y las privadas son solo de los administradores."""
    if valor == actual:
        return valor
    if valor not in BASE and not CalendarioGoogle.objects.filter(etiqueta=valor).exists():
        raise serializers.ValidationError('Esa etiqueta no existe.')
    if valor in privadas() and not (user and es_admin(user)):
        raise serializers.ValidationError('Esa etiqueta es solo para los socios.')
    return valor
