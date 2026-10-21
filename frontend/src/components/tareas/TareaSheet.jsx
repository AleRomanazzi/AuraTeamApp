import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import ProgressBar from '../ui/ProgressBar'
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
    subtareas: (tarea?.subtareas ?? []).map((s) => ({ ...s, key: s.id })),
  }))
  const [link, setLink] = useState({ titulo: '', url: '' })
  const [nuevaSub, setNuevaSub] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const toggle = (id) => setF((s) => ({ ...s, asignados: s.asignados.includes(id) ? s.asignados.filter((x) => x !== id) : [...s.asignados, id] }))

  const agregarSub = () => {
    const titulo = nuevaSub.trim()
    if (!titulo) return
    setF((s) => ({ ...s, subtareas: [...s.subtareas, { key: `nueva-${s.subtareas.length}-${titulo}`, titulo, hecha: false }] }))
    setNuevaSub('')
  }

  const tildar = useMutation({
    mutationFn: ({ id, hecha }) => api.patch(`tareas/${tarea.id}/subtareas/${id}/`, { hecha }),
    onSuccess: (r) => {
      const data = r.data
      setF((s) => ({
        ...s,
        estado: data.estado,
        subtareas: s.subtareas.map((sub) => {
          if (!sub.id) return sub
          const remoto = (data.subtareas || []).find((x) => x.id === sub.id)
          return remoto ? { ...sub, hecha: remoto.hecha } : sub
        }),
      }))
      invalidar(qc, TAREAS)
    },
    onError: (e, vars) => {
      setF((s) => ({ ...s, subtareas: s.subtareas.map((x) => (x.key === vars.key ? { ...x, hecha: !vars.hecha } : x)) }))
      notifyError(e, 'No se pudo actualizar la subtarea')
    },
  })

  const alternarSub = (sub) => {
    const hecha = !sub.hecha
    setF((s) => ({ ...s, subtareas: s.subtareas.map((x) => (x.key === sub.key ? { ...x, hecha } : x)) }))
    if (!tarea?.id || !sub.id) return
    tildar.mutate({ id: sub.id, hecha, key: sub.key })
  }

  const agregarLink = () => {
    const url = link.url.trim()
    if (!url) return
    setF((s) => ({ ...s, links: [...s.links, { titulo: link.titulo.trim(), url: /^https?:\/\//i.test(url) ? url : `https://${url}` }] }))
    setLink({ titulo: '', url: '' })
  }

  const guardar = useMutation({
    mutationFn: () => {
      const pendiente = link.url.trim() ? [{ titulo: link.titulo.trim(), url: link.url.trim() }] : []
      const subtareas = f.subtareas
        .map((s, i) => ({ ...(s.id ? { id: s.id } : {}), titulo: s.titulo.trim(), hecha: Boolean(s.hecha), orden: i }))
        .filter((s) => s.titulo)
      const body = {
        ...f,
        subtareas,
        links: [...f.links, ...pendiente],
        cliente: f.cliente || null,
        fecha_limite: f.fecha_limite || null,
      }
      delete body.key
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
  const hechasSub = f.subtareas.filter((s) => s.hecha).length
  const totalSub = f.subtareas.length
  const pctSub = totalSub ? Math.round((100 * hechasSub) / totalSub) : 0

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

        <div className="tarea-sheet-label">Subtareas</div>
        {totalSub ? (
          <div className="tarea-progreso">
            <span>
              {hechasSub}/{totalSub}
            </span>
            <span>{pctSub}%</span>
            <ProgressBar valor={pctSub} color={pctSub === 100 ? 'var(--success)' : 'var(--accent)'} etiqueta="Avance de la tarea" />
          </div>
        ) : null}
        {totalSub ? (
          <div className="tarea-subtareas">
            {f.subtareas.map((s) => (
              <div key={s.key} className="tarea-subtarea">
                <button
                  type="button"
                  className={`tc-check${s.hecha ? ' on' : ''}`}
                  role="checkbox"
                  aria-checked={s.hecha}
                  aria-label={s.hecha ? `Destildar «${s.titulo || 'subtarea'}»` : `Tildar «${s.titulo || 'subtarea'}»`}
                  disabled={!editable || tildar.isPending}
                  onClick={() => alternarSub(s)}
                />
                <input
                  value={s.titulo}
                  onChange={(e) => setF((st) => ({ ...st, subtareas: st.subtareas.map((x) => (x.key === s.key ? { ...x, titulo: e.target.value } : x)) }))}
                  maxLength={200}
                  aria-label="Título de la subtarea"
                  placeholder="Subtarea"
                />
                {editable ? (
                  <button type="button" className="link-btn down" aria-label="Quitar subtarea" onClick={() => setF((st) => ({ ...st, subtareas: st.subtareas.filter((x) => x.key !== s.key) }))}>
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {editable ? (
          <div className="tarea-link-add tarea-sub-add">
            <input
              value={nuevaSub}
              onChange={(e) => setNuevaSub(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  agregarSub()
                }
              }}
              placeholder="Nueva subtarea"
              maxLength={200}
              aria-label="Nueva subtarea"
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={agregarSub} disabled={!nuevaSub.trim()}>
              + Agregar
            </button>
          </div>
        ) : null}

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
