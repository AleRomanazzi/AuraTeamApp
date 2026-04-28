from django.contrib import admin

from .models import AdjuntoTransaccion, Transaccion


class AdjuntoInline(admin.TabularInline):
    model = AdjuntoTransaccion
    extra = 0


@admin.register(Transaccion)
class TransaccionAdmin(admin.ModelAdmin):
    list_display = ('fecha', 'descripcion', 'tipo', 'monto', 'user')
    list_filter = ('tipo', 'categoria')
    inlines = [AdjuntoInline]
