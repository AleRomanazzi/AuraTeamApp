import time
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model
from django.shortcuts import redirect
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.core.permissions import IsAdmin

from . import google
from .serializers import CambiarPasswordSerializer, MeSerializer, UsuarioSerializer

User = get_user_model()


class LoginView(TokenObtainPairView):
    throttle_scope = 'login'


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        refresh = request.data.get('refresh')
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except TokenError:
                pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)


class CambiarPasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        s = CambiarPasswordSerializer(data=request.data, context={'request': request})
        s.is_valid(raise_exception=True)
        request.user.set_password(s.validated_data['nueva'])
        request.user.save(update_fields=['password'])
        return Response(status=status.HTTP_204_NO_CONTENT)


def _frontend_url(path: str) -> str:
    base = settings.FRONTEND_URL or (settings.CORS_ALLOWED_ORIGINS[0] if settings.CORS_ALLOWED_ORIGINS else '')
    return f'{base.rstrip("/")}{path}'


class GoogleEstadoView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        c = google.cuenta()
        return Response(
            {
                'configurado': google.configurado(),
                'conectado': c is not None,
                'email': c.email if c else None,
                'conectada_en': c.conectada_en if c else None,
                'drive': bool(c and 'drive.file' in c.scopes),
                'cuenta_sugerida': settings.AURA_GOOGLE_LOGIN_HINT or None,
            }
        )


class GoogleConectarView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        try:
            return Response({'url': google.url_autorizacion(request)})
        except google.GoogleError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class GoogleCallbackView(APIView):
    """Google redirige acá después del consentimiento; no lleva JWT, la identidad viaja firmada en `state`."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        destino = '/config?tab=google&google='
        if request.query_params.get('error'):
            return redirect(_frontend_url(destino + 'cancelado'))
        try:
            user = User.objects.filter(pk=google.leer_state(request.query_params.get('state', '')), is_active=True).first()
            if user is None or not user.es_admin:
                raise google.GoogleError('Solo un administrador puede conectar la cuenta.')
            google.conectar(request.query_params.get('code', ''), request, user)
        except google.GoogleError as e:
            return redirect(_frontend_url(destino + 'error&' + urlencode({'motivo': str(e)})))
        return redirect(_frontend_url(destino + 'ok'))


class GoogleTokenView(APIView):
    permission_classes = [IsAdmin]

    def get(self, request):
        try:
            t = google.access_token()
        except google.GoogleDesconectada as e:
            return Response({'detail': str(e), 'desconectada': True}, status=status.HTTP_409_CONFLICT)
        except google.GoogleError as e:
            return Response({'detail': str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({'access_token': t['access_token'], 'expires_in': int(t['expira_en'] - time.time())})


class GoogleDesconectarView(APIView):
    permission_classes = [IsAdmin]

    def post(self, request):
        google.desconectar()
        return Response(status=status.HTTP_204_NO_CONTENT)


class UsuarioViewSet(viewsets.ModelViewSet):
    serializer_class = UsuarioSerializer
    permission_classes = [IsAdmin]
    pagination_class = None
    queryset = User.objects.select_related('persona').order_by('username')

    def destroy(self, request, *args, **kwargs):
        user = self.get_object()
        if user.pk == request.user.pk:
            return Response({'detail': 'No podés borrar tu propio usuario.'}, status=status.HTTP_400_BAD_REQUEST)
        user.is_active = False
        user.save(update_fields=['is_active'])
        return Response({'detail': 'Usuario desactivado.'}, status=status.HTTP_200_OK)
