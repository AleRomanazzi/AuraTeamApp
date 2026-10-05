from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import UsuarioViewSet
from apps.calendario.views import (
    EtiquetasView,
    EventoUnicoViewSet,
    GoogleCalendarColoresView,
    GoogleCalendarEstadoView,
    GoogleCalendarEtiquetaView,
    GoogleCalendarSincronizarView,
    VencimientosView,
)
from apps.clientes.views import ClienteViewSet, CobroViewSet, ContratoViewSet, RentabilidadView
from apps.equipo.views import AsignacionClienteViewSet, LiquidacionViewSet, PersonaViewSet, TareaRecurrenteViewSet, TareaViewSet
from apps.notificaciones.views import NotificacionViewSet
from apps.finanzas.views import AdjuntoViewSet, CategoriaViewSet, TransaccionViewSet
from apps.servicios.views import ServicioViewSet
from apps.stats.views import AnalisisStatsViewSet, ImagenAnalisisViewSet

from .views import DashboardView, MeConfigView, MeDataDeleteView, MeExportView, MeImportView, MiPanelView

router = DefaultRouter()
router.register('categorias', CategoriaViewSet, basename='categoria')
router.register('transacciones', TransaccionViewSet, basename='transaccion')
router.register('adjuntos', AdjuntoViewSet, basename='adjunto')
router.register('clientes', ClienteViewSet, basename='cliente')
router.register('contratos', ContratoViewSet, basename='contrato')
router.register('cobros', CobroViewSet, basename='cobro')
router.register('servicios', ServicioViewSet, basename='servicio')
router.register('personal', PersonaViewSet, basename='persona')
router.register('tareas-recurrentes', TareaRecurrenteViewSet, basename='tarea-recurrente')
router.register('tareas', TareaViewSet, basename='tarea')
router.register('asignaciones-cliente', AsignacionClienteViewSet, basename='asignacion-cliente')
router.register('liquidaciones', LiquidacionViewSet, basename='liquidacion')
router.register('cal-eventos', EventoUnicoViewSet, basename='cal-evento')
router.register('stats', AnalisisStatsViewSet, basename='stats')
router.register('stats-imagenes', ImagenAnalisisViewSet, basename='stats-imagen')
router.register('usuarios', UsuarioViewSet, basename='usuario')
router.register('notificaciones', NotificacionViewSet, basename='notificacion')

urlpatterns = [
    path('dashboard/', DashboardView.as_view(), name='api-dashboard'),
    path('mi-panel/', MiPanelView.as_view(), name='api-mi-panel'),
    path('rentabilidad/', RentabilidadView.as_view(), name='api-rentabilidad'),
    path('calendario/vencimientos/', VencimientosView.as_view(), name='api-vencimientos'),
    path('calendario/google/', GoogleCalendarEstadoView.as_view(), name='api-calendario-google'),
    path('calendario/google/sincronizar/', GoogleCalendarSincronizarView.as_view(), name='api-calendario-google-sync'),
    path('calendario/etiquetas/', EtiquetasView.as_view(), name='api-calendario-etiquetas'),
    path('calendario/google/etiqueta/', GoogleCalendarEtiquetaView.as_view(), name='api-calendario-google-etiqueta'),
    path('calendario/google/colores/', GoogleCalendarColoresView.as_view(), name='api-calendario-google-colores'),
    path('me/config/', MeConfigView.as_view(), name='api-me-config'),
    path('me/export/', MeExportView.as_view(), name='api-me-export'),
    path('me/import/', MeImportView.as_view(), name='api-me-import'),
    path('me/data/', MeDataDeleteView.as_view(), name='api-me-data'),
    path('', include(router.urls)),
]
