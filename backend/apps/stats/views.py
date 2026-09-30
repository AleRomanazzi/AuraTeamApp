import logging
import os
import threading

from django.conf import settings
from django.db import close_old_connections
from django.http import FileResponse, Http404
from rest_framework import mixins, parsers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import requiere_permiso
from apps.core.uploads import detectar_tipo
from apps.core.utils import parse_fecha_param

from .models import PLATAFORMAS, AnalisisStats, ImagenAnalisis
from .serializers import AnalisisStatsSerializer

logger = logging.getLogger(__name__)

MAX_STATS_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGENES_POR_GRUPO = 6
TIPOS_IMAGEN = {'image/jpeg', 'image/png', 'image/webp'}


def ia_configurada() -> bool:
    return bool(os.getenv('AI_API_KEY')) and os.getenv('AI_PROVIDER', '').lower() in ('openai', 'anthropic')


def ejecutar_analisis(analisis_id: int, antes: list, despues: list):
    from .ai_vision import analyze_screenshots

    try:
        metricas, interpretacion, plat = analyze_screenshots(antes, despues)
        a = AnalisisStats.objects.get(pk=analisis_id)
        if metricas is None:
            a.estado = 'error'
            a.interpretacion = interpretacion
        else:
            a.estado = 'listo'
            a.metricas = metricas
            a.interpretacion = interpretacion
            if plat and not a.plataforma:
                a.plataforma = plat[:40]
        a.save(update_fields=['estado', 'metricas', 'interpretacion', 'plataforma'])
    except Exception:
        logger.exception('Falló el análisis de estadísticas %s', analisis_id)
        AnalisisStats.objects.filter(pk=analisis_id).update(
            estado='error', interpretacion='No se pudo completar el análisis. Probá de nuevo más tarde.'
        )
    finally:
        close_old_connections()


class AnalisisStatsViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AnalisisStatsSerializer
    permission_classes = [requiere_permiso('estadisticas')]

    def get_queryset(self):
        qs = AnalisisStats.objects.select_related('cliente').prefetch_related('imagenes')
        p = self.request.query_params
        if p.get('cliente'):
            qs = qs.filter(cliente_id=p['cliente'])
        if p.get('plataforma'):
            qs = qs.filter(plataforma=p['plataforma'])
        return qs

    def get_throttles(self):
        if self.action == 'analizar':
            self.throttle_scope = 'ia'
        return super().get_throttles()

    @action(detail=False, methods=['get'])
    def plataformas(self, request):
        return Response([{'value': v, 'label': l} for v, l in PLATAFORMAS])

    @action(detail=False, methods=['post'], parser_classes=(parsers.MultiPartParser, parsers.FormParser))
    def analizar(self, request):
        antes = list(request.FILES.getlist('antes'))
        despues = list(request.FILES.getlist('despues'))
        if not antes and not despues:
            return Response({'detail': 'Subí al menos una captura.'}, status=status.HTTP_400_BAD_REQUEST)
        grupos = []
        for nombre, files in (('antes', antes), ('despues', despues)):
            if len(files) > MAX_IMAGENES_POR_GRUPO:
                return Response(
                    {'detail': f'Máximo {MAX_IMAGENES_POR_GRUPO} capturas por período.'}, status=status.HTTP_400_BAD_REQUEST
                )
            datos = []
            for f in files:
                if f.size > MAX_STATS_IMAGE_BYTES:
                    return Response({'detail': f'«{f.name}» supera los 8 MB.'}, status=status.HTTP_400_BAD_REQUEST)
                tipo = detectar_tipo(f)
                if tipo not in TIPOS_IMAGEN:
                    return Response({'detail': f'«{f.name}» no es una imagen JPG, PNG o WEBP válida.'}, status=status.HTTP_400_BAD_REQUEST)
                datos.append((f.read(), tipo))
                f.seek(0)
            grupos.append((nombre, files, datos))

        cliente_id = request.data.get('cliente') or None
        if cliente_id:
            from apps.clientes.models import Cliente

            if not Cliente.objects.filter(pk=cliente_id).exists():
                return Response({'cliente': 'Cliente inexistente.'}, status=status.HTTP_400_BAD_REQUEST)
        desde = parse_fecha_param(request.data.get('periodo_desde'), 'periodo_desde')
        hasta = parse_fecha_param(request.data.get('periodo_hasta'), 'periodo_hasta')

        analisis = AnalisisStats.objects.create(
            user=request.user,
            cliente_id=cliente_id,
            plataforma=(request.data.get('plataforma') or '')[:40],
            periodo_desde=desde.date() if desde else None,
            periodo_hasta=hasta.date() if hasta else None,
            notas=request.data.get('notas') or '',
            estado='procesando' if ia_configurada() else 'listo',
        )
        for nombre, files, _ in grupos:
            for f in files:
                ImagenAnalisis.objects.create(analisis=analisis, grupo=nombre, archivo=f)

        if not ia_configurada():
            analisis.interpretacion = 'Guardado sin análisis automático: la IA no está configurada en el servidor. Podés cargar las métricas a mano.'
            analisis.save(update_fields=['interpretacion'])
        else:
            antes_b = grupos[0][2]
            despues_b = grupos[1][2]
            if getattr(settings, 'AI_ASYNC', True):
                threading.Thread(target=ejecutar_analisis, args=(analisis.id, antes_b, despues_b), daemon=True).start()
            else:
                ejecutar_analisis(analisis.id, antes_b, despues_b)
                analisis.refresh_from_db()

        return Response(AnalisisStatsSerializer(analisis).data, status=status.HTTP_201_CREATED)


class ImagenAnalisisViewSet(viewsets.GenericViewSet):
    permission_classes = [requiere_permiso('estadisticas')]
    queryset = ImagenAnalisis.objects.all()

    @action(detail=True, methods=['get'])
    def ver(self, request, pk=None):
        img = self.get_object()
        try:
            f = img.archivo.open('rb')
        except (FileNotFoundError, OSError):
            raise Http404('La imagen ya no está disponible.')
        return FileResponse(f)
