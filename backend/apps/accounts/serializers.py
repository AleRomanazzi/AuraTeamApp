from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import ROLES_EQUIPO, CuentaGoogle

User = get_user_model()
ROLES_VALIDOS = {r for r, _ in ROLES_EQUIPO}


class MeSerializer(serializers.ModelSerializer):
    es_admin = serializers.BooleanField(read_only=True)
    persona_nombre = serializers.CharField(source='persona.nombre', read_only=True, default=None)
    permisos = serializers.SerializerMethodField()

    def get_permisos(self, obj):
        return sorted(obj.permisos)

    class Meta:
        model = User
        fields = (
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'nombre_display',
            'rol',
            'roles',
            'permisos',
            'es_admin',
            'persona',
            'persona_nombre',
            'google_conectado',
        )

    google_conectado = serializers.SerializerMethodField()

    def get_google_conectado(self, obj):
        return CuentaGoogle.objects.exists()


class UsuarioSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True, style={'input_type': 'password'})
    persona_nombre = serializers.CharField(source='persona.nombre', read_only=True, default=None)

    class Meta:
        model = User
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name', 'rol', 'roles', 'persona', 'persona_nombre',
            'is_active', 'last_login', 'date_joined', 'password',
        )
        read_only_fields = ('id', 'last_login', 'date_joined')

    def validate_roles(self, roles):
        if not isinstance(roles, list) or any(r not in ROLES_VALIDOS for r in roles):
            raise serializers.ValidationError('Rol inválido.')
        return list(dict.fromkeys(roles))

    def validate_persona(self, persona):
        if persona is None:
            return persona
        otro = User.objects.filter(persona=persona)
        if self.instance is not None:
            otro = otro.exclude(pk=self.instance.pk)
        if otro.exists():
            raise serializers.ValidationError('Esa persona ya está vinculada a otro usuario.')
        return persona

    def validate(self, attrs):
        password = attrs.get('password')
        if self.instance is None and not password:
            raise serializers.ValidationError({'password': 'La contraseña es obligatoria.'})
        if password:
            validate_password(password, user=self.instance)
        rol = attrs.get('rol', getattr(self.instance, 'rol', 'equipo'))
        roles = attrs.get('roles', getattr(self.instance, 'roles', []))
        if rol == 'admin':
            attrs['roles'] = []
        elif not roles:
            raise serializers.ValidationError({'roles': 'Elegí al menos un rol.'})
        request = self.context.get('request')
        if self.instance is not None and request and self.instance.pk == request.user.pk:
            if attrs.get('rol', self.instance.rol) != 'admin' and not self.instance.is_superuser:
                raise serializers.ValidationError({'rol': 'No podés quitarte el rol de administrador.'})
            if attrs.get('is_active') is False:
                raise serializers.ValidationError({'is_active': 'No podés desactivar tu propio usuario.'})
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class CambiarPasswordSerializer(serializers.Serializer):
    actual = serializers.CharField()
    nueva = serializers.CharField()

    def validate(self, attrs):
        user = self.context['request'].user
        if not user.check_password(attrs['actual']):
            raise serializers.ValidationError({'actual': 'La contraseña actual no es correcta.'})
        validate_password(attrs['nueva'], user=user)
        return attrs
