from django.contrib import admin

from .models import AjustePrecio, Cliente, Cobro, Contrato


class ContratoInline(admin.TabularInline):
    model = Contrato
    extra = 0


@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'estado', 'rubro', 'fecha_alta')
    list_filter = ('estado',)
    search_fields = ('nombre', 'razon_social', 'cuit')
    inlines = [ContratoInline]


@admin.register(Contrato)
class ContratoAdmin(admin.ModelAdmin):
    list_display = ('cliente', 'concepto', 'monto', 'periodicidad', 'activo')


@admin.register(AjustePrecio)
class AjustePrecioAdmin(admin.ModelAdmin):
    list_display = ('contrato', 'fecha_desde', 'monto_anterior', 'monto_nuevo')


@admin.register(Cobro)
class CobroAdmin(admin.ModelAdmin):
    list_display = ('cliente', 'periodo', 'concepto', 'monto', 'monto_cobrado', 'estado', 'vencimiento')
    list_filter = ('estado', 'periodo')
