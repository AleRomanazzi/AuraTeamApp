from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import serializers


User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ("username", "email", "password")

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)


class MeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "email",
            "moneda",
            "nombre_display",
            "google_api_key",
            "google_client_id",
            "gmail_account",
            "google_connected",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        fixed_cid = getattr(settings, "AURA_GOOGLE_CLIENT_ID", "") or ""
        fixed_key = getattr(settings, "AURA_GOOGLE_API_KEY", "") or ""
        hint = getattr(settings, "AURA_GOOGLE_LOGIN_HINT", "") or ""
        data["google_oauth_managed"] = bool(fixed_cid or fixed_key)
        data["google_login_hint"] = hint
        if fixed_cid:
            data["google_client_id"] = fixed_cid
        if fixed_key:
            data["google_api_key"] = fixed_key
        return data
