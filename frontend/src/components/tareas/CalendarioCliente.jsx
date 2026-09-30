import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '../ui/Modal'
import { getList } from '../../lib/api'
import { celdasMes, diaDe, formatFecha, horaDe, monthLabel, shiftMonth } from '../../lib/format'
import { QK } from '../../lib/queryKeys'

const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const pad = (n) => String(n).padStart(2, '0')

/** Mes de un cliente con los eventos y tareas del día elegido. */
export default function CalendarioCliente({ cliente, diaInicial, tareas, onClose, onNuevoEvento, onAbrirEvento, onAbrirTarea }) {
  const [dia, setDia] = useState(diaInicial)
  const [mes, setMes] = useState(diaInicial.slice(0, 7))
  const [y, m] = mes.split('-').map(Number)
  const params = { desde: `${mes}-01`, hasta: `${mes}-${pad(new Date(y, m, 0).getDate())}T23:59:59`, ...(cliente.id ? { cliente: cliente.id } : {}) }
  const eventos = useQuery({ queryKey: QK.calEventos(params), queryFn: () => getList('cal-eventos/', params) })

  const porDia = useMemo(() => {
    const mapa = {}
    const push = (d, it) => (mapa[d] = mapa[d] || []).push(it)
    ;(eventos.data ?? [])
      .filter((e) => (cliente.id ? true : !e.cliente))
      .forEach((e) => push(diaDe(e.inicio), { tipo: 'evento', key: `e${e.id}`, evento: e, color: e.color || cliente.color }))
    tareas.filter((t) => t.fecha_limite).forEach((t) => push(t.fecha_limite, { tipo: 'tarea', key: `t${t.id}`, tarea: t, color: cliente.color }))
    return mapa
  }, [eventos.data, tareas, cliente])

  const hoy = diaDe(new Date())
  const items = porDia[dia] ?? []

  return (
    <Modal title={`Calendario · ${cliente.nombre}`} onClose={onClose} size="lg">
      <div className="cc-nav">
        <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes anterior" onClick={() => setMes((v) => shiftMonth(v, -1))}>
          ‹
        </button>
        <strong>{monthLabel(mes)}</strong>
        <button type="button" className="btn btn-secondary btn-xs" aria-label="Mes siguiente" onClick={() => setMes((v) => shiftMonth(v, 1))}>
          ›
        </button>
      </div>
      <div className="cc-grid" style={{ '--cliente': cliente.color || 'var(--accent)' }}>
        {DIAS.map((d, i) => (
          <span key={i} className="cc-head">
            {d}
          </span>
        ))}
        {celdasMes(mes).map((d, i) =>
          d ? (
            <button key={d} type="button" className={`cc-dia${d === hoy ? ' cc-dia--hoy' : ''}${d === dia ? ' cc-dia--sel' : ''}`} onClick={() => setDia(d)}>
              <span>{Number(d.slice(8))}</span>
              <span className="tc-marcas" aria-hidden>
                {(porDia[d] ?? []).slice(0, 3).map((it) => (
                  <i key={it.key} className={it.tipo === 'tarea' ? 'tc-marca--tarea' : ''} style={{ '--c': it.color }} />
                ))}
              </span>
            </button>
          ) : (
            <span key={`v${i}`} />
          ),
        )}
      </div>

      <div className="tarea-sheet-label cc-dia-titulo">{formatFecha(dia, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      {eventos.isPending ? <div className="muted small">Cargando…</div> : null}
      {items.map((it) =>
        it.tipo === 'evento' ? (
          <button key={it.key} type="button" className="cc-item" onClick={() => onAbrirEvento(it.evento)}>
            <span className="cc-barra" style={{ background: it.color }} />
            <span className="cc-hora mono">{horaDe(it.evento.inicio) || '—'}</span>
            <span className="cc-texto">
              {it.evento.titulo}
              {it.evento.descripcion ? <small>{it.evento.descripcion}</small> : null}
            </span>
            <span className="muted">›</span>
          </button>
        ) : (
          <button key={it.key} type="button" className="cc-item" onClick={() => onAbrirTarea(it.tarea)}>
            <span className="cc-barra cc-barra--tarea" style={{ borderColor: it.color }} />
            <span className="cc-hora mono">Vence</span>
            <span className="cc-texto">
              {it.tarea.titulo}
              <small>{it.tarea.asignados_nombres.join(', ') || 'Sin responsable'}</small>
            </span>
            <span className="muted">›</span>
          </button>
        ),
      )}
      <button type="button" className="cc-nuevo" onClick={() => onNuevoEvento(dia)}>
        + Nuevo evento el {formatFecha(dia, { day: '2-digit', month: '2-digit' })}
      </button>
    </Modal>
  )
}
