from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers

from .models import AdjuntoTransaccion, Categoria, Transaccion


class CategoriaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Categoria
        fields = ('id', 'nombre', 'tipo', 'color', 'activa', 'orden')


class AdjuntoTransaccionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AdjuntoTransaccion
        fields = ('id', 'nombre_original', 'tipo_contenido', 'creado')
        read_only_fields = fields


class TransaccionSerializer(serializers.ModelSerializer):
    adjuntos = AdjuntoTransaccionSerializer(many=True, read_only=True)
    categoria_nombre = serializers.CharField(source='categoria.nombre', read_only=True)
    categoria_color = serializers.CharField(source='categoria.color', read_only=True)
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)
    persona_nombre = serializers.CharField(source='persona.nombre', read_only=True, default=None)
    origen = serializers.SerializerMethodField()

    class Meta:
        model = Transaccion
        fields = (
            'id', 'fecha', 'descripcion', 'categoria', 'categoria_nombre', 'categoria_color', 'tipo', 'monto',
            'cliente', 'cliente_nombre', 'persona', 'persona_nombre', 'medio_pago', 'comprobante', 'notas',
            'adjuntos', 'origen', 'creado',
        )
        read_only_fields = ('id', 'creado', 'adjuntos')

    def get_origen(self, obj):
        for attr, tipo in (('cobro', 'cobro'), ('liquidacion', 'liquidacion'), ('pago_servicio', 'suscripcion')):
            try:
                rel = getattr(obj, attr)
            except ObjectDoesNotExist:
                rel = None
            if rel is not None:
                return {'tipo': tipo, 'id': rel.id}
        return None

    def validate(self, attrs):
        categoria = attrs.get('categoria') or getattr(self.instance, 'categoria', None)
        tipo = attrs.get('tipo') or getattr(self.instance, 'tipo', None)
        if categoria and tipo and categoria.tipo != tipo:
            raise serializers.ValidationError({'categoria': f'La categoría «{categoria.nombre}» no es de tipo {tipo}.'})
        if self.instance is not None and self.get_origen(self.instance):
            cambios = {k for k in ('monto', 'tipo') if k in attrs and attrs[k] != getattr(self.instance, k)}
            if cambios:
                raise serializers.ValidationError(
                    {'detail': 'Este movimiento se generó desde un cobro, liquidación o suscripción; editá el monto desde ahí.'}
                )
        return attrs
