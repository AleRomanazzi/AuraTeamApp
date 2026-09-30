import { useMemo, useState } from 'react'
import Tag from '../ui/Tag'
import { ESTADOS_TAREA, PRIORIDADES, labelDe } from '../../lib/constants'
import { formatFechaCorta } from '../../lib/format'

const ORDEN_PRIORIDAD = { alta: 0, media: 1, baja: 2 }

/** Vista por estado (kanban). */
export default function TableroTareas({ tareas, onAbrir, onCambiarEstado }) {
  const [vista, setVista] = useState('pendiente')
  const columnas = useMemo(
    () =>
      ESTADOS_TAREA.map((e) => ({
        ...e,
        tareas: tareas
          .filter((t) => t.estado === e.value)
          .sort((a, b) =>
            e.value === 'hecha'
              ? String(b.completada_en).localeCompare(String(a.completada_en))
              : ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999')),
          ),
      })),
    [tareas],
  )

  return (
    <>
      <div className="board-switch" role="tablist" aria-label="Estado">
        {columnas.map((col) => (
          <button key={col.value} type="button" role="tab" aria-selected={vista === col.value} className={`chip${vista === col.value ? ' active' : ''}`} onClick={() => setVista(col.value)}>
            {col.label} <b>{col.tareas.length}</b>
          </button>
        ))}
      </div>
      <div className="board">
        {columnas.map((col) => (
          <div key={col.value} className={`board-col${vista === col.value ? ' board-col--visible' : ''}`}>
            <div className="board-col-head">
              <Tag color={col.tag}>{col.label}</Tag>
              <span className="board-col-count">{col.tareas.length}</span>
            </div>
            {col.tareas.length === 0 ? <div className="board-empty">Sin tareas</div> : null}
            {col.tareas.map((t) => (
              <div key={t.id} className={`task-card task-card--click${t.vencida ? ' task-card--late' : ''}`}>
                <button type="button" className="task-card-open" onClick={() => onAbrir(t)} aria-label={`Abrir «${t.titulo}»`} />
                <div className="task-card-top">
                  <span className="task-card-cliente" title={t.cliente_nombre || 'Sin cliente'}>
                    {t.cliente_nombre ? <span className="cat-dot" style={{ background: t.cliente_color }} /> : null}
                    {t.cliente_nombre || 'Sin cliente'}
                  </span>
                  <Tag color={PRIORIDADES.find((p) => p.value === t.prioridad)?.tag}>{labelDe(PRIORIDADES, t.prioridad)}</Tag>
                </div>
                <div className="task-card-title">{t.titulo}</div>
                {t.descripcion ? <div className="task-card-desc">{t.descripcion}</div> : null}
                <div className="task-card-meta">
                  <span className={t.vencida ? 'down' : ''}>{t.fecha_limite ? `${t.vencida ? '⚠ Venció ' : '📅 '}${formatFechaCorta(t.fecha_limite)}` : 'Sin fecha'}</span>
                  {t.asignados_nombres.length ? <span>👤 {t.asignados_nombres.join(', ')}</span> : null}
                  {t.links?.length ? <span>🔗 {t.links.length}</span> : null}
                </div>
                {t.puede_editar ? (
                  <div className="task-card-actions">
                    <select className="select-sm" aria-label="Cambiar estado" value={t.estado} onChange={(e) => onCambiarEstado(t, e.target.value)}>
                      {ESTADOS_TAREA.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}
