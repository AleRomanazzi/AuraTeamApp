from django.db.models import ProtectedError, Q
from django.http import FileResponse, Http404
from rest_framework import mixins, parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.csv_utils import csv_response, monto_es
from apps.core.permissions import IsAdmin, IsAdminOrReadOnly
from apps.core.uploads import detectar_tipo
from apps.core.utils import parse_fecha_param, parse_mes

from .models import AdjuntoTransaccion, Categoria, Transaccion
from .serializers import AdjuntoTransaccionSerializer, CategoriaSerializer, TransaccionSerializer

MAX_ADJUNTO_BYTES = 10 * 1024 * 1024


class CategoriaViewSet(viewsets.ModelViewSet):
    serializer_class = CategoriaSerializer
    pagination_class = None
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = Categoria.objects.all()
        tipo = self.request.query_params.get('tipo')
        if tipo:
            qs = qs.filter(tipo=tipo)
        if self.request.query_params.get('activas') in ('1', 'true'):
            qs = qs.filter(activa=True)
        return qs

    def destroy(self, request, *args, **kwargs):
        cat = self.get_object()
        try:
            cat.delete()
        except ProtectedError:
            cat.activa = False
            cat.save(update_fields=['activa'])
            return Response(
                {'detail': 'La categoría tiene movimientos; se desactivó en lugar de borrarse.', 'desactivada': True},
                status=status.HTTP_200_OK,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class TransaccionViewSet(viewsets.ModelViewSet):
    serializer_class = TransaccionSerializer
    permission_classes = [IsAdmin]

    def get_queryset(self):
        qs = Transaccion.objects.select_related(
            'categoria', 'cliente', 'persona', 'cobro', 'liquidacion', 'pago_servicio'
        ).prefetch_related('adjuntos')
        p = self.request.query_params
        if p.get('mes'):
            inicio, fin, _ = parse_mes(p.get('mes'))
            qs = qs.filter(fecha__range=(inicio, fin))
        desde = parse_fecha_param(p.get('desde'), 'desde')
        hasta = parse_fecha_param(p.get('hasta'), 'hasta')
        if desde:
            qs = qs.filter(fecha__gte=desde.date())
        if hasta:
            qs = qs.filter(fecha__lte=hasta.date())
        if p.get('tipo'):
            qs = qs.filter(tipo=p['tipo'])
        for campo in ('categoria', 'cliente', 'persona'):
            if p.get(campo):
                qs = qs.filter(**{f'{campo}_id': p[campo]})
        if p.get('q'):
            q = p['q'].strip()
            qs = qs.filter(Q(descripcion__icontains=q) | Q(notas__icontains=q) | Q(comprobante__icontains=q))
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='export.csv')
    def export_csv(self, request):
        qs = self.filter_queryset(self.get_queryset())
        rows = (
            [
                t.fecha.isoformat(), t.tipo, t.categoria.nombre, t.descripcion,
                t.cliente.nombre if t.cliente else '', t.persona.nombre if t.persona else '',
                t.get_medio_pago_display() if t.medio_pago else '', t.comprobante, monto_es(t.monto), t.notas,
            ]
            for t in qs
        )
        return csv_response(
            'movimientos.csv',
            ['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Cliente', 'Persona', 'Medio de pago', 'Comprobante', 'Monto', 'Notas'],
            rows,
        )

    @action(detail=True, methods=['post'], parser_classes=(parsers.MultiPartParser, parsers.FormParser))
    def adjuntos(self, request, pk=None):
        tx = self.get_object()
        upload = request.FILES.get('archivo') or request.FILES.get('file')
        if not upload:
            return Response({'detail': 'Falta el archivo.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_ADJUNTO_BYTES:
            return Response({'detail': 'El archivo supera los 10 MB.'}, status=status.HTTP_400_BAD_REQUEST)
        tipo = detectar_tipo(upload)
        if not tipo:
            return Response({'detail': 'Solo se aceptan PDF, JPG, PNG o WEBP.'}, status=status.HTTP_400_BAD_REQUEST)
        adj = AdjuntoTransaccion.objects.create(
            transaccion=tx,
            archivo=upload,
            nombre_original=(getattr(upload, 'name', '') or 'adjunto')[:255],
            tipo_contenido=tipo,
        )
        return Response(AdjuntoTransaccionSerializer(adj).data, status=status.HTTP_201_CREATED)


class AdjuntoViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = AdjuntoTransaccionSerializer
    permission_classes = [IsAdmin]
    queryset = AdjuntoTransaccion.objects.all()

    @action(detail=True, methods=['get'])
    def descargar(self, request, pk=None):
        adj = self.get_object()
        try:
            f = adj.archivo.open('rb')
        except (FileNotFoundError, OSError):
            raise Http404('El archivo ya no está disponible.')
        return FileResponse(
            f,
            as_attachment=request.query_params.get('inline') != '1',
            filename=adj.nombre_original or 'adjunto',
            content_type=adj.tipo_contenido or 'application/octet-stream',
        )
