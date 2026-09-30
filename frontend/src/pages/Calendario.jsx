import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import EventoForm from '../components/calendario/EventoForm'
import MonthPicker from '../components/ui/MonthPicker'
import PageHeader from '../components/ui/PageHeader'
import Tag from '../components/ui/Tag'
import { listPrimaryMonthEvents } from '../features/google/calendarApi'
import { isSignedIn } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { useEsAdmin } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { celdasMes, currentMonth, diaDe, fmtCorto, formatFecha, horaDe, todayISO } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { QK } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const TIPO_LABEL = { cobro: 'Cobro', contrato: 'Cobro (sin generar)', suscripcion: 'Suscripción', tarea: 'Tarea', evento: 'Evento', google: 'Google' }
const TIPO_LINK = { cobro: '/cobros', contrato: '/cobros', suscripcion: '/suscripciones', tarea: '/tareas' }

const pad = (n) => String(n).padStart(2, '0')

export default function Calendario() {
  const qc = useQueryClient()
  const esAdmin = useEsAdmin()
  const [sp, setSp] = useSearchParams()
  const mes = sp.get('mes') || currentMonth()
  const [y, m] = mes.split('-').map(Number)
  const hoy = todayISO()
  const [diaSel, setDiaSel] = useState(mes === currentMonth() ? hoy : `${mes}-01`)
  const [editando, setEditando] = useState(null)
  const tokenVersion = useGoogleStore((s) => s.tokenVersion)
  const google = isSignedIn()

  const ultimo = new Date(y, m, 0).getDate()
  const venc = useQuery({ queryKey: QK.vencimientos(mes), queryFn: () => api.get('calendario/vencimientos/', { params: { mes } }).then((r) => r.data) })
  const eventosParams = { desde: `${mes}-01`, hasta: `${mes}-${pad(ultimo)}T23:59:59` }
  const eventos = useQuery({ queryKey: QK.calEventos(eventosParams), queryFn: () => getList('cal-eventos/', eventosParams) })
  const gcal = useQuery({
    queryKey: [...QK.googleCal(y, m - 1), tokenVersion],
    queryFn: () => listPrimaryMonthEvents({ year: y, month: m - 1 }),
    enabled: google,
    staleTime: 5 * 60_000,
  })

  const borrar = useMutation({
    mutationFn: (id) => api.delete(`cal-eventos/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cal-eventos'] })
      notify('Evento eliminado')
    },
    onError: (e) => notifyError(e),
  })

  const porDia = useMemo(() => {
    const mapa = {}
    const push = (dia, item) => {
      if (!dia) return
      ;(mapa[dia] = mapa[dia] || []).push(item)
    }
    ;(venc.data?.items ?? []).forEach((i) => push(i.fecha, { ...i, key: `${i.tipo}-${i.id}` }))
    ;(eventos.data ?? []).forEach((e) => push(diaDe(e.inicio), { tipo: 'evento', key: `ev-${e.id}`, id: e.id, titulo: e.titulo, detalle: e.cliente_nombre, color: e.color, hora: horaDe(e.inicio), evento: e }))
    const conGoogle = new Set((eventos.data ?? []).map((e) => e.google_event_id).filter(Boolean))
    ;(gcal.data ?? [])
      .filter((g) => !conGoogle.has(g.id.split('|')[1]))
      .forEach((g) => push(diaDe(g.inicio), { tipo: 'google', key: `g-${g.id}`, titulo: g.titulo, detalle: g.calendario, color: 'var(--accent2)', hora: horaDe(g.inicio) }))
    return mapa
  }, [venc.data, eventos.data, gcal.data])

  const celdas = useMemo(() => celdasMes(mes), [mes])

  const itemsDia = porDia[diaSel] ?? []
  const totalCobrar = (venc.data?.items ?? []).filter((i) => (i.tipo === 'cobro' || i.tipo === 'contrato') && i.estado !== 'pagado').reduce((a, i) => a + Number(i.monto || 0), 0)

  return (
    <>
      <PageHeader titulo="Calendario" subtitulo={esAdmin ? 'Cobros, pagos, tareas y eventos del mes' : 'Tus tareas y la agenda del equipo'}>
        <MonthPicker
          value={mes}
          onChange={(v) => {
            setSp({ mes: v }, { replace: true })
            setDiaSel(v === currentMonth() ? hoy : `${v}-01`)
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
          + Evento
        </button>
      </PageHeader>
      {esAdmin && totalCobrar > 0 ? (
        <div className="info-box">
          Pendiente de cobro con vencimiento este mes: <strong>{fmtCorto(totalCobrar)}</strong> · <Link to={`/cobros?mes=${mes}`}>Ver cobros</Link>
        </div>
      ) : null}
      <div className="grid-2 layout-cal">
        <div className="card">
          <div className="cal-grid">
            {DIAS.map((d) => (
              <div key={d} className="cal-head">
                {d}
              </div>
            ))}
            {celdas.map((dia, i) =>
              dia ? (
                <button key={dia} type="button" className={`cal-cell${dia === hoy ? ' today' : ''}${dia === diaSel ? ' selected' : ''}`} onClick={() => setDiaSel(dia)}>
                  <span className="cal-num">{Number(dia.slice(8))}</span>
                  <span className="cal-items">
                    {(porDia[dia] ?? []).slice(0, 3).map((it) => (
                      <span key={it.key} className={`cal-pill${it.estado === 'vencido' ? ' late' : ''}`} style={{ borderColor: it.color }}>
                        {it.titulo}
                      </span>
                    ))}
                    {(porDia[dia] ?? []).length > 3 ? <span className="cal-more">+{porDia[dia].length - 3}</span> : null}
                  </span>
                  {porDia[dia]?.length ? (
                    <span className="cal-dots" aria-hidden>
                      {porDia[dia].slice(0, 4).map((it) => (
                        <i key={it.key} style={{ background: it.color }} />
                      ))}
                    </span>
                  ) : null}
                </button>
              ) : (
                <div key={`v${i}`} className="cal-cell empty" />
              ),
            )}
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: 'var(--success)' }} /> Cobros
            </span>
            <span>
              <i style={{ background: 'var(--accent3)' }} /> Suscripciones
            </span>
            <span>
              <i style={{ background: 'var(--gold)' }} /> Tareas
            </span>
            <span>
              <i style={{ background: 'var(--accent2)' }} /> Eventos / Google
            </span>
          </div>
          {!google && esAdmin ? (
            <p className="muted small">
              Google Calendar no está conectado (<Link to="/config">conectar</Link>).
            </p>
          ) : google && gcal.isError ? (
            <p className="down small">No se pudo leer Google Calendar: {gcal.error?.message}</p>
          ) : null}
        </div>
        <div className="card">
          <div className="card-title-row">
            <div className="card-title">
              <span className="dot" /> {formatFecha(diaSel, { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando({ dia: diaSel })}>
              + Evento este día
            </button>
          </div>
          {itemsDia.length === 0 ? (
            <div className="empty">Nada agendado.</div>
          ) : (
            itemsDia.map((it) => (
              <div key={it.key} className="list-row">
                <span className="cat-dot" style={{ background: it.color }} />
                <div className="list-row-main">
                  <div className="list-row-title">
                    {it.hora ? <span className="mono muted">{it.hora} </span> : null}
                    {TIPO_LINK[it.tipo] && esAdmin ? <Link to={TIPO_LINK[it.tipo] + (it.tipo === 'tarea' ? '' : `?mes=${mes}`)}>{it.titulo}</Link> : it.titulo}
                  </div>
                  <div className="list-row-sub">
                    <Tag color={it.estado === 'vencido' ? 'red' : it.estado === 'pagado' ? 'green' : ''}>{TIPO_LABEL[it.tipo]}</Tag> {it.detalle}
                  </div>
                </div>
                <div className="list-row-side">
                  {it.monto ? <div className="mono">{fmtCorto(it.monto)}</div> : null}
                  {it.tipo === 'evento' && it.evento.puede_editar ? (
                    <span className="nowrap">
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(it.evento)}>
                        Editar
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        aria-label="Eliminar evento"
                        onClick={async () =>
                          (await confirmar({ mensaje: `¿Eliminar «${it.titulo}»?${it.evento.google_event_id ? ' (La copia en Google Calendar no se borra.)' : ''}`, peligro: true, confirmar: 'Eliminar' })) &&
                          borrar.mutate(it.id)
                        }
                      >
                        🗑
                      </button>
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {editando ? <EventoForm inicial={editando.id ? editando : null} dia={editando.dia || diaSel} onClose={() => setEditando(null)} /> : null}
    </>
  )
}
