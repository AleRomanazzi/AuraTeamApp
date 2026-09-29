from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('calendario', '0002_eventounico_cliente_eventounico_google_event_id_and_more'),
        ('clientes', '0002_migrar_clientes_mensuales'),
    ]

    operations = [migrations.DeleteModel(name='ClienteMensual')]
