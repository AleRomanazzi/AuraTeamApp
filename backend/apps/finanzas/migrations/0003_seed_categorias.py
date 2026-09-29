from django.db import migrations

INGRESOS = [
    ('Fee mensual', '#4fffb0'),
    ('Proyecto puntual', '#7c6fff'),
    ('Producción de contenido', '#4fc3f7'),
    ('Gestión de Ads', '#ffd166'),
    ('Diseño y branding', '#f06292'),
    ('Web', '#81c784'),
    ('Otros ingresos', '#90a4ae'),
]

EGRESOS = [
    ('Honorarios del equipo', '#7c6fff'),
    ('Software y suscripciones', '#4fc3f7'),
    ('Inversión publicitaria propia', '#ffd166'),
    ('Impuestos', '#ff6b6b'),
    ('Comisiones bancarias', '#ffab91'),
    ('Oficina', '#a1887f'),
    ('Equipamiento', '#ba68c8'),
    ('Otros', '#90a4ae'),
]


def seed(apps, schema_editor):
    Categoria = apps.get_model('finanzas', 'Categoria')
    Transaccion = apps.get_model('finanzas', 'Transaccion')

    for tipo, lista in (('ingreso', INGRESOS), ('egreso', EGRESOS)):
        for orden, (nombre, color) in enumerate(lista):
            Categoria.objects.get_or_create(
                nombre=nombre, tipo=tipo, defaults={'color': color, 'orden': orden, 'activa': True}
            )

    # Las categorías de texto libre previas se conservan inactivas para no romper el historial.
    for tx in Transaccion.objects.all().only('id', 'categoria', 'tipo'):
        nombre = (tx.categoria or '').strip() or ('Otros ingresos' if tx.tipo == 'ingreso' else 'Otros')
        cat, _ = Categoria.objects.get_or_create(
            nombre=nombre[:60], tipo=tx.tipo, defaults={'activa': False, 'color': '#90a4ae', 'orden': 900}
        )
        Transaccion.objects.filter(pk=tx.pk).update(categoria_ref=cat)


class Migration(migrations.Migration):
    dependencies = [('finanzas', '0002_categorias')]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
