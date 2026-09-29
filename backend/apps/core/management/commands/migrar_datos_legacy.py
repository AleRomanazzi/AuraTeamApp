"""Reorganiza los datos cargados con la lógica anterior (servicios = repartos por cobro, ingresos
en 'Salario') en clientes, contratos, cobros y liquidaciones pagadas. Pensado para correr una sola vez.

Sin --aplicar corre dentro de una transacción que se revierte al final (simulación)."""

from datetime import date
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count, Sum

from apps.clientes.models import Cliente, Cobro, Contrato
from apps.equipo.models import AsignacionCliente, Liquidacion, Persona
from apps.finanzas.models import Categoria, Transaccion
from apps.servicios.models import Servicio

D = Decimal

TX_ESPERADAS = {
    1: ('2026-04-25', '570000'), 2: ('2026-04-21', '350000'), 3: ('2026-04-21', '390000'),
    4: ('2026-03-09', '14637'), 5: ('2026-04-29', '80000'), 6: ('2026-04-29', '300000'),
    7: ('2026-05-05', '350000'), 8: ('2026-03-26', '14163.82'), 9: ('2026-05-02', '14316.67'),
    10: ('2026-05-21', '390000'), 11: ('2026-05-20', '350000'), 12: ('2026-06-18', '460000'),
    13: ('2026-06-16', '300000'), 14: ('2026-06-02', '570000'), 15: ('2026-06-24', '31041'),
    16: ('2026-06-25', '390000'), 17: ('2026-06-25', '350000'), 18: ('2026-07-06', '570000'),
    19: ('2026-07-25', '390000'), 20: ('2026-08-26', '390000'), 21: ('2026-09-08', '570000'),
}
SERVICIOS_LEGACY = [3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21]

CLIENTES = {
    'cycles': dict(nombre='CyclesFerreyra', estado='activo', fecha_alta=date(2026, 5, 1), color='#4fffb0'),
    'paula': dict(nombre='Paula Moyano', estado='baja', fecha_alta=date(2026, 4, 1), color='#f06292'),
    'haut': dict(nombre='Clínica Haut', estado='baja', fecha_alta=date(2026, 6, 1), color='#4fc3f7'),
    'lalina': dict(
        nombre='Cabañas Lalina', contacto='Yanina Chapartegui', estado='baja',
        fecha_alta=date(2026, 6, 1), color='#81c784',
    ),
    'karina': dict(
        nombre='Karina Santellan', estado='baja', fecha_alta=date(2026, 4, 29), color='#ffd166',
        notas='Proyectos puntuales (SerUrbano / cine).',
    ),
    'lennon': dict(
        nombre='Redes Lennon', estado='activo', fecha_alta=date(2026, 9, 10), color='#7c6fff',
        notas='Retomó el 10/09/2026.',
    ),
}

# clave: (cliente, concepto, categoría, monto, periodicidad, día, inicio, fin, activo)
CONTRATOS = {
    'cycles': ('cycles', 'Gestión mensual', 'Fee mensual', '570000', 'mensual', 5, date(2026, 5, 1), None, True),
    'redes': ('paula', 'Gestión de redes sociales', 'Fee mensual', '390000', 'mensual', 21,
              date(2026, 4, 1), date(2026, 8, 31), False),
    'ads': ('paula', 'Meta Ads y pauta publicitaria', 'Gestión de Ads', '350000', 'mensual', 21,
            date(2026, 4, 1), date(2026, 6, 30), False),
    'haut': ('haut', 'Meta Ads', 'Gestión de Ads', '300000', 'mensual', 16,
             date(2026, 6, 1), date(2026, 6, 30), False),
    'lalina': ('lalina', 'Creación de contenido', 'Producción de contenido', '460000', 'mensual', 18,
               date(2026, 6, 1), date(2026, 6, 30), False),
    'corto': ('karina', 'Cortometraje SerUrbano', 'Proyecto puntual', '300000', 'unico', 29,
              date(2026, 4, 29), date(2026, 4, 29), False),
    'cobertura': ('karina', 'Cobertura preestreno en el cine', 'Proyecto puntual', '350000', 'unico', 5,
                  date(2026, 5, 5), date(2026, 5, 5), False),
    'lennon': ('lennon', 'Gestión de redes', 'Fee mensual', '650000', 'mensual', 10, date(2026, 9, 10), None, True),
    'tiendanube': ('lennon', 'Optimización Tiendanube', 'Web', '100000', 'unico', 10,
                   date(2026, 9, 10), date(2026, 9, 10), False),
}

