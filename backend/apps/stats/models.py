from django.conf import settings
from django.db import models

PLATAFORMAS = [
    ('instagram', 'Instagram'),
    ('tiktok', 'TikTok'),
    ('facebook', 'Facebook'),
    ('meta_ads', 'Meta Ads'),
    ('google_ads', 'Google Ads'),
    ('linkedin', 'LinkedIn'),
    ('youtube', 'YouTube'),
    ('otra', 'Otra'),
]

ESTADO_ANALISIS = [('procesando', 'Procesando'), ('listo', 'Listo'), ('error', 'Error')]


class AnalisisStats(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='analisis')
    cliente = models.ForeignKey('clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='analisis')
    plataforma = models.CharField(max_length=40, blank=True)
    periodo_desde = models.DateField(null=True, blank=True)
    periodo_hasta = models.DateField(null=True, blank=True)
    metricas = models.JSONField(default=list, blank=True)
    interpretacion = models.TextField(blank=True)
    notas = models.TextField(blank=True)
    estado = models.CharField(max_length=12, choices=ESTADO_ANALISIS, default='listo')
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creado']


class ImagenAnalisis(models.Model):
    analisis = models.ForeignKey(AnalisisStats, on_delete=models.CASCADE, related_name='imagenes')
    grupo = models.CharField(max_length=10)
    archivo = models.ImageField(upload_to='stats/%Y/%m/')
