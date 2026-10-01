import { useState } from 'react'
import { ESTADOS_TAREA } from '../../lib/constants'
import { formatFechaCorta, iniciales } from '../../lib/format'

const VISIBLES = 4
const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const estadoDe = (v) => ESTADOS_TAREA.find((e) => e.value === v)

function Marcas({ items }) {
  if (!items?.length) return <span className="tc-marcas" />
  return (
    <span className="tc-marcas" aria-hidden>
      {items.slice(0, 3).map((it) => (
        <i key={it.key} className={it.tipo === 'tarea' ? 'tc-marca--tarea' : ''} style={{ '--c': it.color }} />
      ))}
    </span>
  )
}

function fechaTarea(t, hoy) {
  if (!t.fecha_limite) return null
  if (t.vencida) return <span className="down">Venció {formatFechaCorta(t.fecha_limite)}</span>
  if (t.fecha_limite === hoy) return <span className="tc-hoy">Hoy</span>
  return <span>{formatFechaCorta(t.fecha_limite)}</span>
}

/** Bloque de un cliente (o «Sin cliente» si `cliente.id` es null): agenda + tareas abiertas. */
export default function ClienteBloque({ cliente, tareas, marcasPorDia, semana, proximas, hoy, personas, tildadas, onAbrirTarea, onNuevaTarea, onAbrirDia, onMarcarHecha, onPlan }) {
  const [expandido, setExpandido] = useState(false)
  const vencidas = tareas.filter((t) => t.vencida).length
  const lista = expandido ? tareas : tareas.slice(0, VISIBLES)
  const color = cliente.color || 'var(--text-dim)'

  return (
    <section className="tc-bloque" id={`bloque-${cliente.id ?? 'interno'}`} style={{ '--cliente': color }}>
      <header className="tc-head">
        <span className="tc-avatar">{cliente.id ? iniciales(cliente.nombre).slice(0, 1) : '·'}</span>
        <div className="tc-head-main">
          <h3 className="tc-nombre">{cliente.nombre}</h3>
          <div className="tc-resumen">
            {tareas.length ? `${tareas.length} abierta${tareas.length === 1 ? '' : 's'}` : 'Sin tareas abiertas'}
            {vencidas ? <span className="down"> · {vencidas} vencida{vencidas === 1 ? '' : 's'}</span> : null}
          </div>
        </div>
        <div className="tc-head-acciones">
          {onPlan ? (
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => onPlan(cliente)}>
              Plan del mes
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => onAbrirDia(cliente, hoy)}>
            Calendario
          </button>
        </div>
      </header>

      <div className="tc-cuerpo">
        <div className="tc-tareas">
          <div className="tc-seccion">Tareas</div>
          {lista.map((t) => {
            const est = estadoDe(t.estado)
            const asignados = t.asignados.map((id) => personas[id]).filter(Boolean)
            const tildada = tildadas?.has(t.id)
            return (
              <div key={t.id} className={`tc-tarea${t.vencida && !tildada ? ' tc-tarea--late' : ''}${tildada ? ' tc-tarea--hecha' : ''}`}>
                <button
                  type="button"
                  className="tc-check"
                  role="checkbox"
                  aria-checked={tildada}
                  aria-label={`Marcar «${t.titulo}» como hecha`}
                  title={t.puede_editar ? 'Marcar como hecha' : 'Solo podés completar tus tareas'}
                  disabled={!t.puede_editar || tildada}
                  onClick={() => onMarcarHecha(t)}
                />
                <button type="button" className="tc-tarea-main" onClick={() => onAbrirTarea(t)}>
                  <span className="tc-tarea-titulo">{t.titulo}</span>
                  <span className="tc-tarea-meta">
                    <span className={`tag tag-${est?.tag || 'neutral'}`}>{est?.label}</span>
                    {fechaTarea(t, hoy)}
                    {t.links?.length ? <span className="muted">🔗 {t.links.length}</span> : null}
                  </span>
                </button>
                {asignados.length ? (
                  <span className="tc-caras" title={asignados.map((p) => p.nombre).join(', ')}>
                    {asignados.slice(0, 3).map((p) => (
                      <span key={p.id} className="tc-cara" style={{ background: p.color }}>
                        {iniciales(p.nombre)}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            )
          })}
          <div className="tc-pie">
            <button type="button" className="link-btn" onClick={() => onNuevaTarea(cliente)}>
              + Agregar tarea
            </button>
            {tareas.length > VISIBLES ? (
              <button type="button" className="link-btn tc-mas" onClick={() => setExpandido((v) => !v)}>
                {expandido ? 'Ver menos' : `Ver ${tareas.length - VISIBLES} más`}
              </button>
            ) : null}
          </div>
        </div>

        <div className="tc-agenda">
          <div className="tc-seccion">Próximas 4 semanas</div>
          <div className="tc-semana">
            {semana.map((dia, i) => (
              <button key={dia} type="button" className={`tc-dia${dia === hoy ? ' tc-dia--hoy' : ''}`} onClick={() => onAbrirDia(cliente, dia)} aria-label={`Ver ${dia}`}>
                <span className="tc-dia-nombre">{DIAS_CORTOS[i]}</span>
                <span className="tc-dia-num">{Number(dia.slice(8))}</span>
                <Marcas items={marcasPorDia[dia]} />
              </button>
            ))}
          </div>
          <div className="tc-mes">
            {DIAS_CORTOS.map((d) => (
              <span key={d} className="tc-mes-head">
                {d[0]}
              </span>
            ))}
            {proximas.map((dia) => (
              <button
                key={dia}
                type="button"
                className={`tc-mes-dia${dia === hoy ? ' tc-dia--hoy' : ''}${dia < hoy ? ' tc-mes-dia--pasado' : ''}${marcasPorDia[dia]?.length ? ' tc-mes-dia--con' : ''}`}
                onClick={() => onAbrirDia(cliente, dia)}
                aria-label={`Ver ${dia}`}
              >
                <span>{dia.endsWith('-01') ? formatFechaCorta(dia) : Number(dia.slice(8))}</span>
                <Marcas items={marcasPorDia[dia]} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
