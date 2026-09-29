from django.conf import settings
from django.db import models


class EventoUnico(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='cal_eventos')
    nombre = models.CharField(max_length=120)
    inicio = models.DateTimeField()
    fin = models.DateTimeField(null=True, blank=True)
    descripcion = models.TextField(blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')
    cliente = models.ForeignKey('clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='eventos')
    google_event_id = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['inicio']
        indexes = [models.Index(fields=['inicio'], name='evento_inicio_idx')]
