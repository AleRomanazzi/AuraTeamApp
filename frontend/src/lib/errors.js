const CAMPOS = {
  detail: '',
  non_field_errors: '',
  monto: 'Monto',
  fecha: 'Fecha',
  categoria: 'Categoría',
  nombre: 'Nombre',
  titulo: 'Título',
  password: 'Contraseña',
  periodo: 'Período',
  mes: 'Mes',
  fin: 'Fin',
  detalle: 'Reparto',
  mi_parte: 'Parte de la agencia',
}

function aplanar(valor) {
  if (Array.isArray(valor)) return valor.map(aplanar).join(' ')
  if (valor && typeof valor === 'object') return Object.values(valor).map(aplanar).join(' ')
  return String(valor ?? '')
}

/** Convierte un error de axios/DRF en un mensaje legible en castellano. */
export function apiErrorMessage(error, fallback = 'Ocurrió un error. Probá de nuevo.') {
  if (!error) return fallback
  const res = error.response
  if (!res) {
    if (error.code === 'ECONNABORTED') return 'El servidor tardó demasiado en responder.'
    if (error.message === 'Network Error') return 'Sin conexión con el servidor. Revisá tu internet.'
    return error.message || fallback
  }
  if (res.status === 429) return 'Demasiados intentos. Esperá un minuto y volvé a probar.'
  if (res.status === 403) return res.data?.detail || 'No tenés permiso para esta acción.'
  if (res.status === 404) return 'No se encontró el registro (puede que ya se haya borrado).'
  if (res.status >= 500) return 'Error del servidor. Si se repite, avisá al equipo técnico.'
  const data = res.data
  if (typeof data === 'string') return fallback
  if (data && typeof data === 'object') {
    const partes = Object.entries(data).map(([k, v]) => {
      const etiqueta = CAMPOS[k] ?? k
      const texto = aplanar(v)
      return etiqueta ? `${etiqueta}: ${texto}` : texto
    })
    if (partes.length) return partes.join(' · ')
  }
  return fallback
}
