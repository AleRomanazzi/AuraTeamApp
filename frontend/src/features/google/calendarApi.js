/**
 * Lista eventos de Google Calendar para un mes (vista mensual local).
 *
 * Incluye todos los calendarios que el usuario tiene visibles en Google (calendarList:
 * no ocultos, no desmarcados con `selected: false`), no solo `primary`. Así se alinea
 * con la vista web cuando tenés AuraTeam, Tasks, Trabajo, feriados, etc.
 *
 * `events.list` (v3):
 * - timeMin: exclusivo sobre FIN del evento.
 * - timeMax: exclusivo sobre INICIO.
 */

function userTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** RFC3339 con offset de la zona local (Google compara bien con el calendario que ve el usuario). */
function toRFC3339Local(d) {
  const pad = (n) => String(n).padStart(2, '0')
  const y = d.getFullYear()
  const mo = pad(d.getMonth() + 1)
  const da = pad(d.getDate())
  const h = pad(d.getHours())
  const mi = pad(d.getMinutes())
  const se = pad(d.getSeconds())
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  const oh = pad(Math.floor(abs / 60))
  const om = pad(abs % 60)
  return `${y}-${mo}-${da}T${h}:${mi}:${se}${sign}${oh}:${om}`
}

/** Lista una página; el cliente gapi devuelve { result } con la forma del discovery. */
async function listEventsPage(params) {
  return window.gapi.client.calendar.events.list(params)
}

async function listAllCalendarEntries() {
  const out = []
  let pageToken
  do {
    const r = await window.gapi.client.calendar.calendarList.list({
      maxResults: 250,
      pageToken: pageToken || undefined,
      minAccessRole: 'reader',
    })
    const body = r?.result ?? r
    const items = Array.isArray(body?.items) ? body.items : []
    out.push(...items)
    pageToken = body?.nextPageToken
  } while (pageToken)
  return out
}

function calendarEntryVisible(c) {
  if (!c?.id) return false
  if (c.hidden === true) return false
  if (c.accessRole === 'none') return false
  if (c.selected === false) return false
  return true
}

async function listEventsOneCalendar(calendarId, timeMin, timeMax, timeZone) {
  const allItems = []
  let pageToken
  do {
    const r = await listEventsPage({
      calendarId,
      timeMin,
      timeMax,
      timeZone,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 500,
      pageToken: pageToken || undefined,
    })
    const body = r?.result ?? r
    const items = Array.isArray(body?.items) ? body.items : []
    allItems.push(...items)
    pageToken = body?.nextPageToken
  } while (pageToken)
  return allItems
}

function mapGoogleEventToUi(e, calId, calSummary) {
  let inicio = ''
  if (e.start?.date && !e.start?.dateTime) {
    inicio = e.start.date
  } else if (e.start?.dateTime) {
    inicio = e.start.dateTime
  }
  let fin = ''
  if (e.end?.date && !e.end?.dateTime) {
    fin = e.end.date
  } else if (e.end?.dateTime) {
    fin = e.end.dateTime
  }
  const safeCal = String(calId || 'primary').replace(/\|/g, '_')
  const safeEv = String(e.id || '').replace(/\|/g, '_')
  return {
    id: `${safeCal}|${safeEv}`,
    titulo: e.summary || '(Sin título)',
    inicio,
    fin,
    desc: e.description || '',
    color: '#7c6fff',
    calendario: calSummary || calId,
    calendarioId: calId,
  }
}

function sortKeyStart(e) {
  return e.start?.dateTime || e.start?.date || ''
}

export async function listPrimaryMonthEvents(ym) {
  if (!window.gapi?.client?.calendar?.events?.list) {
    throw new Error('Cliente Calendar no listo. Conectá Google en Configuración y volvé a intentar.')
  }
  const base = ym?.year != null && ym?.month != null ? new Date(ym.year, ym.month, 1) : new Date()
  const y = base.getFullYear()
  const m = base.getMonth()

  const timeMin = toRFC3339Local(new Date(y, m, 0, 23, 59, 59, 999))
  const timeMax = toRFC3339Local(new Date(y, m + 1, 1, 0, 0, 0, 0))

  const timeZone = userTimeZone()

  let calendars = []
  try {
    if (window.gapi?.client?.calendar?.calendarList?.list) {
      calendars = (await listAllCalendarEntries()).filter(calendarEntryVisible)
    }
  } catch {
    calendars = []
  }
  if (calendars.length === 0) {
    calendars = [{ id: 'primary', summary: 'Principal' }]
  }

  const pairs = await Promise.all(
    calendars.map(async (cal) => {
      const calId = cal.id
      const calSummary = cal.summaryOverride || cal.summary || calId
      try {
        const items = await listEventsOneCalendar(calId, timeMin, timeMax, timeZone)
        return items.map((e) => ({ e, calId, calSummary }))
      } catch {
        return []
      }
    }),
  )

  const flat = pairs.flat()
  flat.sort((a, b) => String(sortKeyStart(a.e)).localeCompare(String(sortKeyStart(b.e))))

  return flat.map(({ e, calId, calSummary }) => mapGoogleEventToUi(e, calId, calSummary))
}

/**
 * Crea un evento en el calendario primario de la cuenta OAuth actual (p. ej. aurateamcontacto@gmail.com).
 * `inicio` / `fin` deben ser valores parseables por Date (p. ej. datetime-local del formulario).
 */
export async function insertPrimaryCalendarEvent({ titulo, descripcion, inicio, fin }) {
  if (!window.gapi?.client?.calendar?.events?.insert) {
    throw new Error('Cliente Calendar no listo')
  }
  const startDate = new Date(inicio)
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Fecha de inicio inválida')
  }
  let endDate = fin ? new Date(fin) : null
  if (!endDate || Number.isNaN(endDate.getTime())) {
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
  }
  if (endDate.getTime() <= startDate.getTime()) {
    endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
  }
  const resource = {
    summary: titulo || 'Evento',
    description: descripcion || '',
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
  }
  const r = await window.gapi.client.calendar.events.insert({
    calendarId: 'primary',
    resource,
  })
  return r?.result ?? r
}
