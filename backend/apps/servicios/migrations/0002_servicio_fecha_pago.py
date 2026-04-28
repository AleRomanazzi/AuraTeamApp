from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('servicios', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='servicio',
            name='fecha_pago',
            field=models.DateField(blank=True, null=True),
        ),
    ]
