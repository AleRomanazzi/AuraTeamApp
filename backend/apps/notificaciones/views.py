from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Notificacion
from .serializers import NotificacionSerializer

LIMITE_LISTA = 50


class NotificacionViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Notificaciones del usuario logueado (campana)."""

    serializer_class = NotificacionSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Notificacion.objects.filter(usuario=self.request.user)
        if self.request.query_params.get('no_leidas'):
            qs = qs.filter(leida_en__isnull=True)
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()[:LIMITE_LISTA]
        return Response(
            {
                'no_leidas': Notificacion.objects.filter(usuario=request.user, leida_en__isnull=True).count(),
                'resultados': self.get_serializer(qs, many=True).data,
            }
        )

    @action(detail=False, methods=['get'])
    def contador(self, request):
        return Response({'no_leidas': Notificacion.objects.filter(usuario=request.user, leida_en__isnull=True).count()})

    @action(detail=True, methods=['post'])
    def leer(self, request, pk=None):
        Notificacion.objects.filter(usuario=request.user, pk=pk, leida_en__isnull=True).update(leida_en=timezone.now())
        return self.contador(request)

    @action(detail=False, methods=['post'], url_path='leer-todas')
    def leer_todas(self, request):
        Notificacion.objects.filter(usuario=request.user, leida_en__isnull=True).update(leida_en=timezone.now())
        return self.contador(request)
