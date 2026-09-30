export const QK = {
  me: ['me'],
  dashboard: (mes) => ['dashboard', mes],
  miPanel: ['mi-panel'],
  categorias: ['categorias'],
  transacciones: (params) => ['transacciones', params],
  clientes: ['clientes'],
  cliente: (id) => ['clientes', id],
  clienteRentabilidad: (id) => ['clientes', id, 'rentabilidad'],
  clienteReporte: (id, mes) => ['clientes', id, 'reporte', mes],
  clienteEvolucion: (id, plataforma) => ['clientes', id, 'evolucion', plataforma],
  contratos: (params) => ['contratos', params],
  cobros: (params) => ['cobros', params],
  cobrosResumen: (params) => ['cobros', 'resumen', params],
  rentabilidad: (mes) => ['rentabilidad', mes],
  personal: ['personal'],
  asignaciones: (params) => ['asignaciones-cliente', params],
  liquidaciones: (params) => ['liquidaciones', params],
  liquidacionesResumen: (params) => ['liquidaciones', 'resumen', params],
  tareas: (params) => ['tareas', params],
  servicios: (mes) => ['servicios', mes],
  serviciosResumen: ['servicios', 'resumen'],
  calEventos: (params) => ['cal-eventos', params],
  vencimientos: (mes) => ['vencimientos', mes],
  stats: (params) => ['stats', params],
  usuarios: ['usuarios'],
  googleCal: (year, month) => ['google-calendar', year, month],
  googleEstado: ['google-estado'],
  notionEstado: ['notion', 'estado'],
  notionUsuarios: ['notion', 'usuarios'],
}

/** Grupos de datos que se ven afectados por un movimiento de dinero. */
export const DINERO = ['dashboard', 'transacciones', 'cobros', 'liquidaciones', 'clientes', 'rentabilidad', 'servicios', 'vencimientos', 'mi-panel']

export function invalidar(qc, grupos) {
  return Promise.all(grupos.map((g) => qc.invalidateQueries({ queryKey: [g] })))
}
