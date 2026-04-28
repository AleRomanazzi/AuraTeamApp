/** Igual que `fmt` del HTML (`AURA_TEAM_V4.html`). */
export function fmt(n, cur = '$') {
  const v = Number(n) || 0
  return `${cur}${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('es', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export function parseFrom(from) {
  const m = from.match(/^"?([^"<]+)"?\s*</)
  return m ? m[1].trim() : from.split('@')[0]
}
