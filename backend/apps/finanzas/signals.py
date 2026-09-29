from decimal import Decimal

from django.db.models.signals import post_delete, pre_delete
from django.dispatch import receiver

from .models import AdjuntoTransaccion, Transaccion


@receiver(post_delete, sender=AdjuntoTransaccion)
def borrar_archivo_adjunto(sender, instance, **kwargs):
    if instance.archivo:
        instance.archivo.delete(save=False)


@receiver(pre_delete, sender=Transaccion)
def desvincular_origen(sender, instance, **kwargs):
    """Si se borra el movimiento de un cobro o liquidación, ese registro vuelve a quedar pendiente."""
    from apps.clientes.models import Cobro
    from apps.equipo.models import Liquidacion

    Cobro.objects.filter(transaccion=instance).exclude(estado='anulado').update(
        transaccion=None, monto_cobrado=Decimal('0'), fecha_pago=None, estado='pendiente'
    )
    Liquidacion.objects.filter(transaccion=instance, estado='pagada').update(
        transaccion=None, fecha_pago=None, estado='aprobada'
    )
