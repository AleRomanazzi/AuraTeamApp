from django.contrib.auth.models import AbstractUser
from django.db import models

ROL_CHOICES = [('admin', 'Administrador'), ('equipo', 'Equipo')]


class User(AbstractUser):
    moneda = models.CharField(max_length=4, default="$")
    nombre_display = models.CharField(max_length=80, default="Yo")
    google_api_key = models.TextField(blank=True)
    google_client_id = models.TextField(blank=True)
    gmail_account = models.EmailField(blank=True)
    google_connected = models.BooleanField(default=False)
    rol = models.CharField(max_length=10, choices=ROL_CHOICES, default='equipo')
    persona = models.OneToOneField(
        'equipo.Persona', null=True, blank=True, on_delete=models.SET_NULL, related_name='usuario'
    )

    @property
    def es_admin(self) -> bool:
        return self.is_superuser or self.rol == 'admin'
