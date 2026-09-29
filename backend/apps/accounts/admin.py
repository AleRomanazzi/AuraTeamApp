from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin


@admin.register(get_user_model())
class AuraUserAdmin(UserAdmin):
    list_display = ('username', 'email', 'rol', 'persona', 'is_active', 'is_superuser')
    list_filter = ('rol', 'is_active', 'is_superuser')
    fieldsets = UserAdmin.fieldsets + (('AuraTeam', {'fields': ('rol', 'persona', 'nombre_display', 'gmail_account')}),)
