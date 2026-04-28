from rest_framework import viewsets

from .models import Servicio
from .serializers import ServicioSerializer


class ServicioViewSet(viewsets.ModelViewSet):
    serializer_class = ServicioSerializer

    def get_queryset(self):
        return Servicio.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        serializer.save(user=self.request.user)
