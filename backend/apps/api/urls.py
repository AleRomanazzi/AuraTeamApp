from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.calendario.views import ClienteMensualViewSet, EventoUnicoViewSet
from apps.equipo.views import PersonaViewSet, TareaViewSet
from apps.finanzas.views import AdjuntoViewSet, TransaccionViewSet
from apps.servicios.views import ServicioViewSet
from apps.stats.views import AnalisisStatsViewSet

from .views import (
    DashboardView,
    GoogleOAuthExchangePlaceholderView,
    MeConfigView,
    MeDataDeleteView,
    MeExportView,
    MeImportView,
)

router = DefaultRouter()
router.register('transacciones', TransaccionViewSet, basename='transaccion')
router.register('adjuntos', AdjuntoViewSet, basename='adjunto')
router.register('servicios', ServicioViewSet, basename='servicio')
router.register('personal', PersonaViewSet, basename='persona')
router.register('tareas', TareaViewSet, basename='tarea')
router.register('cal-clientes', ClienteMensualViewSet, basename='cal-cliente')
router.register('cal-eventos', EventoUnicoViewSet, basename='cal-evento')
router.register('stats', AnalisisStatsViewSet, basename='stats')

urlpatterns = [
    path('integraciones/google/exchange/', GoogleOAuthExchangePlaceholderView.as_view(), name='api-google-exchange'),
    path('dashboard/', DashboardView.as_view(), name='api-dashboard'),
    path('me/config/', MeConfigView.as_view(), name='api-me-config'),
    path('me/export/', MeExportView.as_view(), name='api-me-export'),
    path('me/import/', MeImportView.as_view(), name='api-me-import'),
    path('me/data/', MeDataDeleteView.as_view(), name='api-me-data'),
    path('', include(router.urls)),
]
