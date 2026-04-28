from rest_framework import serializers

from .models import AnalisisStats, ImagenAnalisis


class ImagenAnalisisSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImagenAnalisis
        fields = ('id', 'grupo', 'archivo')
        read_only_fields = ('id', 'archivo')


class AnalisisStatsSerializer(serializers.ModelSerializer):
    imagenes = ImagenAnalisisSerializer(many=True, read_only=True)

    class Meta:
        model = AnalisisStats
        fields = ('id', 'plataforma', 'metricas', 'interpretacion', 'creado', 'imagenes')
        read_only_fields = ('id', 'metricas', 'interpretacion', 'creado', 'imagenes')
