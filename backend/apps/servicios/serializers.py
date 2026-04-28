from rest_framework import serializers

from .models import Servicio


class ServicioSerializer(serializers.ModelSerializer):
    class Meta:
        model = Servicio
        fields = ('id', 'nombre', 'monto_total', 'metodo', 'detalle', 'mi_parte', 'fecha_pago', 'creado')
        read_only_fields = ('id', 'creado')
