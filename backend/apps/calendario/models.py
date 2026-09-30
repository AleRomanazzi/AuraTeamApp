from django.conf import settings
from django.db import models

ETIQUETAS = [
    ('ceos', 'AuraTeam CEOs'),
    ('coberturas', 'Coberturas'),
    ('operaciones', 'Operaciones'),
    ('reuniones', 'Reuniones & Briefing'),
]
# Solo las ven los administradores (socios), en el panel y en Google.
ETIQUETAS_PRIVADAS = ('ceos',)


class EventoUnico(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='cal_eventos')
    nombre = models.CharField(max_length=120)
    inicio = models.DateTimeField()
    fin = models.DateTimeField(null=True, blank=True)
    descripcion = models.TextField(blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')
    cliente = models.ForeignKey('clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='eventos')
    etiqueta = models.CharField(max_length=12, choices=ETIQUETAS, default='operaciones')
    google_event_id = models.CharField(max_length=255, blank=True)
    # Vacío con google_event_id cargado = calendario principal de la cuenta (que es AuraTeam CEOs).
    google_calendar_id = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['inicio']
        indexes = [models.Index(fields=['inicio'], name='evento_inicio_idx')]


class CalendarioGoogle(models.Model):
    """Calendario de la cuenta de Google de la agencia que corresponde a cada etiqueta."""

    etiqueta = models.CharField(max_length=12, choices=ETIQUETAS, unique=True)
    calendar_id = models.CharField(max_length=255)
    nombre = models.CharField(max_length=200, blank=True)
    sync_token = models.CharField(max_length=500, blank=True)


class EstadoCalendarioGoogle(models.Model):
    """Fila única con el estado de la sincronización con Google Calendar."""

    ultima_sync = models.DateTimeField(null=True, blank=True)
    ultima_sync_completa = models.DateTimeField(null=True, blank=True)
    ultimo_error = models.TextField(blank=True)
    ultimo_error_en = models.DateTimeField(null=True, blank=True)

    @classmethod
    def get(cls):
        return cls.objects.get_or_create(pk=1)[0]
