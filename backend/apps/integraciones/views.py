import json

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.clientes.models import Cliente
from apps.core.permissions import IsAdmin, es_admin
from apps.equipo.models import Persona, Tarea

from . import notion
from .models import EstadoNotion


class NotionEstadoView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        e = EstadoNotion.get()
        return Response(
            {
                'configurado': notion.configurado(),
                'ultima_sync': e.ultima_sync,
                'ultima_sync_completa': e.ultima_sync_completa,
                'ultimo_error': e.ultimo_error or None,
                'ultimo_error_en': e.ultimo_error_en,
                'webhook_url': request.build_absolute_uri('/api/notion/webhook/'),
                'webhook_token': e.webhook_token or None,
                'tareas_vinculadas': Tarea.objects.exclude(notion_page_id=None).count(),
                'clientes_vinculados': Cliente.objects.exclude(notion_page_id=None).count(),
                'personas_vinculadas': Persona.objects.exclude(notion_user_id='').count(),
                'tareas_url': f'https://www.notion.so/{settings.NOTION_TAREAS_DS.replace("-", "")}',
            }
        )


class NotionSincronizarView(APIView):
    """Incremental (cualquier usuario, limitada a una por minuto) o completa (solo admin)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not notion.configurado():
            return Response({'omitida': True, 'detail': 'Notion no está configurado.'})
        completa = bool(request.data.get('completa')) and es_admin(request.user)
        try:
            return Response(notion.sincronizar(completa=completa))
        except notion.NotionError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class NotionUsuariosView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        try:
            return Response(notion.usuarios())
        except notion.NotionError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)


class NotionWebhookResetView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        EstadoNotion.objects.filter(pk=1).update(webhook_token='')
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotionWebhookView(APIView):
    """Recibe los eventos de la suscripción de webhooks de la integración de Notion."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        cuerpo = request.body
        try:
            data = json.loads(cuerpo or b'{}')
        except ValueError:
            return Response(status=status.HTTP_400_BAD_REQUEST)
        estado = EstadoNotion.get()
        if 'verification_token' in data:
            # Solo se acepta si no hay uno guardado: reemplazarlo requiere reiniciarlo desde el panel.
            if estado.webhook_token:
                return Response(status=status.HTTP_409_CONFLICT)
            estado.webhook_token = str(data['verification_token'])[:200]
            estado.save(update_fields=['webhook_token'])
            return Response(status=status.HTTP_200_OK)
        if not estado.webhook_token or not notion.firma_valida(cuerpo, request.headers.get('X-Notion-Signature', ''), estado.webhook_token):
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        if notion.configurado():
            try:
                notion.procesar_evento(data)
            except notion.NotionError as e:
                notion.registrar_error(str(e))
        return Response(status=status.HTTP_200_OK)
