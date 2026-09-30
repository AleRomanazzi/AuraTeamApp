from rest_framework import permissions


def es_admin(user) -> bool:
    return bool(user and user.is_authenticated and (user.is_superuser or getattr(user, 'rol', '') == 'admin'))


def tiene_permiso(user, permiso: str) -> bool:
    if es_admin(user):
        return True
    return bool(user and user.is_authenticated and permiso in getattr(user, 'permisos', set()))


def persona_de(user):
    return getattr(user, 'persona', None) if user and user.is_authenticated else None


def requiere_permiso(permiso: str):
    """Permiso DRF: admin o un rol que habilite `permiso` (ver PERMISOS_POR_ROL)."""

    class TienePermiso(permissions.BasePermission):
        message = 'Tu rol no tiene acceso a esta sección.'

        def has_permission(self, request, view):
            return tiene_permiso(request.user, permiso)

    TienePermiso.__name__ = f'TienePermiso_{permiso}'
    return TienePermiso


class IsAdmin(permissions.BasePermission):
    message = 'Solo un administrador puede realizar esta acción.'

    def has_permission(self, request, view):
        return es_admin(request.user)


class IsAdminOrReadOnly(permissions.BasePermission):
    message = 'Solo un administrador puede modificar estos datos.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return es_admin(request.user)
