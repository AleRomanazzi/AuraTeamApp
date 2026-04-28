from django.contrib import admin

from .models import AnalisisStats, ImagenAnalisis


class ImagenInline(admin.TabularInline):
    model = ImagenAnalisis
    extra = 0


@admin.register(AnalisisStats)
class AnalisisStatsAdmin(admin.ModelAdmin):
    list_display = ('plataforma', 'creado', 'user')
    inlines = [ImagenInline]