# Cobros que no estaban cargados en el sistema: (contrato, fecha de pago, período, descripción)
COBROS_NUEVOS = [
    ('lennon', date(2026, 9, 10), '2026-09', 'Redes Lennon — Septiembre'),
    ('tiendanube', date(2026, 9, 10), '2026-09', 'Redes Lennon — Optimización Tiendanube'),
]

# Equipo de referencia de los contratos activos (se usa como sugerencia al repartir)
ASIGNACIONES = {
    'cycles': [('Andrés Reynoso', '310000'), ('Lautaro Fuentes', '200000'), ('Alejandro Romanazzi', '60000')],
    'lennon': [('Lautaro Fuentes', '300000'), ('Andrés Reynoso', '290000'), ('Alejandro Romanazzi', '60000')],
}

# Repartos pagados de cobros que no estaban en el sistema: (contrato, período, [(persona, monto)])
REPARTOS_NUEVOS = [
    ('lennon', '2026-09', ASIGNACIONES['lennon']),
    ('tiendanube', '2026-09', [('Alejandro Romanazzi', '100000')]),
]

# (transacción de ingreso, contrato, período)
COBROS_PAGADOS = [
    (1, 'cycles', '2026-05'), (14, 'cycles', '2026-06'), (18, 'cycles', '2026-07'), (21, 'cycles', '2026-09'),
    (3, 'redes', '2026-04'), (10, 'redes', '2026-05'), (16, 'redes', '2026-06'),
    (19, 'redes', '2026-07'), (20, 'redes', '2026-08'),
    (2, 'ads', '2026-04'), (11, 'ads', '2026-05'), (17, 'ads', '2026-06'),
    (13, 'haut', '2026-06'), (12, 'lalina', '2026-06'),
    (6, 'corto', '2026-04'), (7, 'cobertura', '2026-05'),
]

# (servicio con el reparto, transacción de ingreso, contrato, período)
REPARTOS = [
    (3, 1, 'cycles', '2026-05'), (11, 14, 'cycles', '2026-06'), (16, 18, 'cycles', '2026-07'),
    (19, 21, 'cycles', '2026-09'),
    (4, 3, 'redes', '2026-04'), (9, 10, 'redes', '2026-05'), (14, 16, 'redes', '2026-06'),
    (17, 19, 'redes', '2026-07'), (20, 20, 'redes', '2026-08'),
    (6, 2, 'ads', '2026-04'), (10, 11, 'ads', '2026-05'), (15, 17, 'ads', '2026-06'),
    (12, 13, 'haut', '2026-06'), (13, 12, 'lalina', '2026-06'),
    (8, 6, 'corto', '2026-04'), (7, 7, 'cobertura', '2026-05'),
]
ALIAS_PERSONA = {'Persona 3': 'Andrés Reynoso'}
TX_RUBEN_CORTO = 5
TX_SOFTWARE = [4, 8, 9, 15]
CATEGORIAS_LEGACY = ['Salario', 'Servicios', 'Inversión']


