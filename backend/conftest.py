import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient


@pytest.fixture
def user(db):
    User = get_user_model()
    return User.objects.create_user(username='testuser', password='testpass1234', email='test@example.com')


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client
