from django.conf import settings
from django.db import models


class AnalisisStats(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='analisis')
    plataforma = models.CharField(max_length=40, blank=True)
    metricas = models.JSONField(default=list)
    interpretacion = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado']


class ImagenAnalisis(models.Model):
    analisis = models.ForeignKey(AnalisisStats, on_delete=models.CASCADE, related_name='imagenes')
    grupo = models.CharField(max_length=10)
    archivo = models.ImageField(upload_to='stats/%Y/%m/')
