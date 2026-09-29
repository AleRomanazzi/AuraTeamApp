from django.apps import AppConfig


class StatsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.stats'
    label = 'stats'

    def ready(self):
        from . import signals  # noqa: F401
