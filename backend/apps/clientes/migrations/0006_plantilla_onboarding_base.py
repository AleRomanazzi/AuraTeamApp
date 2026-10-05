from django.db import migrations

PASOS = [
    ('Crear la carpeta de Drive del cliente', 'Con subcarpetas Brief, Material crudo, Ediciones, Diseños y Reportes.', 'admin', 0, 'reuniones', 'drive'),
    ('Pedir accesos a las cuentas', 'Instagram / Meta Business Suite, Facebook, TikTok y Google Business.', 'cm', 1, 'reuniones', ''),
    ('Brief de marca', 'Objetivos, público, tono, referencias, competencia y material de marca (logos, paleta, tipografías).', 'cm', 3, 'reuniones', ''),
    ('Reunión inicial con el cliente', 'Presentación del equipo, revisión del brief y acuerdo de canales y tiempos de aprobación.', 'admin', 3, 'reuniones', ''),
    ('Definir la grilla del primer mes', '', 'cm', 7, 'posteos', ''),
    ('Primer reporte de stats de base', 'Foto inicial de seguidores, alcance e interacción para comparar los meses siguientes.', 'cm', 7, 'reuniones', ''),
]


def cargar(apps, schema_editor):
    PasoOnboarding = apps.get_model('clientes', 'PasoOnboarding')
    if PasoOnboarding.objects.exists():
        return
    for orden, (titulo, descripcion, rol, dias, etiqueta, accion) in enumerate(PASOS):
        PasoOnboarding.objects.create(
            orden=orden, titulo=titulo, descripcion=descripcion, rol=rol, dias_desde_alta=dias, etiqueta=etiqueta, accion=accion
        )


class Migration(migrations.Migration):
    dependencies = [('clientes', '0005_pasoonboarding_cliente_drive_folder_id_and_more')]

    operations = [migrations.RunPython(cargar, migrations.RunPython.noop)]
