import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('finanzas', '0003_seed_categorias')]

    operations = [
        migrations.RemoveField(model_name='transaccion', name='categoria'),
        migrations.RenameField(model_name='transaccion', old_name='categoria_ref', new_name='categoria'),
        migrations.AlterField(
            model_name='transaccion',
            name='categoria',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='transacciones',
                to='finanzas.categoria',
            ),
        ),
    ]
