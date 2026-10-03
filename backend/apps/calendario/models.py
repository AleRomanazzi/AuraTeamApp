from django.conf import settings
from django.db import models

# Etiquetas base. Además, cada calendario nuevo de la cuenta de Google de la agencia se suma como etiqueta
# (fila de CalendarioGoogle); la lista completa la arma `etiquetas.todas()`.
ETIQUETAS = [
    ('ceos', 'AuraTeam CEOs'),
    ('coberturas', 'Coberturas'),
    ('historias', 'Historias'),
    ('posteos', 'Posteos'),
    ('edicion', 'Edición'),
    ('reuniones', 'Reuniones & Briefing'),
]
# Siempre privadas (solo las ven los administradores); las detectadas se marcan con CalendarioGoogle.privada.
ETIQUETAS_PRIVADAS = ('ceos',)
LARGO_ETIQUETA = 40


class EventoUnico(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='cal_eventos')
    nombre = models.CharField(max_length=120)
    inicio = models.DateTimeField()
    fin = models.DateTimeField(null=True, blank=True)
    descripcion = models.TextField(blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')
    cliente = models.ForeignKey('clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='eventos')
    etiqueta = models.CharField(max_length=LARGO_ETIQUETA, default='historias')
    google_event_id = models.CharField(max_length=255, blank=True)
    # Vacío con google_event_id cargado = calendario principal de la cuenta (que es AuraTeam CEOs).
    google_calendar_id = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ['inicio']
        indexes = [models.Index(fields=['inicio'], name='evento_inicio_idx')]


class CalendarioGoogle(models.Model):
    """Calendario de la cuenta de Google de la agencia que corresponde a cada etiqueta."""

    etiqueta = models.CharField(max_length=LARGO_ETIQUETA, unique=True)
    calendar_id = models.CharField(max_length=255)
    nombre = models.CharField(max_length=200, blank=True)
    sync_token = models.CharField(max_length=500, blank=True)
    privada = models.BooleanField(default=False)
    # Oculta: no se ofrece en los formularios ni se sincroniza.
    oculta = models.BooleanField(default=False)


class EstadoCalendarioGoogle(models.Model):
    """Fila única con el estado de la sincronización con Google Calendar."""

    ultima_sync = models.DateTimeField(null=True, blank=True)
    ultima_sync_completa = models.DateTimeField(null=True, blank=True)
    ultimo_error = models.TextField(blank=True)
    ultimo_error_en = models.DateTimeField(null=True, blank=True)

    @classmethod
    def get(cls):
        return cls.objects.get_or_create(pk=1)[0]
