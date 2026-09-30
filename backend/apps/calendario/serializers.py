from rest_framework import serializers

from apps.core.permissions import es_admin

from .models import ETIQUETAS_PRIVADAS, EventoUnico


class EventoUnicoSerializer(serializers.ModelSerializer):
    titulo = serializers.CharField(max_length=120, source='nombre')
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)
    puede_editar = serializers.SerializerMethodField()

    class Meta:
        model = EventoUnico
        fields = (
            'id', 'titulo', 'inicio', 'fin', 'descripcion', 'color', 'cliente', 'cliente_nombre', 'etiqueta',
            'google_event_id', 'puede_editar',
        )
        read_only_fields = ('id', 'google_event_id')

    def get_puede_editar(self, obj):
        request = self.context.get('request')
        if request is None:
            return False
        return es_admin(request.user) or (obj.user_id is not None and obj.user_id == request.user.id)

    def validate_titulo(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('El título es obligatorio.')
        return value

    def validate_etiqueta(self, value):
        request = self.context.get('request')
        if value in ETIQUETAS_PRIVADAS and not (request and es_admin(request.user)):
            raise serializers.ValidationError('Esa etiqueta es solo para los socios.')
        return value

    def validate(self, attrs):
        inicio = attrs.get('inicio', getattr(self.instance, 'inicio', None))
        fin = attrs.get('fin', getattr(self.instance, 'fin', None))
        if inicio and fin and fin < inicio:
            raise serializers.ValidationError({'fin': 'El fin no puede ser anterior al inicio.'})
        return attrs
