from django.conf import settings
from django.db import models

TIPOS = [
    ('tarea_asignada', 'Tarea asignada'),
    ('tarea_estado', 'Cambio de estado de una tarea'),
    ('tarea_hecha', 'Tarea terminada'),
    ('deadline_manana', 'Vence mañana'),
    ('deadline_hoy', 'Vence hoy'),
    ('tarea_vencida', 'Tarea vencida'),
    ('servicio', 'Pago de servicio'),
    ('aporte', 'Aporte a un servicio'),
    ('cliente', 'Clientes'),
    ('sistema', 'Sistema'),
]


class Notificacion(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notificaciones')
    tipo = models.CharField(max_length=20, choices=TIPOS)
    titulo = models.CharField(max_length=200)
    cuerpo = models.TextField(blank=True)
    # Ruta del panel a la que lleva el click (p. ej. /tareas?tarea=12).
    url = models.CharField(max_length=200, blank=True)
    tarea = models.ForeignKey('equipo.Tarea', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    # Evita repetir el mismo aviso automático (p. ej. «vence hoy» de una tarea en un día).
    clave = models.CharField(max_length=160, blank=True)
    leida_en = models.DateTimeField(null=True, blank=True)
    email_enviado = models.BooleanField(default=False)
    creada = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-creada', '-id']
        constraints = [
            models.UniqueConstraint(fields=['usuario', 'clave'], condition=~models.Q(clave=''), name='notificacion_clave_unica'),
        ]
        indexes = [models.Index(fields=['usuario', 'leida_en'])]

    def __str__(self):
        return self.titulo


class EstadoCron(models.Model):
    """Fila única con el estado de las tareas programadas (cron externo)."""

    ultima_corrida = models.DateTimeField(null=True, blank=True)
    ultimo_resumen = models.DateField(null=True, blank=True)
    ultimo_reporte_clientes = models.CharField(max_length=7, blank=True)
    ultimo_error = models.TextField(blank=True)

    @classmethod
    def get(cls):
        return cls.objects.get_or_create(pk=1)[0]
