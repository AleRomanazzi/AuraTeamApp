from django.urls import path

from rest_framework_simplejwt.views import TokenRefreshView

from .views import CambiarPasswordView, LoginView, LogoutView, MeView

urlpatterns = [
    path('login/', LoginView.as_view(), name='token_obtain_pair'),
    path('refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('logout/', LogoutView.as_view(), name='auth-logout'),
    path('me/', MeView.as_view(), name='auth-me'),
    path('password/', CambiarPasswordView.as_view(), name='auth-password'),
]
