from django.db import migrations, models

PISTAS = [
    ('cm', ('community', 'comunicador', 'cm', 'redes')),
    ('editor', ('editor', 'edición', 'edicion')),
    ('disenio', ('diseñ', 'disen')),
    ('foto', ('fotó', 'foto', 'film')),
]


def roles_desde_puesto(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    for u in User.objects.filter(rol='equipo').select_related('persona'):
        puesto = (u.persona.rol if u.persona else '').lower()
        u.roles = [rol for rol, pistas in PISTAS if any(p in puesto for p in pistas)] or ['colaborador']
        u.save(update_fields=['roles'])


class Migration(migrations.Migration):
    dependencies = [('accounts', '0004_cuenta_google_agencia'), ('equipo', '0001_initial')]

    operations = [
        migrations.AddField(model_name='user', name='roles', field=models.JSONField(blank=True, default=list)),
        migrations.RunPython(roles_desde_puesto, migrations.RunPython.noop),
    ]
