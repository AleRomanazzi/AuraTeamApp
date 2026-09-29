const ars = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const arsSinDecimales = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

/** Monto en pesos argentinos: $ 1.234,50 */
export function fmt(n) {
  return ars.format(Number(n) || 0)
}

/** Monto redondeado para tarjetas y gráficos: $ 1.235 */
export function fmtCorto(n) {
  return arsSinDecimales.format(Math.round(Number(n) || 0))
}

export function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return `${v > 0 ? '+' : ''}${v.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`
}

const pad = (n) => String(n).padStart(2, '0')

/** Fecha local YYYY-MM-DD (evita el corrimiento de toISOString en UTC-3). */
export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function shiftMonth(mes, delta) {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function monthLabel(mes, opts = { month: 'long', year: 'numeric' }) {
  if (!mes) return ''
  const [y, m] = mes.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('es-AR', opts)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function parseLocalDate(value) {
  if (!value) return null
  const s = String(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatFecha(value, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = parseLocalDate(value)
  return d ? d.toLocaleDateString('es-AR', opts) : '—'
}

export function formatFechaCorta(value) {
  return formatFecha(value, { day: 'numeric', month: 'short' })
}

export function formatFechaHora(value) {
  const d = parseLocalDate(value)
  if (!d) return '—'
  return `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}

export function toDatetimeLocal(value) {
  const d = value instanceof Date ? value : parseLocalDate(value)
  if (!d) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function diasHasta(value) {
  const d = parseLocalDate(value)
  if (!d) return null
  const hoy = parseLocalDate(todayISO())
  return Math.round((d - hoy) / 86400000)
}

export function parseFrom(from) {
  const m = String(from || '').match(/^"?([^"<]+)"?\s*</)
  return m ? m[1].trim() : String(from || '').split('@')[0]
}

export function iniciales(nombre) {
  return String(nombre || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}
