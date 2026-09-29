/** Convierte "1.234,56" / "1234.56" / "1234,5" a "1234.56". Devuelve '' si no hay número. */
export function normalizarMonto(texto) {
  let s = String(texto ?? '').replace(/[^\d.,-]/g, '')
  if (!s) return ''
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) {
    s = s.replace(/\./g, '')
  }
  const n = Number(s)
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : ''
}

export const num = (v) => Number(v) || 0

/** Reparte `total` en `partes` montos que suman exacto (el último absorbe el redondeo). */
export function repartirIgual(total, partes) {
  if (!partes) return []
  const base = Math.floor((num(total) / partes) * 100) / 100
  const arr = Array.from({ length: partes }, () => base)
  arr[partes - 1] = Math.round((num(total) - base * (partes - 1)) * 100) / 100
  return arr
}
