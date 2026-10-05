import hmac

from django.conf import settings
from django.db import connection
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = []

    def get(self, request):
        try:
            with connection.cursor() as cur:
                cur.execute('SELECT 1')
        except Exception:
            return Response({'status': 'error', 'db': False}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({'status': 'ok', 'db': True})


class CronView(APIView):
    """Lo llama cada hora el cron externo (GitHub Actions) con el header X-Cron-Token."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = []

    def post(self, request):
        if not settings.CRON_TOKEN:
            return Response({'detail': 'Falta CRON_TOKEN en el servidor.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not hmac.compare_digest(request.headers.get('X-Cron-Token', ''), settings.CRON_TOKEN):
            return Response({'detail': 'Token inválido.'}, status=status.HTTP_403_FORBIDDEN)
        from .cron import ejecutar

        return Response(ejecutar())
