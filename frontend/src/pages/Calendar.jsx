import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useModal } from '../context/ModalContext'
import { usePhase1 } from '../context/Phase1Context'
import { listPrimaryMonthEvents } from '../features/google/calendarApi'
import { isSignedIn } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { api } from '../lib/api'
import { QK } from '../lib/queryKeys'
import { fmt } from '../lib/format'
import { notify } from '../lib/notify'

function monthLabel(year, monthIndex) {
  return new Date(year, monthIndex, 1).toLocaleDateString('es', { month: 'long', year: 'numeric' })
}

/**
 * Piezas de calendario local para un `inicio` (ISO con hora, o solo YYYY-MM-DD de evento todo el día en Google).
 * Las fechas sin hora no pasan por `Date` para no desplazar el día por UTC.
 */
function parseInicioLocalParts(inicioStr) {
  if (!inicioStr) return null
  const s = String(inicioStr).trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dateOnly) {
    const y = Number(dateOnly[1])
    const m = Number(dateOnly[2]) - 1
    const day = Number(dateOnly[3])
    if (Number.isFinite(y) && m >= 0 && m <= 11 && day >= 1 && day <= 31) {
      return { y, m, day }
    }
  }
  const d = s.includes('T') ? new Date(s) : new Date(`${s.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return { y: d.getFullYear(), m: d.getMonth(), day: d.getDate() }
}

function formatGoogleEventoFecha(inicioStr) {
  if (!inicioStr) return '—'
  const s = String(inicioStr).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yy, mm, dd] = s.split('-').map(Number)
    const d = new Date(yy, mm - 1, dd)
    return `${d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })} · Todo el día`
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}

function MiniMonthGrid({ year, monthIndex, calClientes, googleEvents, selectedDay, onSelectDay }) {
  const firstDay = new Date(year, monthIndex, 1).getDay()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const today = new Date()
  const isThisMonth = today.getFullYear() === year && today.getMonth() === monthIndex
  const todayNum = isThisMonth ? today.getDate() : null

  const googleDays = new Set()
  googleEvents.forEach((e) => {
    const p = parseInicioLocalParts(e.inicio)
    if (p && p.y === year && p.m === monthIndex) googleDays.add(p.day)
  })

  const days = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
  return (
    <div className="mini-cal-root">
      <div className="mini-cal-weekdays">
        {days.map((d) => (
          <div key={d} className="mini-cal-weekday">
            {d}
          </div>
        ))}
      </div>
      <div className="mini-cal-grid">
        {Array.from({ length: firstDay }, (_, i) => (
          <div key={`empty-${i}`} className="mini-cal-cell mini-cal-cell--empty" />
        ))}
        {Array.from({ length: daysInMonth }, (_, idx) => {
          const dayNum = idx + 1
          const isToday = todayNum === dayNum
          const hasCliente = calClientes.some((c) => c.diaMes === dayNum)
          const hasGoogle = googleDays.has(dayNum)
          const isSelected = selectedDay === dayNum
          return (
            <button
              key={dayNum}
              type="button"
              className={`mini-cal-cell mini-cal-day${isToday ? ' mini-cal-day--today' : ''}${isSelected ? ' mini-cal-day--selected' : ''}`}
              onClick={() => onSelectDay(dayNum)}
            >
              <span>{dayNum}</span>
              {(hasCliente || hasGoogle) && !isToday ? <span className="mini-cal-dot" aria-hidden /> : null}
              {hasGoogle && isToday ? <span className="mini-cal-dot mini-cal-dot--on-accent" aria-hidden /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function Calendar() {
  const { state, refetchAll } = usePhase1()
  const { openModalEvento } = useModal()
  const qc = useQueryClient()
  const cur = state.config.moneda

  const now = new Date()
  const [viewMonth, setViewMonth] = useState(() => ({ y: now.getFullYear(), m: now.getMonth() }))
  const [selectedDay, setSelectedDay] = useState(null)

  const googleTokenVersion = useGoogleStore((s) => s.tokenVersion)
  const googleSignedIn = isSignedIn()
  const googleCalQ = useQuery({
    queryKey: [...QK.googleCal(viewMonth.y, viewMonth.m), googleTokenVersion],
    queryFn: () => listPrimaryMonthEvents({ year: viewMonth.y, month: viewMonth.m }),
    enabled: googleSignedIn,
    staleTime: 30_000,
  })
  const googleEvents = useMemo(() => googleCalQ.data ?? [], [googleCalQ.data])

  const loadGoogleCalendar = useCallback(async () => {
    if (!isSignedIn()) {
      notify('Conectá Google primero (Configuración)')
      return
    }
    try {
      const r = await googleCalQ.refetch()
      if (r.error) throw r.error
      const list = r.data ?? []
      notify(list.length ? `Google: ${list.length} eventos` : 'Sin eventos este mes en Google')
    } catch (e) {
      notify(e?.result?.error?.message || e?.message || 'Error Calendar')
    }
  }, [googleCalQ])

  const handleRefetchApp = useCallback(async () => {
    try {
      await refetchAll()
      notify('Datos de la app actualizados')
    } catch {
      notify('No se pudo actualizar todo; revisá la conexión')
    }
  }, [refetchAll])

  const shiftMonth = (delta) => {
    setViewMonth((prev) => {
      const d = new Date(prev.y, prev.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
    setSelectedDay(null)
  }

  const delCliente = useMutation({
    mutationFn: (id) => api.delete(`cal-clientes/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.calClientes })
      notify('Cliente eliminado')
    },
    onError: () => notify('No se pudo eliminar'),
  })

  const delEvento = useMutation({
    mutationFn: (id) => api.delete(`cal-eventos/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.calEventos })
      notify('Evento eliminado')
    },
    onError: () => notify('No se pudo eliminar'),
  })

  const sortedEventos = useMemo(() => [...state.calEventos].sort((a, b) => new Date(a.inicio) - new Date(b.inicio)), [state.calEventos])

  const selectedBundle = useMemo(() => {
    if (selectedDay == null) return null
    const { y, m } = viewMonth
    const clientes = state.calClientes.filter((c) => c.diaMes === selectedDay)
    const unicos = sortedEventos.filter((e) => {
      const p = parseInicioLocalParts(e.inicio)
      return p && p.y === y && p.m === m && p.day === selectedDay
    })
    const google = googleEvents.filter((e) => {
      const p = parseInicioLocalParts(e.inicio)
      return p && p.y === y && p.m === m && p.day === selectedDay
    })
    return { clientes, unicos, google }
  }, [selectedDay, viewMonth, state.calClientes, sortedEventos, googleEvents])

  const presetFromSelection = () => ({ year: viewMonth.y, monthIndex: viewMonth.m, day: selectedDay })

  return (
    <div className="page active" id="page-calendar">
      <div className="section-header">
        <div>
          <h2>Calendario</h2>
          <p>Clientes recurrentes y eventos especiales</p>
        </div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={handleRefetchApp}>
            🔄 Actualizar app
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={googleCalQ.isFetching} onClick={loadGoogleCalendar}>
            {googleCalQ.isFetching ? '⏳…' : '📆 Cargar Google'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openModalEvento('unico')}>
            + Evento único
          </button>
          <button type="button" className="btn btn-warning btn-sm" onClick={() => openModalEvento('cliente')}>
            ⭐ Cliente mensual
          </button>
        </div>
      </div>
      <div className="grid-2">
        <div>
          <div className="card">
            <div className="card-title mini-cal-card-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="dot" />
                Mini calendario
              </span>
              <span className="mini-cal-nav">
                <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes anterior" onClick={() => shiftMonth(-1)}>
                  ‹
                </button>
                <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes siguiente" onClick={() => shiftMonth(1)}>
                  ›
                </button>
              </span>
            </div>
            <div className="mini-cal-month-label">{monthLabel(viewMonth.y, viewMonth.m)}</div>
            <MiniMonthGrid
              year={viewMonth.y}
              monthIndex={viewMonth.m}
              calClientes={state.calClientes}
              googleEvents={googleEvents}
              selectedDay={selectedDay}
              onSelectDay={(d) => setSelectedDay((prev) => (prev === d ? null : d))}
            />
            <p className="mini-cal-hint">Tocá un día para seleccionarlo (otra vez para deseleccionar). Dorado = cliente o Google en ese día.</p>
            {selectedDay != null ? (
              <div className="mini-cal-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => openModalEvento('unico', presetFromSelection())}
                >
                  Nuevo evento día {selectedDay}
                </button>
                <button
                  type="button"
                  className="btn btn-warning btn-sm"
                  onClick={() => openModalEvento('cliente', presetFromSelection())}
                >
                  Cliente día {selectedDay}
                </button>
              </div>
            ) : null}
            {selectedBundle ? (
              <div className="mini-cal-day-detail">
                <div className="cal-section-label">Día {selectedDay}</div>
                {selectedBundle.clientes.length === 0 && selectedBundle.unicos.length === 0 && selectedBundle.google.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '8px 0' }}>Sin entradas este día.</div>
                ) : null}
                {selectedBundle.clientes.map((c) => (
                  <div key={`c-${c.id}`} className="client-event" style={{ marginBottom: 6 }}>
                    <div className="cal-dot" style={{ background: c.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <strong style={{ color: 'var(--text)' }}>{c.titulo}</strong>
                      <span style={{ color: 'var(--text-dim)' }}> · recurrente</span>
                    </div>
                  </div>
                ))}
                {selectedBundle.unicos.map((e) => {
                  const d = e.inicio ? new Date(e.inicio) : null
                  const t =
                    d && !Number.isNaN(d.getTime())
                      ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                      : ''
                  return (
                    <div key={`u-${e.id}`} className="unique-event" style={{ marginBottom: 6 }}>
                      <div className="cal-dot" style={{ background: e.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: 13 }}>
                        <strong style={{ color: 'var(--text)' }}>{e.titulo}</strong>
                        {t ? <span style={{ color: 'var(--text-dim)' }}> · {t}</span> : null}
                      </div>
                    </div>
                  )
                })}
                {selectedBundle.google.map((e) => (
                  <div key={`g-${e.id}`} className="unique-event" style={{ marginBottom: 6 }}>
                    <div className="cal-dot" style={{ background: '#4fc3f7', flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <strong style={{ color: 'var(--text)' }}>{e.titulo}</strong>
                      <span style={{ color: 'var(--text-dim)' }}>
                        {' '}
                        · {formatGoogleEventoFecha(e.inicio)}
                        {e.calendario ? ` · ${e.calendario}` : ''} · Google
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <div style={{ marginBottom: '20px' }}>
            <div className="cal-section-label">⭐ Clientes mensuales prioritarios</div>
            <div id="cal-clientes">
              {state.calClientes.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px', textAlign: 'center', background: 'var(--surface2)', borderRadius: '8px' }}>Sin clientes registrados</div>
              ) : (
                state.calClientes.map((c) => (
                  <div key={c.id} className="client-event">
                    <div className="cal-dot" style={{ background: c.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>{c.titulo}</div>
                      <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                        Cada mes, día {c.diaMes}
                        {c.desc ? ` · ${c.desc}` : ''}
                      </div>
                      {c.monto ? <div style={{ fontSize: '12px', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>{fmt(c.monto, cur)}/mes</div> : null}
                    </div>
                    <button type="button" className="btn btn-danger btn-xs" onClick={() => delCliente.mutate(c.id)} disabled={delCliente.isPending}>
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div>
            <div className="cal-section-label">📌 Eventos únicos / Fechas especiales</div>
            <div id="cal-eventos">
              {sortedEventos.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px', textAlign: 'center', background: 'var(--surface2)', borderRadius: '8px' }}>Sin eventos registrados</div>
              ) : (
                sortedEventos.map((e) => {
                  const d = e.inicio ? new Date(e.inicio) : null
                  const fechaStr = d
                    ? `${d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
                    : 'Sin fecha'
                  return (
                    <div key={e.id} className="unique-event">
                      <div className="cal-dot" style={{ background: e.color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>{e.titulo}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                          {fechaStr}
                          {e.desc ? ` · ${e.desc}` : ''}
                        </div>
                      </div>
                      <button type="button" className="btn btn-danger btn-xs" onClick={() => delEvento.mutate(e.id)} disabled={delEvento.isPending}>
                        🗑
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 4 }}>
        <div className="card-title">
          <span className="dot" style={{ background: 'var(--accent3)' }} />
          Google Calendar — {monthLabel(viewMonth.y, viewMonth.m)} (solo lectura)
          {googleSignedIn && !googleCalQ.isLoading && !googleCalQ.isError ? (
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
              ({googleEvents.length} evento{googleEvents.length === 1 ? '' : 's'} este mes)
            </span>
          ) : null}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
          Incluye los calendarios que tenés <strong>visibles y marcados</strong> en Google Calendar (AuraTeam, Tasks, Trabajo, feriados, etc.), igual que la barra lateral de la web. Usá ‹ › para cambiar de mes. Los eventos nuevos desde la app siguen guardándose en el calendario <strong>principal</strong> de la cuenta.
        </p>
        {!googleSignedIn ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>Iniciá sesión en Google (Configuración) para ver eventos.</div>
        ) : googleCalQ.isError ? (
          <div style={{ color: 'var(--accent3)', fontSize: '13px', padding: '12px 0' }}>
            {googleCalQ.error?.message || 'Error al cargar Google Calendar'}
          </div>
        ) : googleCalQ.isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>Cargando eventos…</div>
        ) : googleEvents.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '12px 0' }}>Sin eventos este mes en el calendario primario.</div>
        ) : (
          googleEvents.map((e) => {
            const fechaStr = formatGoogleEventoFecha(e.inicio)
            return (
              <div key={e.id} className="unique-event" style={{ marginBottom: 8 }}>
                <div className="cal-dot" style={{ background: '#4fc3f7', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>{e.titulo}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
                    {fechaStr}
                    {e.calendario ? <span> · {e.calendario}</span> : null}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
