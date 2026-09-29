from datetime import date

from django.db import migrations
from django.utils import timezone


def migrar(apps, schema_editor):
    ClienteMensual = apps.get_model('calendario', 'ClienteMensual')
    Cliente = apps.get_model('clientes', 'Cliente')
    Contrato = apps.get_model('clientes', 'Contrato')
    Categoria = apps.get_model('finanzas', 'Categoria')

    fee = Categoria.objects.filter(nombre='Fee mensual', tipo='ingreso').first()
    hoy = timezone.localdate()
    inicio = date(hoy.year, hoy.month, 1)

    for cm in ClienteMensual.objects.all():
        cliente = Cliente.objects.filter(nombre=cm.nombre).first()
        if cliente is None:
            cliente = Cliente.objects.create(
                user_id=cm.user_id,
                nombre=cm.nombre,
                color=cm.color or '#4fffb0',
                notas=cm.descripcion or '',
                fecha_alta=hoy,
            )
        if cm.monto and cm.monto > 0:
            Contrato.objects.create(
                cliente=cliente,
                concepto=(cm.descripcion or 'Fee mensual')[:160],
                categoria=fee,
                monto=cm.monto,
                periodicidad='mensual',
                dia_vencimiento=max(1, min(int(cm.dia_mes or 1), 31)),
                fecha_inicio=inicio,
                activo=True,
            )


class Migration(migrations.Migration):
    dependencies = [
        ('clientes', '0001_initial'),
        ('calendario', '0002_eventounico_cliente_eventounico_google_event_id_and_more'),
        ('finanzas', '0004_categoria_fk'),
    ]

    operations = [migrations.RunPython(migrar, migrations.RunPython.noop)]
