from rest_framework import serializers

from .models import PLATAFORMAS, AnalisisStats, ImagenAnalisis


class ImagenAnalisisSerializer(serializers.ModelSerializer):
    class Meta:
        model = ImagenAnalisis
        fields = ('id', 'grupo')
        read_only_fields = fields


class AnalisisStatsSerializer(serializers.ModelSerializer):
    imagenes = ImagenAnalisisSerializer(many=True, read_only=True)
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True, default=None)
    plataforma_label = serializers.SerializerMethodField()

    class Meta:
        model = AnalisisStats
        fields = (
            'id', 'cliente', 'cliente_nombre', 'plataforma', 'plataforma_label', 'periodo_desde', 'periodo_hasta',
            'metricas', 'interpretacion', 'notas', 'estado', 'creado', 'imagenes',
        )
        read_only_fields = ('id', 'estado', 'creado', 'imagenes')

    def get_plataforma_label(self, obj):
        return dict(PLATAFORMAS).get(obj.plataforma, obj.plataforma)

    def validate_metricas(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Debe ser una lista.')
        limpio = []
        for m in value:
            if not isinstance(m, dict) or not str(m.get('nombre', '')).strip():
                raise serializers.ValidationError('Cada métrica necesita un nombre.')
            limpio.append(
                {
                    'nombre': str(m['nombre']).strip()[:80],
                    'antes': m.get('antes', ''),
                    'despues': m.get('despues', ''),
                    'variacion': str(m.get('variacion', ''))[:20],
                }
            )
        return limpio

    def validate(self, attrs):
        desde = attrs.get('periodo_desde', getattr(self.instance, 'periodo_desde', None))
        hasta = attrs.get('periodo_hasta', getattr(self.instance, 'periodo_hasta', None))
        if desde and hasta and hasta < desde:
            raise serializers.ValidationError({'periodo_hasta': 'El fin del período no puede ser anterior al inicio.'})
        return attrs
