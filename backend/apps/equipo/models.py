from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q

from apps.finanzas.models import MEDIO_PAGO_CHOICES

TIPO_VINCULO = [('freelancer', 'Freelancer'), ('empleado', 'Empleado'), ('socio', 'Socio')]
ESTADO_TAREA = [
    ('pendiente', 'Por hacer'),
    ('en_curso', 'En progreso'),
    ('bloqueada', 'Bloqueada'),
    ('en_revision', 'En revisión'),
    ('hecha', 'Hecha'),
]
PRIORIDAD_TAREA = [('baja', 'Baja'), ('media', 'Media'), ('alta', 'Alta')]
MODALIDAD_ASIGNACION = [('fijo', 'Fijo mensual'), ('porcentaje', 'Porcentaje del fee'), ('por_pieza', 'Por pieza')]
ESTADO_LIQUIDACION = [
    ('pendiente', 'Pendiente'),
    ('aprobada', 'Aprobada'),
    ('pagada', 'Pagada'),
    ('anulada', 'Anulada'),
]
ORIGEN_LIQUIDACION = [('asignacion', 'Asignación a cliente'), ('base', 'Honorario base'), ('manual', 'Manual')]


class Persona(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='personas')
    nombre = models.CharField(max_length=120)
    rol = models.CharField(max_length=120, blank=True)
    color = models.CharField(max_length=12, default='#7c6fff')
    contactos = models.JSONField(default=list, blank=True)
    notas = models.TextField(blank=True)
    tipo_vinculo = models.CharField(max_length=12, choices=TIPO_VINCULO, default='freelancer')
    cuit = models.CharField(max_length=20, blank=True)
    alias_cbu = models.CharField(max_length=60, blank=True)
    activo = models.BooleanField(default=True)
    notion_user_id = models.CharField(max_length=36, blank=True)

    class Meta:
        ordering = ['nombre']

    def __str__(self):
        return self.nombre


class Tarea(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='tareas')
    titulo = models.CharField(max_length=200)
    descripcion = models.TextField(blank=True)
    cliente = models.ForeignKey('clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='tareas')
    estado = models.CharField(max_length=12, choices=ESTADO_TAREA, default='pendiente')
    prioridad = models.CharField(max_length=6, choices=PRIORIDAD_TAREA, default='media')
    fecha_limite = models.DateField(null=True, blank=True)
    links = models.JSONField(default=list, blank=True)
    completada_en = models.DateTimeField(null=True, blank=True)
    creado = models.DateTimeField(auto_now_add=True, null=True)
    notion_page_id = models.CharField(max_length=36, null=True, blank=True, unique=True)
    # Huella de los campos sincronizados la última vez que panel y Notion coincidieron: evita reaplicar ecos propios.
    notion_huella = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ['estado', 'fecha_limite', 'titulo']

    def __str__(self):
        return self.titulo


class AsignacionTarea(models.Model):
    persona = models.ForeignKey(Persona, on_delete=models.CASCADE, related_name='asignaciones')
    tarea = models.ForeignKey(Tarea, on_delete=models.CASCADE, related_name='asignaciones')
    estado = models.CharField(max_length=20, default='pendiente')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['persona', 'tarea'], name='unique_asignacion_persona_tarea'),
        ]


class AsignacionCliente(models.Model):
    persona = models.ForeignKey(Persona, on_delete=models.CASCADE, related_name='asignaciones_cliente')
    cliente = models.ForeignKey('clientes.Cliente', on_delete=models.CASCADE, related_name='asignaciones')
    rol = models.CharField(max_length=80, blank=True)
    modalidad = models.CharField(max_length=12, choices=MODALIDAD_ASIGNACION, default='fijo')
    valor = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'), validators=[MinValueValidator(Decimal('0'))])
    activo = models.BooleanField(default=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['cliente__nombre', 'persona__nombre']
        constraints = [
            models.UniqueConstraint(fields=['persona', 'cliente', 'rol'], name='unique_asignacion_cliente_rol'),
        ]

    def __str__(self):
        return f'{self.persona} → {self.cliente} ({self.rol})'


class Liquidacion(models.Model):
    persona = models.ForeignKey(Persona, on_delete=models.PROTECT, related_name='liquidaciones')
    periodo = models.CharField(max_length=7)
    concepto = models.CharField(max_length=200)
    cliente = models.ForeignKey('clientes.Cliente', null=True, blank=True, on_delete=models.SET_NULL, related_name='liquidaciones')
    asignacion = models.ForeignKey(AsignacionCliente, null=True, blank=True, on_delete=models.SET_NULL, related_name='liquidaciones')
    origen = models.CharField(max_length=12, choices=ORIGEN_LIQUIDACION, default='manual')
    monto_base = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))
    total = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))
    estado = models.CharField(max_length=10, choices=ESTADO_LIQUIDACION, default='pendiente')
    fecha_pago = models.DateField(null=True, blank=True)
    medio_pago = models.CharField(max_length=20, choices=MEDIO_PAGO_CHOICES, blank=True)
    comprobante = models.CharField(max_length=80, blank=True)
    transaccion = models.OneToOneField(
        'finanzas.Transaccion', null=True, blank=True, on_delete=models.SET_NULL, related_name='liquidacion'
    )
    notas = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-periodo', 'persona__nombre']
        constraints = [
            models.UniqueConstraint(
                fields=['asignacion', 'periodo'],
                condition=Q(asignacion__isnull=False),
                name='unique_liquidacion_asignacion_periodo',
            ),
            models.UniqueConstraint(
                fields=['persona', 'periodo'],
                condition=Q(origen='base'),
                name='unique_liquidacion_base_periodo',
            ),
        ]
        indexes = [models.Index(fields=['periodo', 'persona'], name='liq_periodo_persona_idx')]

    def __str__(self):
        return f'{self.persona} {self.periodo} {self.total}'

    def recalcular(self, save=True):
        extras = sum((i.total for i in self.items.all()), Decimal('0'))
        self.total = (self.monto_base or Decimal('0')) + extras
        if save:
            self.save(update_fields=['total'])
        return self.total


class LiquidacionItem(models.Model):
    liquidacion = models.ForeignKey(Liquidacion, on_delete=models.CASCADE, related_name='items')
    concepto = models.CharField(max_length=160)
    cantidad = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('1'))
    monto_unitario = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))

    class Meta:
        ordering = ['id']

    @property
    def total(self) -> Decimal:
        return (self.cantidad or Decimal('0')) * (self.monto_unitario or Decimal('0'))
