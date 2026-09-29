from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

PERIODICIDAD_SERVICIO = [
    ('mensual', 'Mensual'),
    ('bimestral', 'Bimestral'),
    ('trimestral', 'Trimestral'),
    ('semestral', 'Semestral'),
    ('anual', 'Anual'),
]

METODO_DIVISION = [
    ('sin_division', 'Sin división'),
    ('partes-iguales', 'Partes iguales'),
    ('porcentaje', 'Por porcentaje'),
    ('personalizado', 'Monto personalizado'),
]


class Servicio(models.Model):
    """Suscripción o herramienta que paga la agencia (con reparto opcional entre personas)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='servicios')
    nombre = models.CharField(max_length=120)
    proveedor = models.CharField(max_length=120, blank=True)
    monto_total = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    periodicidad = models.CharField(max_length=12, choices=PERIODICIDAD_SERVICIO, default='mensual')
    dia_vencimiento = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(31)])
    metodo = models.CharField(max_length=24, choices=METODO_DIVISION, default='sin_division')
    detalle = models.JSONField(default=list, blank=True)
    mi_parte = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))
    fecha_pago = models.DateField(null=True, blank=True)
    categoria = models.ForeignKey('finanzas.Categoria', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    generar_egreso = models.BooleanField(default=True)
    activo = models.BooleanField(default=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['nombre']

    def __str__(self):
        return self.nombre

    @property
    def monto_agencia(self) -> Decimal:
        return self.mi_parte if self.mi_parte and self.mi_parte > 0 else self.monto_total


class PagoServicio(models.Model):
    servicio = models.ForeignKey(Servicio, on_delete=models.CASCADE, related_name='pagos')
    periodo = models.CharField(max_length=7)
    transaccion = models.OneToOneField('finanzas.Transaccion', on_delete=models.CASCADE, related_name='pago_servicio')
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['servicio', 'periodo'], name='unique_pago_servicio_periodo'),
        ]
