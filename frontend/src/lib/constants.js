export const MEDIOS_PAGO = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'mercado_pago', label: 'Mercado Pago' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'otro', label: 'Otro' },
]

export const PERIODICIDADES = [
  { value: 'mensual', label: 'Mensual' },
  { value: 'bimestral', label: 'Bimestral' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' },
]

export const PERIODICIDADES_CONTRATO = [...PERIODICIDADES, { value: 'unico', label: 'Pago único' }]

export const ESTADOS_CLIENTE = [
  { value: 'activo', label: 'Activo', tag: 'green' },
  { value: 'pausado', label: 'Pausado', tag: 'yellow' },
  { value: 'baja', label: 'Baja', tag: 'red' },
]

export const ESTADOS_COBRO = {
  pendiente: { label: 'Pendiente', tag: 'yellow' },
  parcial: { label: 'Parcial', tag: 'purple' },
  pagado: { label: 'Cobrado', tag: 'green' },
  anulado: { label: 'Anulado', tag: '' },
  vencido: { label: 'Vencido', tag: 'red' },
}

export const ESTADOS_LIQUIDACION = {
  pendiente: { label: 'Pendiente', tag: 'yellow' },
  aprobada: { label: 'Aprobada', tag: 'purple' },
  pagada: { label: 'Pagada', tag: 'green' },
  anulada: { label: 'Anulada', tag: '' },
}

export const ROLES_EQUIPO = [
  { value: 'cm', label: 'Community manager', detalle: 'Además ve las fichas de clientes (sin montos) y Estadísticas.' },
  { value: 'editor', label: 'Editor de video' },
  { value: 'disenio', label: 'Diseño' },
  { value: 'foto', label: 'Fotografía / Filmmaker' },
  { value: 'colaborador', label: 'Colaborador' },
]

export function nombreRoles(usuario) {
  if (usuario?.es_admin || usuario?.rol === 'admin') return 'Administrador'
  return (usuario?.roles ?? []).map((r) => labelDe(ROLES_EQUIPO, r)).join(' + ') || 'Equipo'
}

export const ESTADOS_TAREA = [
  { value: 'pendiente', label: 'Por hacer', tag: '' },
  { value: 'en_curso', label: 'En progreso', tag: 'purple' },
  { value: 'bloqueada', label: 'Bloqueada', tag: 'red' },
  { value: 'en_revision', label: 'En revisión', tag: 'yellow' },
  { value: 'hecha', label: 'Hecha', tag: 'green' },
]

export const PRIORIDADES = [
  { value: 'alta', label: 'Alta', tag: 'red' },
  { value: 'media', label: 'Media', tag: 'yellow' },
  { value: 'baja', label: 'Baja', tag: '' },
]

export const MODALIDADES = [
  { value: 'fijo', label: 'Fijo mensual' },
  { value: 'porcentaje', label: '% de lo cobrado al cliente' },
  { value: 'por_pieza', label: 'Por pieza' },
]

export const TIPOS_VINCULO = [
  { value: 'freelancer', label: 'Freelancer' },
  { value: 'empleado', label: 'Empleado' },
  { value: 'socio', label: 'Socio' },
]

export const PLATAFORMAS = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'otra', label: 'Otra' },
]

// Colores de evento de Google Calendar (fijos en la API).
export const COLORES_GOOGLE = [
  { value: '1', label: 'Lavanda', hex: '#a4bdfc' },
  { value: '2', label: 'Salvia', hex: '#7ae7bf' },
  { value: '3', label: 'Uva', hex: '#dbadff' },
  { value: '4', label: 'Flamenco', hex: '#ff887c' },
  { value: '5', label: 'Banana', hex: '#fbd75b' },
  { value: '6', label: 'Mandarina', hex: '#ffb878' },
  { value: '7', label: 'Pavo real', hex: '#46d6db' },
  { value: '8', label: 'Grafito', hex: '#e1e1e1' },
  { value: '9', label: 'Arándano', hex: '#5484ed' },
  { value: '10', label: 'Albahaca', hex: '#51b749' },
  { value: '11', label: 'Tomate', hex: '#dc2127' },
]

export const ETIQUETAS = [
  { value: 'operaciones', label: 'Operaciones' },
  { value: 'coberturas', label: 'Coberturas' },
  { value: 'reuniones', label: 'Reuniones & Briefing' },
  { value: 'ceos', label: 'AuraTeam CEOs', soloAdmin: true },
]

export const COLORES = ['#3b82f6', '#818cf8', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#f472b6', '#94a3b8']

export const labelDe = (lista, value) => lista.find((x) => x.value === value)?.label ?? value ?? '—'
