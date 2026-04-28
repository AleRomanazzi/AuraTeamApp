from django.conf import settings
from django.db import models


class Servicio(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='servicios')
    nombre = models.CharField(max_length=120)
    monto_total = models.DecimalField(max_digits=14, decimal_places=2)
    metodo = models.CharField(max_length=24)
    detalle = models.JSONField(default=list)
    mi_parte = models.DecimalField(max_digits=14, decimal_places=2)
    fecha_pago = models.DateField(null=True, blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado']
