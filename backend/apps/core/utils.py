import calendar
import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal

from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.exceptions import ValidationError

MES_RE = re.compile(r'^(\d{4})-(\d{2})$')

MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

PERIODICIDAD_MESES = {
    'mensual': 1,
    'bimestral': 2,
    'trimestral': 3,
    'semestral': 6,
    'anual': 12,
}


def today() -> date:
    return timezone.localdate()


def mes_actual() -> str:
    d = today()
    return f'{d.year:04d}-{d.month:02d}'


def parse_mes(value: str | None, *, required: bool = False, param: str = 'mes') -> tuple[date, date, str]:
    """Devuelve (primer día, último día, 'YYYY-MM'). Sin valor usa el mes actual; formato inválido -> 400."""
    if not value:
        if required:
            raise ValidationError({param: 'Parámetro requerido con formato YYYY-MM.'})
        value = mes_actual()
    m = MES_RE.match(str(value).strip())
    if not m:
        raise ValidationError({param: 'Formato inválido; se espera YYYY-MM.'})
    y, mo = int(m.group(1)), int(m.group(2))
    if not (1 <= mo <= 12) or not (2000 <= y <= 2100):
        raise ValidationError({param: 'Mes fuera de rango.'})
    last = calendar.monthrange(y, mo)[1]
    return date(y, mo, 1), date(y, mo, last), f'{y:04d}-{mo:02d}'


def parse_fecha_param(value: str | None, param: str):
    """Acepta YYYY-MM-DD o ISO datetime; formato inválido -> 400."""
    if not value:
        return None
    raw = str(value).strip()
    dt = parse_datetime(raw)
    if dt is not None:
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt)
        return dt
    d = parse_date(raw) if len(raw) == 10 else None
    if d is not None:
        return timezone.make_aware(datetime(d.year, d.month, d.day))
    raise ValidationError({param: 'Fecha inválida; se espera YYYY-MM-DD o ISO 8601.'})


def add_months(y: int, m: int, delta: int) -> tuple[int, int]:
    idx = y * 12 + (m - 1) + delta
    return idx // 12, idx % 12 + 1


def meses_entre(a: date, b: date) -> int:
    """Cantidad de meses calendario de a hasta b (b >= a)."""
    return (b.year - a.year) * 12 + (b.month - a.month)


def fecha_en_mes(y: int, m: int, dia: int) -> date:
    last = calendar.monthrange(y, m)[1]
    return date(y, m, max(1, min(int(dia or 1), last)))


def mes_label(y: int, m: int) -> str:
    return MESES_CORTOS[m - 1]


def money(value) -> Decimal:
    return Decimal(value or 0).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def dec_str(value) -> str:
    return format(money(value), 'f')


def equivalente_mensual(monto, periodicidad: str) -> Decimal:
    meses = PERIODICIDAD_MESES.get(periodicidad)
    if not meses:
        return Decimal('0')
    return Decimal(monto or 0) / Decimal(meses)


def aplica_en_mes(inicio: date, periodicidad: str, y: int, m: int) -> bool:
    """Si un concepto recurrente que arranca en `inicio` corresponde al mes y-m."""
    target = date(y, m, 1)
    base = date(inicio.year, inicio.month, 1)
    if target < base:
        return False
    if periodicidad == 'unico':
        return target == base
    paso = PERIODICIDAD_MESES.get(periodicidad)
    if not paso:
        return False
    return meses_entre(base, target) % paso == 0
