import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import { opcionesEtiqueta, useClientes, useEtiquetas, useMe, usePersonas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { ESTADOS_TAREA, GESTION_INTERNA, PRIORIDADES } from '../../lib/constants'
import { notify, notifyError } from '../../lib/notify'
import { TAREAS, invalidar } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'

const dominio = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Detalle editable de una tarea (en mobile se abre como hoja inferior). `cliente` preselecciona el cliente al crear. */
export default function TareaSheet({ tarea, cliente, onClose }) {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const { data: clientes = [] } = useClientes()
  const { data: personas = [] } = usePersonas()
  const etiquetas = useEtiquetas()
  const esAdmin = Boolean(me?.es_admin)
  const nueva = !tarea?.id
  const editable = nueva || tarea.puede_editar
  const puedeReasignar = esAdmin || nueva || tarea.creado_por === me?.id
  const [f, setF] = useState(() => ({
    titulo: tarea?.titulo ?? '',
    descripcion: tarea?.descripcion ?? '',
    cliente: tarea?.cliente ?? cliente?.id ?? '',
    estado: tarea?.estado ?? 'pendiente',
    prioridad: tarea?.prioridad ?? 'media',
    fecha_limite: tarea?.fecha_limite ?? '',
    etiqueta: tarea?.etiqueta ?? 'historias',
    asignados: tarea?.asignados ?? [],
    links: tarea?.links ?? [],
  }))
  const [link, setLink] = useState({ titulo: '', url: '' })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const toggle = (id) => setF((s) => ({ ...s, asignados: s.asignados.includes(id) ? s.asignados.filter((x) => x !== id) : [...s.asignados, id] }))

  const agregarLink = () => {
    const url = link.url.trim()
    if (!url) return
    setF((s) => ({ ...s, links: [...s.links, { titulo: link.titulo.trim(), url: /^https?:\/\//i.test(url) ? url : `https://${url}` }] }))
    setLink({ titulo: '', url: '' })
  }

  const guardar = useMutation({
    mutationFn: () => {
      const pendiente = link.url.trim() ? [{ titulo: link.titulo.trim(), url: link.url.trim() }] : []
      const body = { ...f, links: [...f.links, ...pendiente], cliente: f.cliente || null, fecha_limite: f.fecha_limite || null }
      if (!puedeReasignar) delete body.asignados
      return nueva ? api.post('tareas/', body) : api.put(`tareas/${tarea.id}/`, body)
    },
    onSuccess: () => {
      invalidar(qc, TAREAS)
      notify(nueva ? 'Tarea creada' : 'Tarea actualizada')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar la tarea'),
  })

  const borrar = useMutation({
    mutationFn: () => api.delete(`tareas/${tarea.id}/`),
    onSuccess: () => {
      invalidar(qc, TAREAS)
      notify('Tarea eliminada')
      onClose()
    },
    onError: (e) => notifyError(e),
  })

  const clienteSel = clientes.find((c) => c.id === Number(f.cliente))

  return (
    <Modal
      title={nueva ? 'Nueva tarea' : editable ? 'Tarea' : 'Tarea (solo lectura)'}
      onClose={onClose}
      size="lg"
      onSubmit={editable ? () => guardar.mutate() : undefined}
      footer={
        <>
          {tarea?.notion_url ? (
            <a className="btn btn-secondary btn-sm modal-footer-start" href={tarea.notion_url} target="_blank" rel="noreferrer">
              Abrir en Notion ↗
            </a>
          ) : null}
          {!nueva && esAdmin ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={borrar.isPending}
              onClick={async () => (await confirmar({ mensaje: `¿Eliminar «${tarea.titulo}»?`, peligro: true, confirmar: 'Eliminar' })) && borrar.mutate()}
            >
              Eliminar
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {editable ? 'Cancelar' : 'Cerrar'}
          </button>
          {editable ? (
            <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          ) : null}
        </>
      }
    >
      <fieldset className="plain-fieldset" disabled={!editable}>
        <div className="tarea-sheet-meta">
          <span className="cat-dot" style={{ background: f.cliente ? clienteSel?.color || 'var(--text-dim)' : 'var(--gold)' }} />
          <select className="select-bare" value={f.cliente ?? ''} onChange={set('cliente')} aria-label="Cliente">
            <option value="">{GESTION_INTERNA}</option>
            {clientes
              .filter((c) => c.estado !== 'baja' || c.id === Number(f.cliente))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
          </select>
          {tarea?.recurrente ? <span className="tarea-sheet-sync">↻ Recurrente</span> : null}
          {tarea?.notion_url ? <span className="tarea-sheet-sync">Sincronizada con Notion</span> : null}
        </div>
        <input className="tarea-sheet-titulo" value={f.titulo} onChange={set('titulo')} required maxLength={200} placeholder="Título de la tarea" aria-label="Título" />

        <div className="tarea-sheet-label">Estado</div>
        <div className="chip-select" role="radiogroup" aria-label="Estado">
          {ESTADOS_TAREA.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={f.estado === s.value} className={`chip chip-estado chip-estado--${s.tag || 'neutral'}${f.estado === s.value ? ' active' : ''}`} onClick={() => setF((x) => ({ ...x, estado: s.value }))}>
              {s.label}
            </button>
          ))}
        </div>

        <div className="grid-2 tight tarea-sheet-grid">
          <Field label="Fecha límite">
            <input type="date" value={f.fecha_limite ?? ''} onChange={set('fecha_limite')} />
          </Field>
          <Field label="Prioridad">
            <select value={f.prioridad} onChange={set('prioridad')}>
              {PRIORIDADES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Calendario" hint="Con fecha, va como día completo a ese calendario de Google.">
            <select value={f.etiqueta} onChange={set('etiqueta')}>
              {opcionesEtiqueta(etiquetas, f.etiqueta).map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Responsables" hint={puedeReasignar ? (nueva ? 'Si no elegís a nadie, la tarea queda a tu nombre.' : null) : 'Solo quien creó la tarea o un administrador puede cambiar los responsables.'}>
          <div className="chip-select">
            {personas
              .filter((p) => p.activo || f.asignados.includes(p.id))
              .map((p) => (
                <button key={p.id} type="button" className={`chip${f.asignados.includes(p.id) ? ' active' : ''}`} onClick={() => toggle(p.id)} aria-pressed={f.asignados.includes(p.id)} disabled={!puedeReasignar}>
                  {p.nombre}
                </button>
              ))}
          </div>
        </Field>

        <Field label="Descripción">
          <textarea rows={4} value={f.descripcion} onChange={set('descripcion')} placeholder="Brief, pasos, observaciones…" />
        </Field>

        <div className="tarea-sheet-label">Links</div>
        {f.links.length ? (
          <div className="tarea-links">
            {f.links.map((l, i) => (
              <div key={`${l.url}-${i}`} className="tarea-link">
                <span className="tarea-link-fav" aria-hidden>
                  {(dominio(l.url)[0] || '?').toUpperCase()}
                </span>
                <a href={l.url} target="_blank" rel="noreferrer" className="tarea-link-main">
                  {l.titulo || dominio(l.url) || l.url}
                  <em> · {dominio(l.url)}</em>
                </a>
                {editable ? (
                  <button type="button" className="link-btn down" aria-label="Quitar link" onClick={() => setF((s) => ({ ...s, links: s.links.filter((_, j) => j !== i) }))}>
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {editable ? (
          <div className="tarea-link-add">
            <input value={link.titulo} onChange={(e) => setLink((s) => ({ ...s, titulo: e.target.value }))} placeholder="Nombre (opcional)" maxLength={120} aria-label="Nombre del link" />
            <input
              value={link.url}
              onChange={(e) => setLink((s) => ({ ...s, url: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  agregarLink()
                }
              }}
              placeholder="https://drive.google.com/…"
              inputMode="url"
              aria-label="URL del link"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={agregarLink} disabled={!link.url.trim()}>
              + Agregar
            </button>
          </div>
        ) : null}
      </fieldset>
    </Modal>
  )
}
