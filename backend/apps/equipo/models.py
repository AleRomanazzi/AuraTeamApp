from django.conf import settings
from django.db import models


class Persona(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='personas')
    nombre = models.CharField(max_length=120)
    rol = models.CharField(max_length=120, blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')
    contactos = models.JSONField(default=list)
    notas = models.TextField(blank=True)

    class Meta:
        ordering = ['nombre']


class Tarea(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='tareas')
    titulo = models.CharField(max_length=200)
    descripcion = models.TextField(blank=True)

    class Meta:
        ordering = ['titulo']


class AsignacionTarea(models.Model):
    persona = models.ForeignKey(Persona, on_delete=models.CASCADE, related_name='asignaciones')
    tarea = models.ForeignKey(Tarea, on_delete=models.CASCADE, related_name='asignaciones')
    estado = models.CharField(max_length=20, default='pendiente')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['persona', 'tarea'], name='unique_asignacion_persona_tarea'),
        ]
