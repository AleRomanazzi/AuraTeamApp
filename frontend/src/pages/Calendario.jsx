import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import MonthPicker from '../components/ui/MonthPicker'
import PageHeader from '../components/ui/PageHeader'
import Tag from '../components/ui/Tag'
import { insertPrimaryCalendarEvent, listPrimaryMonthEvents } from '../features/google/calendarApi'
import { isSignedIn } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { useClientes, useEsAdmin } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { COLORES } from '../lib/constants'
import { currentMonth, fmtCorto, formatFecha, toDatetimeLocal, todayISO } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { QK } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const TIPO_LABEL = { cobro: 'Cobro', contrato: 'Cobro (sin generar)', suscripcion: 'Suscripción', tarea: 'Tarea', evento: 'Evento', google: 'Google' }
const TIPO_LINK = { cobro: '/cobros', contrato: '/cobros', suscripcion: '/suscripciones', tarea: '/tareas' }

const pad = (n) => String(n).padStart(2, '0')
const diaDe = (valor) => {
  if (!valor) return ''
  const s = String(valor)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const horaDe = (valor) => (/T\d{2}:\d{2}/.test(String(valor)) ? new Date(valor).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '')

function EventoForm({ inicial, dia, onClose }) {
  const qc = useQueryClient()
  const { data: clientes = [] } = useClientes()
  const google = isSignedIn()
  const [f, setF] = useState(() => ({
    titulo: inicial?.titulo ?? '',
    inicio: inicial?.inicio ? toDatetimeLocal(inicial.inicio) : `${dia}T10:00`,
    fin: inicial?.fin ? toDatetimeLocal(inicial.fin) : '',
    cliente: inicial?.cliente ?? '',
    color: inicial?.color ?? COLORES[1],
    descripcion: inicial?.descripcion ?? '',
  }))
  const [copiarGoogle, setCopiarGoogle] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  const guardar = useMutation({
    mutationFn: async () => {
      const body = {
        ...f,
        inicio: new Date(f.inicio).toISOString(),
        fin: f.fin ? new Date(f.fin).toISOString() : null,
        cliente: f.cliente || null,
      }
      if (copiarGoogle && !inicial?.google_event_id) {
        const g = await insertPrimaryCalendarEvent({ titulo: f.titulo, descripcion: f.descripcion, inicio: f.inicio, fin: f.fin })
        body.google_event_id = g?.id || ''
      }
      return inicial?.id ? api.put(`cal-eventos/${inicial.id}/`, body) : api.post('cal-eventos/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cal-eventos'] })
      qc.invalidateQueries({ queryKey: ['google-calendar'] })
      qc.invalidateQueries({ queryKey: ['mi-panel'] })
      notify(inicial?.id ? 'Evento actualizado' : 'Evento creado')
      onClose()
    },
    onError: (e) => notifyError(e, e?.result?.error?.message || 'No se pudo guardar el evento'),
  })

  return (
    <Modal
      title={inicial?.id ? 'Editar evento' : 'Nuevo evento'}
      onClose={onClose}
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
            Guardar
          </button>
        </>
      }
    >
      <Field label="Título">
        <input value={f.titulo} onChange={set('titulo')} required maxLength={120} placeholder="Reunión, sesión de fotos, lanzamiento…" />
      </Field>
      <div className="grid-2 tight">
        <Field label="Inicio">
          <input type="datetime-local" value={f.inicio} onChange={set('inicio')} required />
        </Field>
        <Field label="Fin (opcional)">
          <input type="datetime-local" value={f.fin} onChange={set('fin')} min={f.inicio} />
        </Field>
      </div>
      <Field label="Cliente">
        <select value={f.cliente ?? ''} onChange={set('cliente')}>
          <option value="">— Ninguno —</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Descripción">
        <textarea rows={3} value={f.descripcion} onChange={set('descripcion')} />
      </Field>
      <Field label="Color">
        <div className="color-picker">
          {COLORES.map((c) => (
            <button key={c} type="button" className={`color-swatch${f.color === c ? ' active' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => setF((s) => ({ ...s, color: c }))} />
          ))}
        </div>
      </Field>
      {google && !inicial?.google_event_id ? (
        <label className="check-row">
          <input type="checkbox" checked={copiarGoogle} onChange={(e) => setCopiarGoogle(e.target.checked)} /> Crear también en Google Calendar
        </label>
      ) : null}
    </Modal>
  )
}

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

  const celdas = useMemo(() => {
    const primero = (new Date(y, m - 1, 1).getDay() + 6) % 7
    const arr = Array.from({ length: primero }, () => null)
    for (let d = 1; d <= ultimo; d++) arr.push(`${mes}-${pad(d)}`)
    while (arr.length % 7) arr.push(null)
    return arr
  }, [y, m, ultimo, mes])

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
                </button>
              ) : (
                <div key={`v${i}`} className="cal-cell empty" />
              ),
            )}
          </div>
          <div className="chart-legend">
            <span>
              <i style={{ background: 'var(--accent)' }} /> Cobros
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
          {!google ? (
            <p className="muted small">
              Google Calendar no está conectado (<Link to="/config">conectar</Link>).
            </p>
          ) : gcal.isError ? (
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
                  {it.tipo === 'evento' ? (
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
