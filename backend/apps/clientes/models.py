from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from apps.core.utils import today
from apps.finanzas.models import MEDIO_PAGO_CHOICES

ESTADO_CLIENTE = [('activo', 'Activo'), ('pausado', 'Pausado'), ('baja', 'Baja')]

# Colores de evento de Google Calendar (colorId → nombre, hex); son fijos en la API.
COLORES_GOOGLE = {
    '1': ('Lavanda', '#a4bdfc'),
    '2': ('Salvia', '#7ae7bf'),
    '3': ('Uva', '#dbadff'),
    '4': ('Flamenco', '#ff887c'),
    '5': ('Banana', '#fbd75b'),
    '6': ('Mandarina', '#ffb878'),
    '7': ('Pavo real', '#46d6db'),
    '8': ('Grafito', '#e1e1e1'),
    '9': ('Arándano', '#5484ed'),
    '10': ('Albahaca', '#51b749'),
    '11': ('Tomate', '#dc2127'),
}

PERIODICIDAD_CONTRATO = [
    ('mensual', 'Mensual'),
    ('bimestral', 'Bimestral'),
    ('trimestral', 'Trimestral'),
    ('semestral', 'Semestral'),
    ('anual', 'Anual'),
    ('unico', 'Pago único'),
]

ESTADO_COBRO = [
    ('pendiente', 'Pendiente'),
    ('parcial', 'Parcial'),
    ('pagado', 'Pagado'),
    ('anulado', 'Anulado'),
]


class Cliente(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    nombre = models.CharField(max_length=120)
    razon_social = models.CharField(max_length=160, blank=True)
    cuit = models.CharField(max_length=20, blank=True)
    rubro = models.CharField(max_length=80, blank=True)
    contacto = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True)
    whatsapp = models.CharField(max_length=40, blank=True)
    estado = models.CharField(max_length=10, choices=ESTADO_CLIENTE, default='activo')
    fecha_alta = models.DateField(default=today)
    color = models.CharField(max_length=12, default='#4fffb0')
    notas = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)
    notion_page_id = models.CharField(max_length=36, null=True, blank=True, unique=True)
    google_color = models.CharField(max_length=2, blank=True, choices=[(k, v[0]) for k, v in COLORES_GOOGLE.items()])
    # Separadas por coma; sirven para reconocer al cliente en títulos de eventos cargados directo en Google.
    palabras_clave = models.CharField(max_length=200, blank=True)
    drive_folder_id = models.CharField(max_length=80, blank=True)
    onboarding_iniciado = models.DateTimeField(null=True, blank=True)
    reporte_auto = models.BooleanField(default=False)
    recordatorios_cobro = models.BooleanField(default=False)

    class Meta:
        ordering = ['nombre']

    def __str__(self):
        return self.nombre

    @property
    def drive_url(self) -> str:
        return f'https://drive.google.com/drive/folders/{self.drive_folder_id}' if self.drive_folder_id else ''


ROLES_ONBOARDING = [
    ('admin', 'Socios'),
    ('cm', 'Community manager'),
    ('editor', 'Editor de video'),
    ('disenio', 'Diseño'),
    ('foto', 'Fotografía / Filmmaker'),
]
ACCIONES_ONBOARDING = [('', 'Tarea'), ('drive', 'Crear la carpeta de Drive')]


class PasoOnboarding(models.Model):
    """Paso de la plantilla de onboarding: al dar de alta un cliente se convierte en una tarea para el rol indicado."""

    orden = models.PositiveSmallIntegerField(default=0)
    titulo = models.CharField(max_length=160)
    descripcion = models.TextField(blank=True)
    rol = models.CharField(max_length=10, choices=ROLES_ONBOARDING, default='cm')
    dias_desde_alta = models.PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(90)])
    etiqueta = models.CharField(max_length=40, default='reuniones')
    accion = models.CharField(max_length=10, choices=ACCIONES_ONBOARDING, blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ['orden', 'id']

    def __str__(self):
        return self.titulo


class Contrato(models.Model):
    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='contratos')
    concepto = models.CharField(max_length=160)
    categoria = models.ForeignKey(
        'finanzas.Categoria', null=True, blank=True, on_delete=models.SET_NULL, related_name='+'
    )
    monto = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    periodicidad = models.CharField(max_length=12, choices=PERIODICIDAD_CONTRATO, default='mensual')
    dia_vencimiento = models.PositiveSmallIntegerField(
        default=10, validators=[MinValueValidator(1), MaxValueValidator(31)]
    )
    fecha_inicio = models.DateField(default=today)
    fecha_fin = models.DateField(null=True, blank=True)
    activo = models.BooleanField(default=True)
    responsable = models.ForeignKey(
        'equipo.Persona', null=True, blank=True, on_delete=models.SET_NULL, related_name='contratos_responsable'
    )
    notas = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['cliente__nombre', 'concepto']

    def __str__(self):
        return f'{self.cliente} — {self.concepto}'

    def monto_para(self, fecha, ajustes=None) -> Decimal:
        """Monto vigente en `fecha` según el historial de ajustes de precio."""
        if ajustes is None:
            ajustes = list(self.ajustes.all())
        ajustes = sorted(ajustes, key=lambda a: (a.fecha_desde, a.id or 0))
        vigentes = [a for a in ajustes if a.fecha_desde <= fecha]
        if vigentes:
            return vigentes[-1].monto_nuevo
        if ajustes:
            return ajustes[0].monto_anterior
        return self.monto


