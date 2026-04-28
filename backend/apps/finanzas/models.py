from django.conf import settings
from django.db import models


class Transaccion(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='transacciones')
    fecha = models.DateField()
    descripcion = models.CharField(max_length=200)
    categoria = models.CharField(max_length=40)
    tipo = models.CharField(max_length=10, choices=[('ingreso', 'ingreso'), ('egreso', 'egreso')])
    monto = models.DecimalField(max_digits=14, decimal_places=2)
    notas = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha', '-creado']


class AdjuntoTransaccion(models.Model):
    transaccion = models.ForeignKey(Transaccion, on_delete=models.CASCADE, related_name='adjuntos')
    archivo = models.FileField(upload_to='adjuntos/%Y/%m/')
    nombre_original = models.CharField(max_length=255)
    creado = models.DateTimeField(auto_now_add=True)
