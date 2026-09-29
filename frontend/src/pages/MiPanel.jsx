import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import Tag from '../components/ui/Tag'
import { useMe } from '../hooks/useData'
import { api } from '../lib/api'
import { ESTADOS_LIQUIDACION, ESTADOS_TAREA, PRIORIDADES, labelDe } from '../lib/constants'
import { fmt, formatFechaCorta, formatFechaHora, monthLabel } from '../lib/format'
import { notifyError } from '../lib/notify'
import { QK, invalidar } from '../lib/queryKeys'

export default function MiPanel() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK.miPanel, queryFn: () => api.get('mi-panel/').then((r) => r.data) })
  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }) => api.patch(`tareas/${id}/`, { estado }),
    onSuccess: () => invalidar(qc, ['mi-panel', 'tareas']),
    onError: (e) => notifyError(e),
  })

  return (
    <>
      <PageHeader titulo={`Hola, ${me?.persona_nombre || me?.first_name || me?.username}`} subtitulo="Tus tareas, pagos y agenda" />
      <QueryState query={q}>
        {(d) =>
          !d.persona ? (
            <div className="info-box">Tu usuario todavía no está vinculado a una persona del equipo. Pedile a un administrador que lo vincule en Configuración → Usuarios.</div>
          ) : (
            <div className="grid-2">
              <div className="card">
                <div className="card-title">
                  <span className="dot" /> Tareas abiertas ({d.tareas.length})
                </div>
                {d.tareas.length === 0 ? (
                  <div className="empty">No tenés tareas pendientes.</div>
                ) : (
                  d.tareas.map((t) => (
                    <div key={t.id} className="list-row">
                      <div className="list-row-main">
                        <div className="list-row-title">{t.titulo}</div>
                        <div className="list-row-sub">
                          {t.cliente_nombre ? `${t.cliente_nombre} · ` : ''}
                          <Tag color={PRIORIDADES.find((p) => p.value === t.prioridad)?.tag}>{labelDe(PRIORIDADES, t.prioridad)}</Tag>
                          {t.fecha_limite ? <span className={t.vencida ? 'down' : ''}> · vence {formatFechaCorta(t.fecha_limite)}</span> : null}
                        </div>
                      </div>
                      <select
                        aria-label="Estado de la tarea"
                        className="select-sm"
                        value={t.estado}
                        onChange={(e) => cambiarEstado.mutate({ id: t.id, estado: e.target.value })}
                      >
                        {ESTADOS_TAREA.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))
                )}
                <div style={{ marginTop: 10 }}>
                  <Link to="/tareas">Ver todas mis tareas</Link>
                </div>
              </div>
              <div>
                <div className="card">
                  <div className="card-title">
                    <span className="dot" style={{ background: 'var(--gold)' }} /> Mis pagos
                  </div>
                  {d.liquidaciones.length === 0 ? (
                    <div className="empty">Todavía no hay liquidaciones a tu nombre.</div>
                  ) : (
                    d.liquidaciones.map((l) => (
                      <div key={l.id} className="list-row">
                        <div className="list-row-main">
                          <div className="list-row-title">{l.concepto}</div>
                          <div className="list-row-sub">
                            {monthLabel(l.periodo)}
                            {l.fecha_pago ? ` · pagado el ${formatFechaCorta(l.fecha_pago)}` : ''}
                            {l.estado === 'pagada' ? (
                              <>
                                {' · '}
                                <Link to={`/pagos-equipo/${l.id}/recibo`}>Recibo</Link>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="list-row-side">
                          <div className="mono">{fmt(l.total)}</div>
                          <Tag color={ESTADOS_LIQUIDACION[l.estado]?.tag}>{ESTADOS_LIQUIDACION[l.estado]?.label}</Tag>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="card">
                  <div className="card-title">
                    <span className="dot" style={{ background: 'var(--accent2)' }} /> Próximos 14 días
                  </div>
                  {d.eventos.length === 0 ? (
                    <div className="empty">Sin eventos agendados.</div>
                  ) : (
                    d.eventos.map((e) => (
                      <div key={e.id} className="cal-event">
                        <div className="cal-dot" style={{ background: e.color }} />
                        <div className="cal-time">{formatFechaHora(e.inicio)}</div>
                        <div className="cal-title">
                          {e.titulo}
                          {e.cliente_nombre ? <span className="muted"> · {e.cliente_nombre}</span> : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )
        }
      </QueryState>
    </>
  )
}