class AjustePrecio(models.Model):
    contrato = models.ForeignKey(Contrato, on_delete=models.CASCADE, related_name='ajustes')
    fecha_desde = models.DateField()
    monto_anterior = models.DecimalField(max_digits=14, decimal_places=2)
    monto_nuevo = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    porcentaje = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    nota = models.CharField(max_length=200, blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha_desde', '-id']


class Cobro(models.Model):
    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name='cobros')
    contrato = models.ForeignKey(Contrato, null=True, blank=True, on_delete=models.SET_NULL, related_name='cobros')
    periodo = models.CharField(max_length=7)
    concepto = models.CharField(max_length=200)
    monto = models.DecimalField(max_digits=14, decimal_places=2, validators=[MinValueValidator(Decimal('0.01'))])
    vencimiento = models.DateField()
    monto_cobrado = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0'))
    fecha_pago = models.DateField(null=True, blank=True)
    medio_pago = models.CharField(max_length=20, choices=MEDIO_PAGO_CHOICES, blank=True)
    comprobante = models.CharField(max_length=80, blank=True)
    estado = models.CharField(max_length=10, choices=ESTADO_COBRO, default='pendiente')
    transaccion = models.OneToOneField(
        'finanzas.Transaccion', null=True, blank=True, on_delete=models.SET_NULL, related_name='cobro'
    )
    notas = models.TextField(blank=True)
    creado = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['vencimiento', 'cliente__nombre']
        constraints = [
            models.UniqueConstraint(
                fields=['contrato', 'periodo'],
                condition=Q(contrato__isnull=False),
                name='unique_cobro_contrato_periodo',
            ),
        ]
        indexes = [models.Index(fields=['periodo', 'estado'], name='cobro_periodo_estado_idx')]

    def __str__(self):
        return f'{self.cliente} {self.periodo} {self.monto}'

    @property
    def saldo(self) -> Decimal:
        if self.estado == 'anulado':
            return Decimal('0')
        return max(Decimal('0'), (self.monto or 0) - (self.monto_cobrado or 0))

    @property
    def vencido(self) -> bool:
        return self.estado in ('pendiente', 'parcial') and self.vencimiento < today()


TIPOS_ENVIO = [('reporte', 'Reporte mensual'), ('recordatorio', 'Recordatorio de cobro')]
ESTADOS_ENVIO = [('borrador', 'Borrador'), ('enviado', 'Enviado'), ('error', 'Error'), ('descartado', 'Descartado')]


class EnvioCliente(models.Model):
    """Email a un cliente (reporte del mes o recordatorio de cobro): registro de lo enviado e idempotencia del cron."""

    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='envios')
    cobro = models.ForeignKey('Cobro', null=True, blank=True, on_delete=models.CASCADE, related_name='envios')
    tipo = models.CharField(max_length=12, choices=TIPOS_ENVIO)
    periodo = models.CharField(max_length=7)
    # Etapa del recordatorio: 'antes', 'dia', '+3', '+7'… o 'manual' (se puede repetir).
    clave = models.CharField(max_length=12, blank=True)
    estado = models.CharField(max_length=10, choices=ESTADOS_ENVIO, default='borrador')
    para = models.CharField(max_length=254, blank=True)
    asunto = models.CharField(max_length=200)
    html = models.TextField()
    error = models.CharField(max_length=300, blank=True)
    creado = models.DateTimeField(auto_now_add=True)
    enviado_en = models.DateTimeField(null=True, blank=True)
    enviado_por = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='+')

    class Meta:
        ordering = ['-creado']
        constraints = [
            models.UniqueConstraint(fields=['cliente', 'periodo'], condition=Q(tipo='reporte'), name='envio_reporte_unico'),
            models.UniqueConstraint(
                fields=['cobro', 'clave'], condition=Q(tipo='recordatorio') & ~Q(clave='manual'), name='envio_recordatorio_unico'
            ),
        ]


class ConfigEnvios(models.Model):
    """Configuración única de los emails automáticos a clientes."""

    dia_reporte = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(28)])
    dias_antes = models.PositiveSmallIntegerField(default=3, validators=[MaxValueValidator(15)])
    dias_despues = models.CharField(max_length=40, default='3,7')

    @classmethod
    def get(cls):
        return cls.objects.get_or_create(pk=1)[0]

    def lista_despues(self) -> list[int]:
        return sorted({int(x) for x in self.dias_despues.replace(' ', '').split(',') if x.isdigit() and 0 < int(x) <= 60})
