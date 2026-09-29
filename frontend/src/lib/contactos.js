export const TIPOS_CONTACTO = [
  { tipo: 'whatsapp', label: 'WhatsApp', alias: ['whatsapp', 'tel', 'telefono'] },
  { tipo: 'email', label: 'Email', alias: ['email'] },
  { tipo: 'instagram', label: 'Instagram', alias: ['instagram', 'ig'] },
  { tipo: 'telegram', label: 'Telegram', alias: ['telegram'] },
  { tipo: 'otro', label: 'Otro', alias: ['otro', 'link'] },
]

export function contactosAObjeto(lista) {
  const obj = {}
  TIPOS_CONTACTO.forEach(({ tipo, alias }) => {
    obj[tipo] = alias.map((a) => (lista || []).find((c) => c.tipo === a)?.valor).find(Boolean) || ''
  })
  return obj
}

export function objetoAContactos(obj) {
  return TIPOS_CONTACTO.filter(({ tipo }) => String(obj[tipo] || '').trim()).map(({ tipo }) => ({ tipo, valor: String(obj[tipo]).trim() }))
}

export function linkContacto(tipo, valor) {
  const v = String(valor || '').trim()
  if (!v) return null
  if (tipo === 'whatsapp') return `https://wa.me/${v.replace(/\D/g, '')}`
  if (tipo === 'email') return `mailto:${v}`
  if (tipo === 'instagram') return `https://instagram.com/${v.replace('@', '')}`
  if (tipo === 'telegram') return `https://t.me/${v.replace('@', '')}`
  return /^https?:\/\//i.test(v) ? v : null
}
