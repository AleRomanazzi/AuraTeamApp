from django.conf import settings
from django.db import models


class ClienteMensual(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cal_clientes')
    nombre = models.CharField(max_length=120)
    dia_mes = models.PositiveSmallIntegerField()
    hora = models.TimeField(null=True, blank=True)
    descripcion = models.TextField(blank=True)
    color = models.CharField(max_length=12, default='#4fffb0')
    monto = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ['dia_mes', 'nombre']


class EventoUnico(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='cal_eventos')
    nombre = models.CharField(max_length=120)
    inicio = models.DateTimeField()
    fin = models.DateTimeField(null=True, blank=True)
    descripcion = models.TextField(blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')

    class Meta:
        ordering = ['inicio']