class Command(BaseCommand):
    help = 'Reorganiza los datos cargados con la lógica anterior (una sola vez).'

    def add_arguments(self, parser):
        parser.add_argument('--aplicar', action='store_true', help='Guarda los cambios (sin esto, simula).')

    def handle(self, *args, aplicar=False, **opts):
        if Cliente.objects.filter(nombre='CyclesFerreyra').exists():
            raise CommandError('Ya hay clientes migrados: el comando no se vuelve a correr.')
        with transaction.atomic():
            self._verificar()
            self._migrar()
            self._resumen()
            if not aplicar:
                transaction.set_rollback(True)
                self.stdout.write(self.style.WARNING('\nSIMULACIÓN: no se guardó nada. Usá --aplicar.'))
            else:
                self.stdout.write(self.style.SUCCESS('\nCambios guardados.'))

    def _verificar(self):
        errores = []
        txs = Transaccion.objects.in_bulk(TX_ESPERADAS.keys())
        for pk, (fecha, monto) in TX_ESPERADAS.items():
            tx = txs.get(pk)
            if tx is None or str(tx.fecha) != fecha or tx.monto != D(monto):
                errores.append(f'Transacción {pk} no coincide ({fecha} ${monto}).')
        faltan = set(SERVICIOS_LEGACY) - set(Servicio.objects.filter(id__in=SERVICIOS_LEGACY).values_list('id', flat=True))
        if faltan:
            errores.append(f'Faltan servicios {sorted(faltan)}.')
        if errores:
            raise CommandError('Los datos cambiaron desde el análisis:\n' + '\n'.join(errores))

    def _cat(self, nombre, tipo):
        return Categoria.objects.get(nombre=nombre, tipo=tipo)

    def _persona(self, nombre):
        return Persona.objects.get(nombre=ALIAS_PERSONA.get(nombre, nombre))

    def _migrar(self):
        txs = Transaccion.objects.in_bulk(TX_ESPERADAS.keys())
        clientes = {k: Cliente.objects.create(**v) for k, v in CLIENTES.items()}

        contratos = {}
        for clave, (cli, concepto, cat, monto, per, dia, inicio, fin, activo) in CONTRATOS.items():
            contratos[clave] = Contrato.objects.create(
                cliente=clientes[cli], concepto=concepto, categoria=self._cat(cat, 'ingreso'), monto=D(monto),
                periodicidad=per, dia_vencimiento=dia, fecha_inicio=inicio, fecha_fin=fin, activo=activo,
            )

        for tx_id, clave, periodo in COBROS_PAGADOS:
            tx, c = txs[tx_id], contratos[clave]
            tx.cliente, tx.categoria = c.cliente, c.categoria
            tx.save(update_fields=['cliente', 'categoria'])
            Cobro.objects.create(
                cliente=c.cliente, contrato=c, periodo=periodo, concepto=c.concepto, monto=tx.monto,
                vencimiento=tx.fecha, monto_cobrado=tx.monto, fecha_pago=tx.fecha, estado='pagado', transaccion=tx,
            )

        cycles = contratos['cycles']
        Cobro.objects.create(
            cliente=cycles.cliente, contrato=cycles, periodo='2026-08', concepto=cycles.concepto,
            monto=cycles.monto, vencimiento=date(2026, 8, 5),
            notas='Probablemente cobrado pero no registrado: cargar el pago con su comprobante.',
        )

        ingresos_nuevos = {}
        for clave, fecha, periodo, descripcion in COBROS_NUEVOS:
            c = contratos[clave]
            tx = Transaccion.objects.create(
                fecha=fecha, descripcion=descripcion, categoria=c.categoria, tipo='ingreso', monto=c.monto,
                cliente=c.cliente,
            )
            Cobro.objects.create(
                cliente=c.cliente, contrato=c, periodo=periodo, concepto=c.concepto, monto=c.monto,
                vencimiento=fecha, monto_cobrado=c.monto, fecha_pago=fecha, estado='pagado', transaccion=tx,
            )
            ingresos_nuevos[clave] = tx

        for clave, filas in ASIGNACIONES.items():
            for nombre, valor in filas:
                AsignacionCliente.objects.create(
                    persona=self._persona(nombre), cliente=contratos[clave].cliente, modalidad='fijo', valor=D(valor),
                )

        servicios = Servicio.objects.in_bulk(SERVICIOS_LEGACY)
        pendientes = []
        for serv_id, tx_id, clave, periodo in REPARTOS:
            filas = [(f['nombre'], f['monto']) for f in servicios[serv_id].detalle]
            pendientes.append((clave, periodo, txs[tx_id], filas))
        for clave, periodo, filas in REPARTOS_NUEVOS:
            pendientes.append((clave, periodo, ingresos_nuevos[clave], filas))

        honorarios = self._cat('Honorarios del equipo', 'egreso')
        for clave, periodo, ingreso, filas in pendientes:
            c = contratos[clave]
            filas = [(self._persona(n), D(str(m))) for n, m in filas if D(str(m)) > 0]
            suma = sum(m for _, m in filas)
            if suma != ingreso.monto:
                self.stdout.write(self.style.WARNING(
                    f'  Reparto de "{c.concepto}" {periodo} suma ${suma} y el cobro fue ${ingreso.monto}.'
                ))
            concepto = f'{c.cliente.nombre} — {c.concepto}'
            for persona, monto in filas:
                if clave == 'corto' and persona.nombre == 'Rubén Carrizo':
                    tx = txs[TX_RUBEN_CORTO]
                    tx.categoria, tx.persona, tx.cliente = honorarios, persona, c.cliente
                    tx.save(update_fields=['categoria', 'persona', 'cliente'])
                else:
                    tx = Transaccion.objects.create(
                        fecha=ingreso.fecha, descripcion=f'Honorarios {persona.nombre} — {concepto} ({periodo})'[:200],
                        categoria=honorarios, tipo='egreso', monto=monto, persona=persona, cliente=c.cliente,
                    )
                Liquidacion.objects.create(
                    persona=persona, periodo=periodo, concepto=concepto[:200], cliente=c.cliente, origen='manual',
                    monto_base=monto, total=monto, estado='pagada', fecha_pago=ingreso.fecha, transaccion=tx,
                )

        software = self._cat('Software y suscripciones', 'egreso')
        Transaccion.objects.filter(id__in=TX_SOFTWARE).update(categoria=software)
        Servicio.objects.filter(id__in=SERVICIOS_LEGACY).delete()
        Servicio.objects.create(
            nombre='Google Drive', proveedor='Google', monto_total=D('14316.67'), periodicidad='mensual',
            dia_vencimiento=2, categoria=software, generar_egreso=True,
        )
        Servicio.objects.create(
            nombre='Claude', proveedor='Anthropic', monto_total=D('40500'), periodicidad='mensual',
            dia_vencimiento=24, categoria=software, generar_egreso=True,
        )
        Categoria.objects.filter(nombre__in=CATEGORIAS_LEGACY, transacciones__isnull=True).delete()

    def _resumen(self):
        w = self.stdout.write
        w('\n== Movimientos por tipo')
        for r in Transaccion.objects.values('tipo').annotate(n=Count('id'), s=Sum('monto')).order_by('tipo'):
            w(f"  {r['tipo']:8} {r['n']:3}  ${r['s']:,.2f}")
        w('== Movimientos por categoría')
        for r in Transaccion.objects.values('categoria__nombre', 'tipo').annotate(n=Count('id'), s=Sum('monto')).order_by('tipo', '-s'):
            w(f"  {r['tipo']:8} {r['categoria__nombre']:28} {r['n']:3}  ${r['s']:,.2f}")
        w('== Por cliente (ingresos / honorarios / margen)')
        for c in Cliente.objects.order_by('nombre'):
            ing = c.transacciones.filter(tipo='ingreso').aggregate(s=Sum('monto'))['s'] or D(0)
            egr = c.transacciones.filter(tipo='egreso').aggregate(s=Sum('monto'))['s'] or D(0)
            w(f'  {c.nombre:20} {c.estado:7} ${ing:>12,.2f}  ${egr:>12,.2f}  ${ing - egr:>12,.2f}')
        w('== Liquidaciones pagadas por persona')
        for r in Liquidacion.objects.values('persona__nombre').annotate(n=Count('id'), s=Sum('total')).order_by('-s'):
            w(f"  {r['persona__nombre']:22} {r['n']:3}  ${r['s']:,.2f}")
        w('== Cobros: ' + ', '.join(f"{r['estado']}={r['n']}" for r in Cobro.objects.values('estado').annotate(n=Count('id'))))
        w('== Suscripciones: ' + ', '.join(Servicio.objects.values_list('nombre', flat=True)))
        w('== Asignaciones: ' + ', '.join(f'{a.persona.nombre} ${a.valor:,.0f}' for a in AsignacionCliente.objects.select_related('persona')))
