function mapMessageMeta(r) {
  const h = r.result.payload?.headers || []
  const get = (n) => h.find((x) => x.name === n)?.value || ''
  return {
    id: r.result.id,
    subject: get('Subject'),
    from: get('From'),
    date: get('Date'),
    snippet: r.result.snippet || '',
    unread: Boolean(r.result.labelIds?.includes('UNREAD')),
  }
}

export async function listInboxMessages(maxList = 20, maxDetail = 10) {
  const res = await window.gapi.client.gmail.users.messages.list({
    userId: 'me',
    maxResults: maxList,
    labelIds: ['INBOX'],
  })
  const msgs = res.result.messages || []
  if (!msgs.length) return []
  const slice = msgs.slice(0, maxDetail)
  const responses = await Promise.all(
    slice.map((m) =>
      window.gapi.client.gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From', 'Date'],
      }),
    ),
  )
  return responses.map(mapMessageMeta)
}

function decodeB64Url(data) {
  if (!data) return ''
  const s = data.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return decodeURIComponent(escape(atob(s)))
  } catch {
    return atob(s)
  }
}

/** Convierte HTML a texto plano sin ejecutarlo ni insertarlo en el DOM de la app. */
function htmlATexto(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, head').forEach((n) => n.remove())
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'))
  doc.querySelectorAll('p, div, tr, li, h1, h2, h3, h4').forEach((n) => n.append('\n'))
  return (doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

function buscarParte(payload, mime) {
  if (!payload) return null
  if (payload.mimeType === mime && payload.body?.data) return payload.body.data
  for (const p of payload.parts || []) {
    const r = buscarParte(p, mime)
    if (r) return r
  }
  return null
}

export function extractPlainBodyFromPayload(payload) {
  if (!payload) return '(Sin cuerpo)'
  const plano = buscarParte(payload, 'text/plain')
  if (plano) return decodeB64Url(plano)
  const html = buscarParte(payload, 'text/html')
  if (html) return htmlATexto(decodeB64Url(html))
  if (payload.body?.data) {
    const s = decodeB64Url(payload.body.data)
    return /<[a-z][\s\S]*>/i.test(s) ? htmlATexto(s) : s
  }
  return '(No se puede mostrar el cuerpo del correo)'
}

export async function getMessageFull(id) {
  const r = await window.gapi.client.gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full',
  })
  const h = r.result.payload?.headers || []
  const get = (n) => h.find((x) => x.name === n)?.value || ''
  const body = extractPlainBodyFromPayload(r.result.payload)
  return {
    id: r.result.id,
    subject: get('Subject') || '(Sin asunto)',
    from: get('From'),
    date: get('Date'),
    body,
    snippet: r.result.snippet || '',
  }
}

function subjectRfc2047Utf8(s) {
  const b64 = btoa(unescape(encodeURIComponent(s)))
  return `=?UTF-8?B?${b64}?=`
}

const sinSaltos = (s) => String(s || '').replace(/[\r\n]+/g, ' ').trim()

export async function sendMessage({ to, subject, body }) {
  const lines = [
    `To: ${sinSaltos(to)}`,
    `Subject: ${subjectRfc2047Utf8(sinSaltos(subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(body))),
  ]
  const raw = btoa(unescape(encodeURIComponent(lines.join('\r\n'))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  await window.gapi.client.gmail.users.messages.send({
    userId: 'me',
    resource: { raw },
  })
}
