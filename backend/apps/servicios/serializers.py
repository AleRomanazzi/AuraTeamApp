from decimal import Decimal, InvalidOperation

from rest_framework import serializers

from apps.core.utils import equivalente_mensual, mes_actual, money

from apps.equipo.models import Persona

from .models import Servicio


class ServicioSerializer(serializers.ModelSerializer):
    categoria_nombre = serializers.CharField(source='categoria.nombre', read_only=True, default=None)
    monto_agencia = serializers.DecimalField(max_digits=14, decimal_places=2, read_only=True)
    equivalente_mensual = serializers.SerializerMethodField()
    pagado_mes = serializers.SerializerMethodField()
    pagador_nombre = serializers.CharField(source='pagador.nombre', read_only=True, default=None)

    class Meta:
        model = Servicio
        fields = (
            'id', 'nombre', 'proveedor', 'monto_total', 'periodicidad', 'dia_vencimiento', 'metodo', 'detalle',
            'mi_parte', 'monto_agencia', 'equivalente_mensual', 'fecha_pago', 'categoria', 'categoria_nombre',
            'generar_egreso', 'activo', 'pagado_mes', 'pagador', 'pagador_nombre', 'dias_aviso', 'creado',
        )
        read_only_fields = ('id', 'creado')

    def get_equivalente_mensual(self, obj):
        return str(money(equivalente_mensual(obj.monto_agencia, obj.periodicidad)))

    def get_pagado_mes(self, obj):
        periodo = self.context.get('periodo') or mes_actual()
        return any(p.periodo == periodo for p in obj.pagos.all())

    def validate_detalle(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Debe ser una lista.')
        limpio = []
        for i, item in enumerate(value):
            if not isinstance(item, dict) or not str(item.get('nombre', '')).strip():
                raise serializers.ValidationError(f'Fila {i + 1}: falta el nombre.')
            try:
                monto = money(item.get('monto', 0))
            except (InvalidOperation, TypeError, ValueError):
                raise serializers.ValidationError(f'Fila {i + 1}: monto inválido.')
            if monto < 0:
                raise serializers.ValidationError(f'Fila {i + 1}: el monto no puede ser negativo.')
            fila = {'nombre': str(item['nombre']).strip()[:80], 'monto': str(monto)}
            if item.get('porcentaje') not in (None, ''):
                fila['porcentaje'] = str(item['porcentaje'])
            if item.get('persona') not in (None, ''):
                try:
                    persona = Persona.objects.get(pk=int(item['persona']))
                except (Persona.DoesNotExist, TypeError, ValueError):
                    raise serializers.ValidationError(f'Fila {i + 1}: persona inválida.')
                fila['persona'] = persona.pk
            limpio.append(fila)
        return limpio

    def validate(self, attrs):
        total = attrs.get('monto_total', getattr(self.instance, 'monto_total', None)) or Decimal('0')
        mi_parte = attrs.get('mi_parte', getattr(self.instance, 'mi_parte', Decimal('0'))) or Decimal('0')
        metodo = attrs.get('metodo', getattr(self.instance, 'metodo', 'sin_division'))
        detalle = attrs.get('detalle', getattr(self.instance, 'detalle', []))
        if mi_parte < 0 or mi_parte > total:
            raise serializers.ValidationError({'mi_parte': 'La parte de la agencia debe estar entre 0 y el total.'})
        if metodo != 'sin_division' and detalle:
            suma = sum((Decimal(str(d.get('monto', 0))) for d in detalle), Decimal('0'))
            if abs(suma - total) > Decimal('1'):
                raise serializers.ValidationError({'detalle': f'La suma del reparto ({suma}) no coincide con el total ({total}).'})
        categoria = attrs.get('categoria')
        if categoria and categoria.tipo != 'egreso':
            raise serializers.ValidationError({'categoria': 'Usá una categoría de egreso.'})
        return attrs
