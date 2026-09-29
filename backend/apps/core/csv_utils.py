import csv
from io import StringIO

from django.http import HttpResponse

FORMULA_PREFIXES = ('=', '+', '-', '@', '\t', '\r')


def csv_safe(value) -> str:
    """Evita que Excel/Sheets interpreten el valor como fórmula (CSV injection)."""
    s = '' if value is None else str(value)
    if s.startswith(FORMULA_PREFIXES):
        return "'" + s
    return s


def monto_es(value) -> str:
    """Monto con coma decimal para Excel en español."""
    return format(value, 'f').replace('.', ',')


def csv_response(filename: str, header: list[str], rows) -> HttpResponse:
    """CSV listo para Excel en español: BOM UTF-8, separador `;`, celdas saneadas."""
    buf = StringIO()
    w = csv.writer(buf, delimiter=';')
    w.writerow(header)
    for row in rows:
        w.writerow([csv_safe(cell) for cell in row])
    resp = HttpResponse('\ufeff' + buf.getvalue(), content_type='text/csv; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="{filename}"'
    return resp
