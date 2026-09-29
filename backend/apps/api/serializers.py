from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class UserConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('first_name', 'last_name', 'email', 'nombre_display')
