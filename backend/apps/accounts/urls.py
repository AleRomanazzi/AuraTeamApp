from django.urls import path

from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    CambiarPasswordView,
    GoogleCallbackView,
    GoogleConectarView,
    GoogleDesconectarView,
    GoogleEstadoView,
    GoogleTokenView,
    LoginView,
    LogoutView,
    MeView,
)

urlpatterns = [
    path('login/', LoginView.as_view(), name='token_obtain_pair'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('logout/', LogoutView.as_view(), name='auth-logout'),
    path('me/', MeView.as_view(), name='auth-me'),
    path('password/', CambiarPasswordView.as_view(), name='auth-password'),
    path('google/', GoogleEstadoView.as_view(), name='google-estado'),
    path('google/conectar/', GoogleConectarView.as_view(), name='google-conectar'),
    path('google/callback/', GoogleCallbackView.as_view(), name='google-callback'),
    path('google/token/', GoogleTokenView.as_view(), name='google-token'),
    path('google/desconectar/', GoogleDesconectarView.as_view(), name='google-desconectar'),
]
