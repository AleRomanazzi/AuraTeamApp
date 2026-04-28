import { getMediaOrigin } from './media'

function contactVal(contactos, tipos) {
  const list = contactos || []
  for (const tipo of tipos) {
    const c = list.find((x) => x.tipo === tipo)
    if (c?.valor) return c.valor
  }
  return ''
}

export function personaFromApi(p) {
  const contactos = p.contactos || []
  return {
    id: p.id,
    nombre: p.nombre,
    puesto: p.rol || '',
    tel: contactVal(contactos, ['whatsapp', 'tel', 'telefono']),
    email: contactVal(contactos, ['email']),
    ig: contactVal(contactos, ['instagram', 'ig']),
    telegram: contactVal(contactos, ['telegram']),
    otro: contactVal(contactos, ['otro', 'link']),
    notas: p.notas || '',
    color: p.color || '#7c6fff',
    tareas: [],
  }
}

export function personaToApi(ui) {
  const contactos = []
  if (ui.tel) contactos.push({ tipo: 'whatsapp', valor: ui.tel })
  if (ui.email) contactos.push({ tipo: 'email', valor: ui.email })
  if (ui.ig) contactos.push({ tipo: 'instagram', valor: ui.ig })
  if (ui.telegram) contactos.push({ tipo: 'telegram', valor: ui.telegram })
  if (ui.otro) contactos.push({ tipo: 'otro', valor: ui.otro })
  return {
    nombre: ui.nombre,
    rol: ui.puesto || '',
    color: ui.color != null ? ui.color : '#7c6fff',
    contactos,
    notas: ui.notas || '',
  }
}

export function tareaFromApi(t) {
  return {
    id: t.id,
    nombre: t.titulo,
    desc: t.descripcion || '',
  }
}

export function mapTxFromApi(t) {
  const origin = getMediaOrigin()
  return {
    id: t.id,
    tipo: t.tipo,
    desc: t.descripcion,
    monto: Number(t.monto),
    fecha: t.fecha,
    cat: t.categoria,
    notas: t.notas || '',
    adjuntos: (t.adjuntos || []).map((a) => {
      const path = a.archivo
      const url = path && (path.startsWith('http') ? path : `${origin}${path}`)
      return {
        id: a.id,
        nombre: a.nombre_original,
        desc: a.nombre_original,
        dataUrl: url || '#',
        tipo: 'application/octet-stream',
      }
    }),
  }
}

export function servicioFromApi(s) {
  const d = s.detalle && typeof s.detalle === 'object' && !Array.isArray(s.detalle) ? s.detalle : {}
  const ui = d.ui || {}
  const monto = Number(s.monto_total)
  const periodo = ui.periodo || (['mensual', 'bimestral', 'anual'].includes(s.metodo) ? s.metodo : 'mensual')
  return {
    id: s.id,
    nombre: s.nombre,
    monto,
    periodo,
    personas: ui.personasLabel || '',
    fechaPago: s.fecha_pago || null,
    dia: ui.dia ?? 1,
    metodo: ui.splitMetodo || 'partes-iguales',
    detallePersonas: Array.isArray(ui.detallePersonas) ? ui.detallePersonas : [],
  }
}

export function servicioToApiPayload(ui) {
  const periodo = ui.periodo || 'mensual'
  const monto = Number(ui.monto) || 0
  const payload = {
    nombre: ui.nombre,
    monto_total: monto.toFixed(2),
    metodo: periodo,
    mi_parte: '0.00',
    detalle: {
      ui: {
        periodo,
        dia: Number(ui.dia) || 1,
        personasLabel: ui.personas || '',
        detallePersonas: ui.detallePersonas || [],
        splitMetodo: ui.metodo || 'partes-iguales',
      },
    },
  }
  if (ui.fechaPago) {
    payload.fecha_pago = ui.fechaPago
  }
  return payload
}

export function calClienteFromApi(c) {
  return {
    id: c.id,
    titulo: c.titulo,
    diaMes: c.dia_mes,
    desc: c.descripcion || '',
    monto: c.monto != null ? Number(c.monto) : null,
    color: c.color || '#4fffb0',
  }
}

export function calEventoFromApi(e) {
  return {
    id: e.id,
    titulo: e.titulo,
    inicio: e.inicio,
    fin: e.fin || null,
    desc: e.descripcion || '',
    color: e.color || '#7c6fff',
  }
}

export function meToConfig(me) {
  if (!me) {
    return {
      apiKey: '',
      clientId: '',
      gmail: '',
      moneda: '$',
      nombre: 'Yo',
      googleOauthManaged: false,
      googleLoginHint: '',
    }
  }
  return {
    apiKey: me.google_api_key || '',
    clientId: me.google_client_id || '',
    gmail: me.gmail_account || '',
    moneda: me.moneda || '$',
    nombre: me.nombre_display || 'Yo',
    googleOauthManaged: Boolean(me.google_oauth_managed),
    googleLoginHint: me.google_login_hint || '',
  }
}
