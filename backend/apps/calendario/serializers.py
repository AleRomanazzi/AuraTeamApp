from rest_framework import serializers

from .models import EventoUnico


class EventoUnicoSerializer(serializers.ModelSerializer):
    titulo = serializers.CharField(max_length=120, source='nombre')
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)

    class Meta:
        model = EventoUnico
        fields = ('id', 'titulo', 'inicio', 'fin', 'descripcion', 'color', 'cliente', 'cliente_nombre', 'google_event_id')
        read_only_fields = ('id',)

    def validate_titulo(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('El título es obligatorio.')
        return value

    def validate(self, attrs):
        inicio = attrs.get('inicio', getattr(self.instance, 'inicio', None))
        fin = attrs.get('fin', getattr(self.instance, 'fin', None))
        if inicio and fin and fin < inicio:
            raise serializers.ValidationError({'fin': 'El fin no puede ser anterior al inicio.'})
        return attrs
