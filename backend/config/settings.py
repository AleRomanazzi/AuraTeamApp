import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


# Cuenta de Google de la agencia (Gmail y Calendar), conectada una sola vez desde Configuración.
# El redirect URI debe estar autorizado en el cliente OAuth de Google Cloud.
AURA_GOOGLE_CLIENT_ID = os.getenv("AURA_GOOGLE_CLIENT_ID", "").strip()
AURA_GOOGLE_CLIENT_SECRET = os.getenv("AURA_GOOGLE_CLIENT_SECRET", "").strip()
AURA_GOOGLE_REDIRECT_URI = os.getenv("AURA_GOOGLE_REDIRECT_URI", "").strip()
AURA_GOOGLE_LOGIN_HINT = os.getenv("AURA_GOOGLE_LOGIN_HINT", "").strip()
# Clave para cifrar el refresh token; si falta se deriva de SECRET_KEY (cambiarla obliga a reconectar).
AURA_GOOGLE_TOKEN_KEY = os.getenv("AURA_GOOGLE_TOKEN_KEY", "").strip()
# Para probar en local contra la cuenta real sin escribir en sus calendarios.
GOOGLE_CALENDAR_SOLO_LECTURA = os.getenv("GOOGLE_CALENDAR_SOLO_LECTURA", "").strip().lower() in ("1", "true", "si")
FRONTEND_URL = os.getenv("FRONTEND_URL", "").strip().rstrip("/")

# Notion (integración interna del workspace AuraTeam). Los IDs son de las fuentes de datos (data sources) de las
# bases Tareas y Clientes; la integración tiene que estar agregada en "Conexiones" de ambas.
NOTION_TOKEN = os.getenv("NOTION_TOKEN", "").strip()
NOTION_TAREAS_DS = os.getenv("NOTION_TAREAS_DS", "b67f1243-7f10-480c-bb2e-158c7fd75196").strip()
NOTION_TAREAS_PRIVADAS_DS = os.getenv("NOTION_TAREAS_PRIVADAS_DS", "845fb2f7-9b20-4c21-bd0a-a255025d5de9").strip()
NOTION_CLIENTES_DS = os.getenv("NOTION_CLIENTES_DS", "4f207fc3-c612-4a54-959b-773e4a71b949").strip()

DEBUG = env_bool("DEBUG", False)
TESTING = "pytest" in sys.modules
# Render define RENDER=true en todos sus servicios.
IS_PRODUCTION = env_bool("RENDER", False) or os.getenv("DJANGO_ENV", "").lower() == "production"
# Emails (Gmail de la agencia): fuera de producción solo se registran en el log, salvo EMAILS_SOLO_LOG=0.
EMAILS_SOLO_LOG = env_bool("EMAILS_SOLO_LOG", not IS_PRODUCTION)
# Token que manda el cron externo (GitHub Actions) a /api/cron/.
CRON_TOKEN = os.getenv("CRON_TOKEN", "").strip()

SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if not SECRET_KEY:
    if IS_PRODUCTION:
        raise ImproperlyConfigured("SECRET_KEY es obligatoria en producción.")
    SECRET_KEY = "dev-only-insecure-key-no-usar-en-produccion"
elif IS_PRODUCTION and len(SECRET_KEY) < 40:
    import warnings

    warnings.warn("SECRET_KEY tiene menos de 40 caracteres; generá una más larga en Render.", stacklevel=1)

ALLOWED_HOSTS = [h.strip() for h in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1").split(",") if h.strip()]
RENDER_HOST = os.getenv("RENDER_EXTERNAL_HOSTNAME")
if RENDER_HOST:
    ALLOWED_HOSTS.append(RENDER_HOST)


INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'apps.core',
    'apps.accounts',
    'apps.finanzas',
    'apps.clientes',
    'apps.servicios',
    'apps.equipo',
    'apps.calendario',
    'apps.stats',
    'apps.integraciones',
    'apps.notificaciones',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


if os.getenv("DATABASE_URL"):
    DATABASES = {
        "default": dj_database_url.parse(
            os.getenv("DATABASE_URL", ""),
            conn_max_age=600,
            conn_health_checks=True,
            ssl_require=True,
        )
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]


LANGUAGE_CODE = 'es-ar'
TIME_ZONE = 'America/Argentina/Buenos_Aires'
USE_I18N = True
USE_TZ = True


STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
MEDIA_URL = os.getenv("MEDIA_URL", "/media/")
MEDIA_ROOT = os.getenv("MEDIA_ROOT", str(BASE_DIR / "media"))

# Almacenamiento de archivos: S3-compatible (Neon Object Storage, Cloudflare R2, AWS S3) si hay bucket configurado.
# El disco de Render es efímero: sin bucket, los adjuntos se pierden en cada deploy.
S3_BUCKET = os.getenv("S3_BUCKET", "").strip()
if S3_BUCKET:
    DEFAULT_FILE_STORAGE_BACKEND = {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": S3_BUCKET,
            "endpoint_url": os.getenv("S3_ENDPOINT_URL") or None,
            "access_key": os.getenv("S3_ACCESS_KEY_ID", ""),
            "secret_key": os.getenv("S3_SECRET_ACCESS_KEY", ""),
            "region_name": os.getenv("S3_REGION") or None,
            "default_acl": None,
            "querystring_auth": True,
            "querystring_expire": 3600,
            "file_overwrite": False,
            "signature_version": "s3v4",
            "addressing_style": os.getenv("S3_ADDRESSING_STYLE", "path"),
        },
    }
else:
    DEFAULT_FILE_STORAGE_BACKEND = {"BACKEND": "django.core.files.storage.FileSystemStorage"}

STORAGES = {
    "default": DEFAULT_FILE_STORAGE_BACKEND,
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if TESTING
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    },
}

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_USER_MODEL = 'accounts.User'

CORS_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.OptionalPageNumberPagination",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.ScopedRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "login": os.getenv("THROTTLE_LOGIN", "5/min"),
        "ia": os.getenv("THROTTLE_IA", "30/hour"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "aurateam"},
}

FILE_UPLOAD_MAX_MEMORY_SIZE = 11 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 110 * 1024 * 1024

# IA: el análisis corre en un hilo aparte para no bloquear el request (evita el timeout de gunicorn).
AI_ASYNC = env_bool("AI_ASYNC", not TESTING)

if IS_PRODUCTION:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", str(60 * 60 * 24 * 30)))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    X_FRAME_OPTIONS = "DENY"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
    "loggers": {"django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}
