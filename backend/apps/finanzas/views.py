import calendar
import csv
from datetime import date
from io import StringIO

from django.http import HttpResponse
from rest_framework import mixins, parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import AdjuntoTransaccion, Transaccion
from .serializers import AdjuntoTransaccionSerializer, TransaccionSerializer

MAX_ADJUNTO_BYTES = 10 * 1024 * 1024
ALLOWED_ADJUNTO_TYPES = frozenset(
    {
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/xml',
        'text/xml',
    }
)


class TransaccionViewSet(viewsets.ModelViewSet):
    serializer_class = TransaccionSerializer

    def get_queryset(self):
        qs = Transaccion.objects.filter(user=self.request.user).prefetch_related('adjuntos')
        mes = self.request.query_params.get('mes')
        tipo = self.request.query_params.get('tipo')
        categoria = self.request.query_params.get('categoria')
        if mes and len(mes) == 7:
            y, m = int(mes[:4]), int(mes[5:7])
            start = date(y, m, 1)
            last = calendar.monthrange(y, m)[1]
            end = date(y, m, last)
            qs = qs.filter(fecha__range=(start, end))
        if tipo:
            qs = qs.filter(tipo=tipo)
        if categoria:
            qs = qs.filter(categoria=categoria)
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_update(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='export.csv')
    def export_csv(self, request):
        qs = self.filter_queryset(self.get_queryset())
        buf = StringIO()
        w = csv.writer(buf)
        w.writerow(['Fecha', 'Descripción', 'Categoría', 'Tipo', 'Monto', 'Notas'])
        for t in qs:
            w.writerow([t.fecha.isoformat(), t.descripcion, t.categoria, t.tipo, str(t.monto), t.notas])
        resp = HttpResponse(buf.getvalue(), content_type='text/csv; charset=utf-8')
        resp['Content-Disposition'] = 'attachment; filename="transacciones.csv"'
        return resp

    @action(
        detail=True,
        methods=['post'],
        parser_classes=(parsers.MultiPartParser, parsers.FormParser),
    )
    def adjuntos(self, request, pk=None):
        tx = self.get_object()
        upload = request.FILES.get('archivo') or request.FILES.get('file')
        if not upload:
            return Response({'detail': 'Falta archivo (campo archivo o file).'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_ADJUNTO_BYTES:
            return Response({'detail': 'Archivo demasiado grande (máx 10MB).'}, status=status.HTTP_400_BAD_REQUEST)
        ct = (upload.content_type or '').split(';')[0].strip()
        if ct and ct not in ALLOWED_ADJUNTO_TYPES:
            return Response({'detail': f'Tipo no permitido: {ct}'}, status=status.HTTP_400_BAD_REQUEST)
        adj = AdjuntoTransaccion.objects.create(
            transaccion=tx,
            archivo=upload,
            nombre_original=getattr(upload, 'name', '')[:255] or 'adjunto',
        )
        return Response(AdjuntoTransaccionSerializer(adj).data, status=status.HTTP_201_CREATED)


class AdjuntoViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = AdjuntoTransaccionSerializer
    lookup_field = 'pk'

    def get_queryset(self):
        return AdjuntoTransaccion.objects.filter(transaccion__user=self.request.user)
