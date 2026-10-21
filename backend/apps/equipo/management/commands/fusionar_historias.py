from django.core.management.base import BaseCommand, CommandError

from apps.equipo.fusion import aplicar, preparar


class Command(BaseCommand):
    help = (
        'Agrupa las historias abiertas de Cycles Ferreyra y Lennon en una tarea con subtareas Historia 1, 2 y 3. '
        'Sin --aplicar solo muestra lo que haría.'
    )

    def add_arguments(self, parser):
        parser.add_argument('--aplicar', action='store_true', help='Escribe los cambios. Sin esto, corre en seco.')

    def handle(self, *args, **options):
        plan = preparar()
        if plan['ambiguos']:
            for item in plan['ambiguos']:
                self.stdout.write(f'Ambiguo «{item["buscado"]}»: {", ".join(item["nombres"])}.')
            raise CommandError('Hay más de un cliente posible. No se cambió nada.')
        if plan['faltan']:
            self.stdout.write('No encontré: ' + ', '.join(plan['faltan']) + '.')
        if not plan['clientes'] and not plan['grupos']:
            self.stdout.write('No hay plantillas de historias para agrupar.')
            return
        for nombre in plan['clientes']:
            self.stdout.write(f'Cliente: {nombre}')
        if not plan['grupos']:
            self.stdout.write('No hay días abiertos para fusionar. Las plantillas igual pasan a generar subtareas.')
        for grupo in plan['grupos']:
            fecha = grupo['fecha'].isoformat() if grupo['fecha'] else 'sin fecha'
            bajas = ', '.join(t.titulo for t in grupo['borrar']) or 'ninguna'
            checks = ', '.join(f'{titulo}{" ✓" if hecha else ""}' for titulo, hecha in grupo['subtareas'])
            self.stdout.write(f'{fecha}: queda «{grupo["plantilla"].titulo}» ({checks}). Se borran: {bajas}.')
        if not options['aplicar']:
            self.stdout.write('En seco. Pasá --aplicar para escribir.')
            return
        n = aplicar(plan)
        self.stdout.write(self.style.SUCCESS(f'Se fusionaron {n} día(s).'))
