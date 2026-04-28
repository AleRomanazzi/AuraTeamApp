from rest_framework import serializers

from .models import ClienteMensual, EventoUnico


class ClienteMensualSerializer(serializers.ModelSerializer):
    titulo = serializers.CharField(max_length=120, source='nombre')

    class Meta:
        model = ClienteMensual
        fields = ('id', 'titulo', 'dia_mes', 'hora', 'descripcion', 'color', 'monto')


class EventoUnicoSerializer(serializers.ModelSerializer):
    titulo = serializers.CharField(max_length=120, source='nombre')

    class Meta:
        model = EventoUnico
        fields = ('id', 'titulo', 'inicio', 'fin', 'descripcion', 'color')
