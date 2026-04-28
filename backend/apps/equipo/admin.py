from django.contrib import admin

from .models import AsignacionTarea, Persona, Tarea


@admin.register(Persona)
class PersonaAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'rol', 'user')


@admin.register(Tarea)
class TareaAdmin(admin.ModelAdmin):
    list_display = ('titulo', 'user')


@admin.register(AsignacionTarea)
class AsignacionTareaAdmin(admin.ModelAdmin):
    list_display = ('persona', 'tarea', 'estado')
