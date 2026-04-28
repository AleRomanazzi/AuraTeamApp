from rest_framework import mixins, viewsets

from .models import ClienteMensual, EventoUnico
from .serializers import ClienteMensualSerializer, EventoUnicoSerializer


class ClienteMensualViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = ClienteMensualSerializer
    lookup_field = 'pk'

    def get_queryset(self):
        return ClienteMensual.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class EventoUnicoViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = EventoUnicoSerializer
    lookup_field = 'pk'

    def get_queryset(self):
        qs = EventoUnico.objects.filter(user=self.request.user)
        desde = self.request.query_params.get('desde')
        hasta = self.request.query_params.get('hasta')
        if desde:
            qs = qs.filter(inicio__gte=desde)
        if hasta:
            qs = qs.filter(inicio__lte=hasta)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
