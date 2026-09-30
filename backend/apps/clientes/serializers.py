from decimal import Decimal

from rest_framework import serializers

from apps.core.utils import MES_RE, equivalente_mensual, money, today

from .models import AjustePrecio, Cliente, Cobro, Contrato


def fee_mensual_de(cliente) -> Decimal:
    hoy = today()
    total = Decimal('0')
    for c in cliente.contratos.all():
        if not c.activo or c.periodicidad == 'unico' or (c.fecha_fin and c.fecha_fin < hoy):
            continue
        total += equivalente_mensual(c.monto_para(hoy, list(c.ajustes.all())), c.periodicidad)
    return money(total)


class ClienteBasicoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = ('id', 'nombre', 'color', 'estado')
        read_only_fields = fields


class ClienteFichaSerializer(serializers.ModelSerializer):
    """Ficha para roles con acceso a Clientes: contacto y equipo, sin datos de facturación."""

    asignados = serializers.SerializerMethodField()

    class Meta:
        model = Cliente
        fields = ('id', 'nombre', 'rubro', 'contacto', 'email', 'whatsapp', 'estado', 'fecha_alta', 'color', 'notas', 'asignados')
        read_only_fields = fields

    def get_asignados(self, obj):
        return [
            {'id': a.id, 'persona': a.persona_id, 'persona_nombre': a.persona.nombre, 'rol': a.rol}
            for a in obj.asignaciones.all()
            if a.activo
        ]


class ClienteSerializer(serializers.ModelSerializer):
    deuda = serializers.SerializerMethodField()
    deuda_vencida = serializers.SerializerMethodField()
    fee_mensual = serializers.SerializerMethodField()
    asignados = serializers.SerializerMethodField()

    class Meta:
        model = Cliente
        fields = (
            'id', 'nombre', 'razon_social', 'cuit', 'rubro', 'contacto', 'email', 'whatsapp', 'estado',
            'fecha_alta', 'color', 'notas', 'creado', 'deuda', 'deuda_vencida', 'fee_mensual', 'asignados',
            'google_color', 'palabras_clave',
        )
        read_only_fields = ('id', 'creado')

    def get_deuda(self, obj):
        return str(money(getattr(obj, 'deuda_total', None) or 0))

    def get_deuda_vencida(self, obj):
        return str(money(getattr(obj, 'deuda_vencida_total', None) or 0))

    def get_fee_mensual(self, obj):
        return str(fee_mensual_de(obj))

    def get_asignados(self, obj):
        return [
            {'id': a.id, 'persona': a.persona_id, 'persona_nombre': a.persona.nombre, 'rol': a.rol}
            for a in obj.asignaciones.all()
            if a.activo
        ]

    def validate_nombre(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('El nombre es obligatorio.')
        return value


class AjustePrecioSerializer(serializers.ModelSerializer):
    class Meta:
        model = AjustePrecio
        fields = ('id', 'fecha_desde', 'monto_anterior', 'monto_nuevo', 'porcentaje', 'nota', 'creado')
        read_only_fields = fields


class ContratoSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True)
    categoria_nombre = serializers.CharField(source='categoria.nombre', read_only=True, default=None)
    responsable_nombre = serializers.CharField(source='responsable.nombre', read_only=True, default=None)
    monto_actual = serializers.SerializerMethodField()
    equivalente_mensual = serializers.SerializerMethodField()
    ajustes = AjustePrecioSerializer(many=True, read_only=True)

    class Meta:
        model = Contrato
        fields = (
            'id', 'cliente', 'cliente_nombre', 'concepto', 'categoria', 'categoria_nombre', 'monto', 'monto_actual',
            'equivalente_mensual', 'periodicidad', 'dia_vencimiento', 'fecha_inicio', 'fecha_fin', 'activo',
            'responsable', 'responsable_nombre', 'notas', 'ajustes', 'creado',
        )
        read_only_fields = ('id', 'creado')

    def get_monto_actual(self, obj):
        return str(money(obj.monto_para(today(), list(obj.ajustes.all()))))

    def get_equivalente_mensual(self, obj):
        if obj.periodicidad == 'unico':
            return '0.00'
        return str(money(equivalente_mensual(obj.monto_para(today(), list(obj.ajustes.all())), obj.periodicidad)))

    def validate(self, attrs):
        inicio = attrs.get('fecha_inicio', getattr(self.instance, 'fecha_inicio', None))
        fin = attrs.get('fecha_fin', getattr(self.instance, 'fecha_fin', None))
        if inicio and fin and fin < inicio:
            raise serializers.ValidationError({'fecha_fin': 'La fecha de fin no puede ser anterior al inicio.'})
        categoria = attrs.get('categoria')
        if categoria and categoria.tipo != 'ingreso':
            raise serializers.ValidationError({'categoria': 'El contrato debe usar una categoría de ingreso.'})
        return attrs


