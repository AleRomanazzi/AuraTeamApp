from django.contrib.auth import get_user_model
from rest_framework import permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.core.permissions import IsAdmin

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
