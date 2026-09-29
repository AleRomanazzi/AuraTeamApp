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
