export const QK = {
  me: ['me'],
  transacciones: ['transacciones'],
  servicios: ['servicios'],
  personal: ['personal'],
  tareas: ['tareas'],
  personalTareas: (id) => ['personal', id, 'tareas'],
  calClientes: ['cal-clientes'],
  calEventos: ['cal-eventos'],
  stats: ['stats'],
  dashboard: (mes) => ['dashboard', mes],
  googleCal: (year, month) => ['google-calendar', year, month],
}
