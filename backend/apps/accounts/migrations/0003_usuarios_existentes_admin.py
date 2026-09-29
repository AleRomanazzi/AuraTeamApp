from django.db import migrations


def usuarios_existentes_admin(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    User.objects.all().update(rol='admin')


class Migration(migrations.Migration):
    dependencies = [('accounts', '0002_user_persona_user_rol')]

    operations = [migrations.RunPython(usuarios_existentes_admin, migrations.RunPython.noop)]
