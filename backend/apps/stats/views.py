import os

from rest_framework import mixins, parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import AnalisisStats, ImagenAnalisis
from .serializers import AnalisisStatsSerializer

MAX_STATS_IMAGE_BYTES = 8 * 1024 * 1024
ALLOWED_STATS_IMAGE_TYPES = frozenset({'image/jpeg', 'image/png', 'image/webp'})


def _validate_image_upload(upload):
    if upload.size > MAX_STATS_IMAGE_BYTES:
        return 'Imagen demasiado grande (máx 8MB).'
    ct = (upload.content_type or '').split(';')[0].strip()
    if ct not in ALLOWED_STATS_IMAGE_TYPES:
        return f'Tipo no permitido: {ct}'
    return None


class AnalisisStatsViewSet(mixins.ListModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    serializer_class = AnalisisStatsSerializer
    lookup_field = 'pk'

    def get_queryset(self):
        return AnalisisStats.objects.filter(user=self.request.user).prefetch_related('imagenes')

    @action(detail=False, methods=['post'], parser_classes=(parsers.MultiPartParser, parsers.FormParser))
    def analizar(self, request):
        plataforma = (request.data.get('plataforma') or '')[:40]
        antes = request.FILES.getlist('antes')
        despues = request.FILES.getlist('despues')
        if not antes and not despues:
            return Response(
                {'detail': 'Envía al menos una imagen en los campos "antes" o "despues".'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        antes_list = list(antes)
        despues_list = list(despues)
        for group_name, files in (('antes', antes_list), ('despues', despues_list)):
            for f in files:
                err = _validate_image_upload(f)
                if err:
                    return Response({'detail': f'{group_name}: {err}'}, status=status.HTTP_400_BAD_REQUEST)

        antes_bytes: list[tuple[bytes, str]] = []
        for f in antes_list:
            raw = f.read()
            f.seek(0)
            ct = (getattr(f, 'content_type', None) or 'image/jpeg').split(';')[0].strip()
            if ct not in ALLOWED_STATS_IMAGE_TYPES:
                ct = 'image/jpeg'
            antes_bytes.append((raw, ct))
        despues_bytes: list[tuple[bytes, str]] = []
        for f in despues_list:
            raw = f.read()
            f.seek(0)
            ct = (getattr(f, 'content_type', None) or 'image/jpeg').split(';')[0].strip()
            if ct not in ALLOWED_STATS_IMAGE_TYPES:
                ct = 'image/jpeg'
            despues_bytes.append((raw, ct))

        analisis = AnalisisStats.objects.create(user=request.user, plataforma=plataforma)
        for f in antes_list:
            ImagenAnalisis.objects.create(analisis=analisis, grupo='antes', archivo=f)
        for f in despues_list:
            ImagenAnalisis.objects.create(analisis=analisis, grupo='despues', archivo=f)

        if os.getenv('AI_API_KEY') and os.getenv('AI_PROVIDER', '').lower() in ('openai', 'anthropic'):
            from .ai_vision import analyze_screenshots

            metricas, interpretacion, plat = analyze_screenshots(antes_bytes, despues_bytes)
            if metricas is None:
                analisis.metricas = []
                analisis.interpretacion = interpretacion
            else:
                analisis.metricas = metricas
                analisis.interpretacion = interpretacion
                if plat:
                    analisis.plataforma = plat[:40]
        else:
            analisis.metricas = []
            analisis.interpretacion = (
                'Análisis guardado sin IA: configura AI_PROVIDER (openai|anthropic) y AI_API_KEY en el servidor.'
            )
        analisis.save(update_fields=['metricas', 'interpretacion', 'plataforma'])

        return Response(AnalisisStatsSerializer(analisis).data, status=status.HTTP_201_CREATED)
