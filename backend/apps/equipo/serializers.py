from rest_framework import serializers

from .models import AsignacionTarea, Persona, Tarea


class TareaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tarea
        fields = ('id', 'titulo', 'descripcion')
        read_only_fields = ('id',)


class PersonaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Persona
        fields = ('id', 'nombre', 'rol', 'color', 'contactos', 'notas')
        read_only_fields = ('id',)
