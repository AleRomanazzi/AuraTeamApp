"""Corre los pasos del cron horario (lo mismo que POST /api/cron/). En el VPS lo dispara una tarea programada de Coolify."""

import json

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Recurrentes, tareas de servicios, avisos, resumen diario, emails a clientes, Notion y limpieza.'

    def handle(self, *args, **options):
        from apps.core.cron import ejecutar

        resumen = ejecutar()
        self.stdout.write(json.dumps(resumen, ensure_ascii=False, default=str))
        if resumen.get('errores'):
            self.stderr.write(self.style.WARNING(f"{len(resumen['errores'])} paso(s) con error"))
