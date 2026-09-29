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

export const ESTADOS_TAREA = [
  { value: 'pendiente', label: 'Pendiente', tag: 'yellow' },
  { value: 'en_curso', label: 'En curso', tag: 'purple' },
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

export const COLORES = ['#4fffb0', '#7c6fff', '#ff6b6b', '#ffd166', '#4fc3f7', '#f06292', '#a1887f', '#90a4ae']

export const labelDe = (lista, value) => lista.find((x) => x.value === value)?.label ?? value ?? '—'
