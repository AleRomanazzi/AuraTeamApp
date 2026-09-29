from django.contrib import admin

from .models import AdjuntoTransaccion, Categoria, Transaccion


class AdjuntoInline(admin.TabularInline):
    model = AdjuntoTransaccion
    extra = 0


@admin.register(Categoria)
class CategoriaAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'tipo', 'activa', 'orden')
    list_filter = ('tipo', 'activa')


@admin.register(Transaccion)
class TransaccionAdmin(admin.ModelAdmin):
    list_display = ('fecha', 'descripcion', 'tipo', 'categoria', 'monto', 'cliente')
    list_filter = ('tipo', 'categoria')
    inlines = [AdjuntoInline]
