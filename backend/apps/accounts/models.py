from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models

ROL_CHOICES = [('admin', 'Administrador'), ('equipo', 'Equipo')]


class User(AbstractUser):
    moneda = models.CharField(max_length=4, default="$")
    nombre_display = models.CharField(max_length=80, default="Yo")
    rol = models.CharField(max_length=10, choices=ROL_CHOICES, default='equipo')
    persona = models.OneToOneField(
        'equipo.Persona', null=True, blank=True, on_delete=models.SET_NULL, related_name='usuario'
    )

    @property
    def es_admin(self) -> bool:
        return self.is_superuser or self.rol == 'admin'


class CuentaGoogle(models.Model):
    """Cuenta de Google de la agencia (una sola fila). El refresh token se guarda cifrado."""

    email = models.EmailField(blank=True)
    refresh_token = models.TextField()
    scopes = models.TextField(blank=True)
    conectada_en = models.DateTimeField(auto_now=True)
    conectada_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )

    class Meta:
        verbose_name = 'Cuenta de Google'
        verbose_name_plural = 'Cuenta de Google'

    def __str__(self):
        return self.email or 'Cuenta de Google'
