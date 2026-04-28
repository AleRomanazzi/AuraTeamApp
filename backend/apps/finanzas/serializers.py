from rest_framework import serializers

from .models import AdjuntoTransaccion, Transaccion


class AdjuntoTransaccionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdjuntoTransaccion
        fields = ('id', 'archivo', 'nombre_original', 'creado')
        read_only_fields = ('id', 'creado')


class TransaccionSerializer(serializers.ModelSerializer):
    adjuntos = AdjuntoTransaccionSerializer(many=True, read_only=True)

    class Meta:
        model = Transaccion
        fields = ('id', 'fecha', 'descripcion', 'categoria', 'tipo', 'monto', 'notas', 'adjuntos', 'creado')
        read_only_fields = ('id', 'creado', 'adjuntos')
