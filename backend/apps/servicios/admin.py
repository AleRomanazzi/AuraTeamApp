from django.contrib import admin

from .models import PagoServicio, Servicio


@admin.register(Servicio)
class ServicioAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'monto_total', 'mi_parte', 'periodicidad', 'activo')


@admin.register(PagoServicio)
class PagoServicioAdmin(admin.ModelAdmin):
    list_display = ('servicio', 'periodo', 'transaccion')
