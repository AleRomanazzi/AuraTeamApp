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

/** Día local YYYY-MM-DD de una fecha o datetime ISO. */
export function diaDe(value) {
  const d = parseLocalDate(value)
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''
}

export function horaDe(value) {
  return /T\d{2}:\d{2}/.test(String(value)) ? new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
}

export function sumarDias(dia, n) {
  const d = parseLocalDate(dia)
  d.setDate(d.getDate() + n)
  return diaDe(d)
}

/** Lunes de la semana del día dado. */
export function lunesDe(dia) {
  const d = parseLocalDate(dia)
  return sumarDias(dia, -((d.getDay() + 6) % 7))
}

/** Celdas de un mes (YYYY-MM) empezando en lunes; null en los huecos. */
export function celdasMes(mes) {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  const arr = Array.from({ length: (new Date(y, m - 1, 1).getDay() + 6) % 7 }, () => null)
  for (let d = 1; d <= ultimo; d++) arr.push(`${mes}-${pad(d)}`)
  while (arr.length % 7) arr.push(null)
  return arr
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
