from django.contrib import admin

from .models import AsignacionCliente, AsignacionTarea, Liquidacion, LiquidacionItem, Persona, Tarea


@admin.register(Persona)
class PersonaAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'rol', 'tipo_vinculo', 'activo')
    list_filter = ('tipo_vinculo', 'activo')


@admin.register(Tarea)
class TareaAdmin(admin.ModelAdmin):
    list_display = ('titulo', 'cliente', 'estado', 'prioridad', 'fecha_limite')
    list_filter = ('estado', 'prioridad')


@admin.register(AsignacionTarea)
class AsignacionTareaAdmin(admin.ModelAdmin):
    list_display = ('persona', 'tarea', 'estado')


@admin.register(AsignacionCliente)
class AsignacionClienteAdmin(admin.ModelAdmin):
    list_display = ('persona', 'cliente', 'rol', 'modalidad', 'valor', 'activo')


class LiquidacionItemInline(admin.TabularInline):
    model = LiquidacionItem
    extra = 0


@admin.register(Liquidacion)
class LiquidacionAdmin(admin.ModelAdmin):
    list_display = ('persona', 'periodo', 'concepto', 'total', 'estado')
    list_filter = ('estado', 'periodo')
    inlines = [LiquidacionItemInline]
