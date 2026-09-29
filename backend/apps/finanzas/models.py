from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models

TIPO_CHOICES = [('ingreso', 'ingreso'), ('egreso', 'egreso')]

MEDIO_PAGO_CHOICES = [
    ('transferencia', 'Transferencia'),
    ('efectivo', 'Efectivo'),
    ('mercado_pago', 'Mercado Pago'),
    ('tarjeta', 'Tarjeta'),
    ('cheque', 'Cheque'),
    ('otro', 'Otro'),
]

CATEGORIA_FEE = 'Fee mensual'
CATEGORIA_HONORARIOS = 'Honorarios del equipo'
CATEGORIA_SOFTWARE = 'Software y suscripciones'


class Categoria(models.Model):
    nombre = models.CharField(max_length=60)
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES)
    color = models.CharField(max_length=12, default='#7c6fff')
    activa = models.BooleanField(default=True)
    orden = models.PositiveSmallIntegerField(default=100)

    class Meta:
        ordering = ['tipo', 'orden', 'nombre']
        constraints = [
            models.UniqueConstraint(fields=['nombre', 'tipo'], name='unique_categoria_nombre_tipo'),
        ]

    def __str__(self):
        return f'{self.nombre} ({self.tipo})'

    @classmethod
    def por_nombre(cls, nombre: str, tipo: str) -> 'Categoria':
        cat = cls.objects.filter(nombre=nombre, tipo=tipo).first()
        if cat:
            return cat
        fallback = cls.objects.filter(tipo=tipo, activa=True).first()
        if fallback:
            return fallback
        return cls.objects.create(nombre=nombre, tipo=tipo)


class Transaccion(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='transacciones'
    )
    fecha = models.DateField()
    descripcion = models.CharField(max_length=200)
    categoria = models.ForeignKey(Categoria, on_delete=models.PROTECT, related_name='transacciones')
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES)
    monto = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    cliente = models.ForeignKey(
        'clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='transacciones'
    )
    persona = models.ForeignKey(
        'equipo.Persona', null=True, blank=True, on_delete=models.SET_NULL, related_name='transacciones'
    )
    medio_pago = models.CharField(max_length=20, choices=MEDIO_PAGO_CHOICES, blank=True)
    comprobante = models.CharField(max_length=80, blank=True)
    notas = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha', '-creado']
        indexes = [
            models.Index(fields=['fecha', 'tipo'], name='tx_fecha_tipo_idx'),
            models.Index(fields=['cliente', 'fecha'], name='tx_cliente_fecha_idx'),
        ]

    def __str__(self):
        return f'{self.fecha} {self.tipo} {self.monto} {self.descripcion}'


class AdjuntoTransaccion(models.Model):
    transaccion = models.ForeignKey(Transaccion, on_delete=models.CASCADE, related_name='adjuntos')
    archivo = models.FileField(upload_to='adjuntos/%Y/%m/')
    nombre_original = models.CharField(max_length=255)
    tipo_contenido = models.CharField(max_length=80, blank=True)
    creado = models.DateTimeField(auto_now_add=True)
