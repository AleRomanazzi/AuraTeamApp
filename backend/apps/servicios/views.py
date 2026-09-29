from decimal import Decimal

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdmin
from apps.core.utils import equivalente_mensual, money, parse_mes

from . import services
from .models import Servicio
from .serializers import ServicioSerializer


class ServicioViewSet(viewsets.ModelViewSet):
    serializer_class = ServicioSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_queryset(self):
        qs = Servicio.objects.select_related('categoria').prefetch_related('pagos')
        if self.request.query_params.get('activo') in ('1', 'true'):
            qs = qs.filter(activo=True)
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        if self.request.query_params.get('mes'):
            ctx['periodo'] = parse_mes(self.request.query_params['mes'])[2]
        return ctx

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['post'], url_path='generar-egresos')
    def generar_egresos(self, request):
        return Response(services.generar_egresos(request.data.get('mes') or request.query_params.get('mes'), request.user))

    @action(detail=False, methods=['get'])
    def resumen(self, request):
        activos = [s for s in self.get_queryset() if s.activo]
        mensual = sum((equivalente_mensual(s.monto_agencia, s.periodicidad) for s in activos), Decimal('0'))
        return Response({'cantidad': len(activos), 'mensual': str(money(mensual)), 'anual': str(money(mensual * 12))})
