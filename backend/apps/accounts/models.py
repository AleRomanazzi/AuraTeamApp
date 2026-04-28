from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    moneda = models.CharField(max_length=4, default="$")
    nombre_display = models.CharField(max_length=80, default="Yo")
    google_api_key = models.TextField(blank=True)
    google_client_id = models.TextField(blank=True)
    gmail_account = models.EmailField(blank=True)
    google_connected = models.BooleanField(default=False)