class AjusteInputSerializer(serializers.Serializer):
    fecha_desde = serializers.DateField()
    monto_nuevo = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    porcentaje = serializers.DecimalField(max_digits=7, decimal_places=2, required=False, allow_null=True)
    nota = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    actualizar_pendientes = serializers.BooleanField(required=False, default=True)


class CobroSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True)
    cliente_color = serializers.CharField(source='cliente.color', read_only=True)
    cliente_whatsapp = serializers.CharField(source='cliente.whatsapp', read_only=True)
    cliente_email = serializers.CharField(source='cliente.email', read_only=True)
    contrato_concepto = serializers.CharField(source='contrato.concepto', read_only=True, default=None)
    saldo = serializers.SerializerMethodField()
    vencido = serializers.BooleanField(read_only=True)
    dias_vencido = serializers.SerializerMethodField()

    class Meta:
        model = Cobro
        fields = (
            'id', 'cliente', 'cliente_nombre', 'cliente_color', 'cliente_whatsapp', 'cliente_email', 'contrato',
            'contrato_concepto', 'periodo', 'concepto', 'monto', 'vencimiento', 'monto_cobrado', 'saldo',
            'fecha_pago', 'medio_pago', 'comprobante', 'estado', 'vencido', 'dias_vencido', 'transaccion',
            'notas', 'creado',
        )
        read_only_fields = (
            'id', 'monto_cobrado', 'fecha_pago', 'medio_pago', 'comprobante', 'estado', 'transaccion', 'creado',
        )

    def get_saldo(self, obj):
        return str(money(obj.saldo))

    def get_dias_vencido(self, obj):
        return (today() - obj.vencimiento).days if obj.vencido else 0

    def validate_periodo(self, value):
        if not MES_RE.match(value or ''):
            raise serializers.ValidationError('Formato inválido; se espera YYYY-MM.')
        return value

    def validate(self, attrs):
        contrato = attrs.get('contrato')
        cliente = attrs.get('cliente', getattr(self.instance, 'cliente', None))
        if contrato and cliente and contrato.cliente_id != cliente.id:
            raise serializers.ValidationError({'contrato': 'El contrato no pertenece a ese cliente.'})
        if self.instance is not None and 'monto' in attrs and attrs['monto'] < self.instance.monto_cobrado:
            raise serializers.ValidationError({'monto': 'No puede ser menor a lo ya cobrado.'})
        return attrs


class RegistrarPagoSerializer(serializers.Serializer):
    monto = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    fecha = serializers.DateField(required=False, allow_null=True)
    medio_pago = serializers.ChoiceField(
        choices=[c[0] for c in Cobro._meta.get_field('medio_pago').choices], required=False, allow_blank=True, default=''
    )
    comprobante = serializers.CharField(max_length=80, required=False, allow_blank=True, default='')
    notas = serializers.CharField(required=False, allow_blank=True, default='')
