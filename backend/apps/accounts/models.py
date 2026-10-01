from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models

ROL_CHOICES = [('admin', 'Administrador'), ('equipo', 'Equipo')]

ROLES_EQUIPO = [
    ('cm', 'Community manager'),
    ('editor', 'Editor de video'),
    ('disenio', 'Diseño'),
    ('foto', 'Fotografía / Filmmaker'),
    ('colaborador', 'Colaborador'),
]

# Secciones extra que habilita cada rol, además de lo común a todo el equipo
# (mi panel, tareas, calendario, sus pagos y su cuenta).
PERMISOS_POR_ROL = {
    'cm': {'clientes', 'estadisticas', 'plan_tareas'},
}


class User(AbstractUser):
    moneda = models.CharField(max_length=4, default="$")
    nombre_display = models.CharField(max_length=80, default="Yo")
    rol = models.CharField(max_length=10, choices=ROL_CHOICES, default='equipo')
    roles = models.JSONField(default=list, blank=True)
    persona = models.OneToOneField(
        'equipo.Persona', null=True, blank=True, on_delete=models.SET_NULL, related_name='usuario'
    )

    @property
    def es_admin(self) -> bool:
        return self.is_superuser or self.rol == 'admin'

    @property
    def permisos(self) -> set[str]:
        return set().union(*(PERMISOS_POR_ROL.get(r, set()) for r in self.roles or []))


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
