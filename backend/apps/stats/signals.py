from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import ImagenAnalisis


@receiver(post_delete, sender=ImagenAnalisis)
def borrar_archivo_imagen(sender, instance, **kwargs):
    if instance.archivo:
        instance.archivo.delete(save=False)
