from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import AsignacionTarea, Persona, Tarea
from .serializers import PersonaSerializer, TareaSerializer


class PersonaViewSet(viewsets.ModelViewSet):
    serializer_class = PersonaSerializer

    def get_queryset(self):
        return Persona.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=['get', 'put'], url_path='tareas')
    def tareas(self, request, pk=None):
        persona = self.get_object()
        if request.method == 'GET':
            ids = AsignacionTarea.objects.filter(persona=persona).values_list('tarea_id', flat=True)
            qs = Tarea.objects.filter(pk__in=ids, user=request.user)
            return Response(TareaSerializer(qs, many=True).data)
        ids = request.data.get('tareas')
        if not isinstance(ids, list):
            return Response({'detail': 'Se requiere { "tareas": [id, ...] }'}, status=status.HTTP_400_BAD_REQUEST)
        AsignacionTarea.objects.filter(persona=persona).delete()
        for tid in ids:
            t = Tarea.objects.filter(pk=tid, user=request.user).first()
            if t:
                AsignacionTarea.objects.get_or_create(persona=persona, tarea=t, defaults={'estado': 'pendiente'})
        return Response({'ok': True})


class TareaViewSet(mixins.CreateModelMixin, mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = TareaSerializer
    lookup_field = 'pk'

    def get_queryset(self):
        return Tarea.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
