from django.urls import path

from .views import NotionEstadoView, NotionSincronizarView, NotionUsuariosView, NotionWebhookResetView, NotionWebhookView

urlpatterns = [
    path('', NotionEstadoView.as_view(), name='notion-estado'),
    path('sincronizar/', NotionSincronizarView.as_view(), name='notion-sincronizar'),
    path('usuarios/', NotionUsuariosView.as_view(), name='notion-usuarios'),
    path('webhook/', NotionWebhookView.as_view(), name='notion-webhook'),
    path('webhook/reiniciar/', NotionWebhookResetView.as_view(), name='notion-webhook-reiniciar'),
]
