from django.db import models


class EstadoNotion(models.Model):
    """Fila única con el estado de la sincronización con Notion."""

    webhook_token = models.CharField(max_length=200, blank=True)
    ultima_sync = models.DateTimeField(null=True, blank=True)
    ultima_sync_completa = models.DateTimeField(null=True, blank=True)
    ultimo_error = models.TextField(blank=True)
    ultimo_error_en = models.DateTimeField(null=True, blank=True)

    @classmethod
    def get(cls):
        return cls.objects.get_or_create(pk=1)[0]
