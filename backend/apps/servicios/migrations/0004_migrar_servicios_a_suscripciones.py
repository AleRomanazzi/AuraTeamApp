from decimal import Decimal, InvalidOperation

from django.db import migrations

PERIODOS = {'mensual', 'bimestral', 'trimestral', 'semestral', 'anual'}
METODOS = {'partes-iguales', 'porcentaje', 'personalizado'}


def _dec(v):
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('0')


def migrar(apps, schema_editor):
    Servicio = apps.get_model('servicios', 'Servicio')
    Categoria = apps.get_model('finanzas', 'Categoria')
    software = Categoria.objects.filter(nombre='Software y suscripciones', tipo='egreso').first()

    for s in Servicio.objects.all():
        det = s.detalle if isinstance(s.detalle, dict) else {}
        ui = det.get('ui') or {}
        periodo = str(ui.get('periodo') or s.metodo or 'mensual').lower()
        if periodo not in PERIODOS:
            periodo = 'anual' if 'anu' in periodo else 'mensual'
        try:
            dia = int(ui.get('dia') or 1)
        except (TypeError, ValueError):
            dia = 1
        filas = []
        for row in ui.get('detallePersonas') or []:
            if isinstance(row, dict) and row.get('name'):
                filas.append({'nombre': str(row['name'])[:120], 'monto': format(_dec(row.get('monto')), 'f')})
        metodo = ui.get('splitMetodo') if filas and ui.get('splitMetodo') in METODOS else ('partes-iguales' if filas else 'sin_division')
        if s.detalle and isinstance(s.detalle, list):
            filas = s.detalle
        s.periodicidad = periodo
        s.dia_vencimiento = max(1, min(dia, 31))
        s.metodo = metodo
        s.detalle = filas
        if s.categoria_id is None and software:
            s.categoria = software
        # Los registros viejos a veces eran repartos de un cliente y no gastos reales:
        # no se generan egresos automáticos hasta que alguien los revise.
        s.generar_egreso = False
        s.save()


class Migration(migrations.Migration):
    dependencies = [
        ('servicios', '0003_alter_servicio_options_servicio_activo_and_more'),
        ('finanzas', '0004_categoria_fk'),
    ]

    operations = [migrations.RunPython(migrar, migrations.RunPython.noop)]
