/** Acepta `1234.56`, `1234,56`, `1.234,56` (miles), espacios; devuelve 0 si no es un número finito. */
export function parseAmountLoose(raw) {
  if (raw == null || raw === '') return 0
  let s = String(raw).trim().replace(/\s/g, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, '')
  } else if (lastComma !== -1) {
    s = s.replace(',', '.')
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

export function roundMoney2(x) {
  return Math.round(x * 100) / 100
}

/** Reparte `total` en `n` montos que suman exactamente al céntimo. */
export function splitMoneyExact(total, n) {
  const cents = Math.round(parseAmountLoose(total) * 100)
  const nn = Math.max(1, Math.min(100, Math.floor(Number(n)) || 1))
  if (cents < 0) return Array.from({ length: nn }, () => 0)
  const base = Math.floor(cents / nn)
  const rem = cents - base * nn
  return Array.from({ length: nn }, (_, i) => (base + (i < rem ? 1 : 0)) / 100)
}

/** Porcentajes por defecto que suman 100.00 (2 decimales). */
export function splitPctHundredExact(n) {
  const nn = Math.max(1, Math.min(100, Math.floor(Number(n)) || 1))
  const cents = 10000
  const base = Math.floor(cents / nn)
  const rem = cents - base * nn
  return Array.from({ length: nn }, (_, i) => (base + (i < rem ? 1 : 0)) / 100)
}

/** Equivalente mensual del monto según periodicidad del servicio. */
export function monthlyEquivalentMonto(monto, periodo) {
  const p = String(periodo || 'mensual').toLowerCase()
  const m = Number(monto) || 0
  if (p.includes('bimestral')) return m / 2
  if (p.includes('anual')) return m / 12
  return m
}

export function normPersonName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
}
