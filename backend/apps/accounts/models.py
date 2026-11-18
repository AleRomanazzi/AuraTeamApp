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

# Secciones extra que puede habilitar un rol, además de lo común a todo el equipo
# (mi panel, tareas, calendario, sus pagos y su cuenta). Qué rol tiene cuál se edita en Configuración → Permisos.
PERMISOS = [
    ('clientes', 'Fichas de clientes (sin montos)'),
    ('estadisticas', 'Estadísticas'),
    ('plan_tareas', 'Plan del mes de sus clientes'),
]
# Valores de fábrica (mientras nadie los cambie desde el panel).
PERMISOS_POR_ROL = {
    'cm': {'clientes', 'estadisticas', 'plan_tareas'},
}
CACHE_PERMISOS = 'permisos_por_rol'


def permisos_por_rol() -> dict[str, set[str]]:
    from django.core.cache import cache

    datos = cache.get(CACHE_PERMISOS)
    if datos is None:
        fila = ConfigPermisos.objects.filter(pk=1).first()
        datos = fila.por_rol if fila else {r: sorted(p) for r, p in PERMISOS_POR_ROL.items()}
        cache.set(CACHE_PERMISOS, datos, 300)
    return {r: set(p) for r, p in datos.items()}


class User(AbstractUser):
    moneda = models.CharField(max_length=4, default="$")
    nombre_display = models.CharField(max_length=80, default="Yo")
    rol = models.CharField(max_length=10, choices=ROL_CHOICES, default='equipo')
    roles = models.JSONField(default=list, blank=True)
    persona = models.OneToOneField(
        'equipo.Persona', null=True, blank=True, on_delete=models.SET_NULL, related_name='usuario'
    )
    notif_email = models.BooleanField(default=True)

    @property
    def es_admin(self) -> bool:
        return self.is_superuser or self.rol == 'admin'

    @property
    def permisos(self) -> set[str]:
        por_rol = permisos_por_rol()
        return set().union(*(por_rol.get(r, set()) for r in self.roles or []))


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


class ConfigPermisos(models.Model):
    """Fila única: permisos extra de cada rol del equipo ({rol: [permiso, …]})."""

    por_rol = models.JSONField(default=dict)

    def save(self, *args, **kwargs):
        from django.core.cache import cache

        self.pk = 1
        super().save(*args, **kwargs)
        cache.delete(CACHE_PERMISOS)
