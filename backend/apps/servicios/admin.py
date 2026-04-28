from django.contrib import admin

from .models import Servicio


@admin.register(Servicio)
class ServicioAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'monto_total', 'mi_parte', 'fecha_pago', 'user')
