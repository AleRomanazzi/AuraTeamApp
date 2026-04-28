from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class UserConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            'moneda',
            'nombre_display',
            'google_api_key',
            'google_client_id',
            'gmail_account',
            'google_connected',
        )

    def update(self, instance, validated_data):
        if (getattr(settings, 'AURA_GOOGLE_CLIENT_ID', '') or '').strip() or (getattr(settings, 'AURA_GOOGLE_API_KEY', '') or '').strip():
            validated_data.pop('google_api_key', None)
            validated_data.pop('google_client_id', None)
        return super().update(instance, validated_data)
