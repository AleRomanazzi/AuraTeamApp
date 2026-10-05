from rest_framework import serializers

from .models import Notificacion


class NotificacionSerializer(serializers.ModelSerializer):
    leida = serializers.SerializerMethodField()

    class Meta:
        model = Notificacion
        fields = ('id', 'tipo', 'titulo', 'cuerpo', 'url', 'tarea', 'leida', 'leida_en', 'creada')
        read_only_fields = fields

    def get_leida(self, obj):
        return obj.leida_en is not None
