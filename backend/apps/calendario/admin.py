from django.contrib import admin

from .models import ClienteMensual, EventoUnico


@admin.register(ClienteMensual)
class ClienteMensualAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'dia_mes', 'user')


@admin.register(EventoUnico)
class EventoUnicoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'inicio', 'user')
