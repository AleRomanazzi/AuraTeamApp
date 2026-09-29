from django.contrib import admin

from .models import EventoUnico


@admin.register(EventoUnico)
class EventoUnicoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'inicio', 'cliente', 'user')
