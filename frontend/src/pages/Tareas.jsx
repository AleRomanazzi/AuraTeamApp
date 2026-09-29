import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import Tag from '../components/ui/Tag'
import { useClientes, useEsAdmin, usePersonas } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { ESTADOS_TAREA, PRIORIDADES, labelDe } from '../lib/constants'
import { formatFechaCorta } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { QK, invalidar } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

const ORDEN_PRIORIDAD = { alta: 0, media: 1, baja: 2 }

function TareaForm({ inicial, onClose }) {
  const qc = useQueryClient()
  const { data: clientes = [] } = useClientes()
  const { data: personas = [] } = usePersonas()
  const [f, setF] = useState(() => ({
    titulo: inicial?.titulo ?? '',
    descripcion: inicial?.descripcion ?? '',
    cliente: inicial?.cliente ?? '',
    estado: inicial?.estado ?? 'pendiente',
    prioridad: inicial?.prioridad ?? 'media',
    fecha_limite: inicial?.fecha_limite ?? '',
    asignados: inicial?.asignados ?? [],
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const toggle = (id) => setF((s) => ({ ...s, asignados: s.asignados.includes(id) ? s.asignados.filter((x) => x !== id) : [...s.asignados, id] }))

  const guardar = useMutation({
    mutationFn: () => {
      const body = { ...f, cliente: f.cliente || null, fecha_limite: f.fecha_limite || null }
      return inicial?.id ? api.put(`tareas/${inicial.id}/`, body) : api.post('tareas/', body)
    },
    onSuccess: () => {
      invalidar(qc, ['tareas', 'dashboard', 'mi-panel', 'vencimientos'])
      notify(inicial?.id ? 'Tarea actualizada' : 'Tarea creada')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar la tarea'),
  })

  return (
    <Modal
      title={inicial?.id ? 'Editar tarea' : 'Nueva tarea'}
      onClose={onClose}
      size="lg"
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
        <input value={f.titulo} onChange={set('titulo')} required maxLength={200} placeholder="Grilla de noviembre, reel de lanzamiento…" />
      </Field>
      <Field label="Descripción">
        <textarea rows={3} value={f.descripcion} onChange={set('descripcion')} />
      </Field>
      <div className="grid-2 tight">
        <Field label="Cliente">
          <select value={f.cliente ?? ''} onChange={set('cliente')}>
            <option value="">— Interna —</option>
            {clientes
              .filter((c) => c.estado !== 'baja' || c.id === f.cliente)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Fecha límite">
          <input type="date" value={f.fecha_limite ?? ''} onChange={set('fecha_limite')} />
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Estado">
          <select value={f.estado} onChange={set('estado')}>
            {ESTADOS_TAREA.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
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
      </div>
      <Field label="Responsables">
        <div className="chip-select">
          {personas
            .filter((p) => p.activo || f.asignados.includes(p.id))
            .map((p) => (
              <button key={p.id} type="button" className={`chip${f.asignados.includes(p.id) ? ' active' : ''}`} onClick={() => toggle(p.id)} aria-pressed={f.asignados.includes(p.id)}>
                {p.nombre}
              </button>
            ))}
        </div>
      </Field>
    </Modal>
  )
}

export default function Tareas() {
  const qc = useQueryClient()
  const esAdmin = useEsAdmin()
  const { data: clientes = [] } = useClientes()
  const { data: personas = [] } = usePersonas()
  const [cliente, setCliente] = useState('')
  const [persona, setPersona] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState(null)
  const params = { cliente: cliente || undefined, persona: persona || undefined }
  const q = useQuery({ queryKey: QK.tareas(params), queryFn: () => getList('tareas/', params) })

  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }) => api.patch(`tareas/${id}/`, { estado }),
    onSuccess: () => invalidar(qc, ['tareas', 'dashboard', 'mi-panel']),
    onError: (e) => notifyError(e),
  })
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`tareas/${id}/`),
    onSuccess: () => {
      invalidar(qc, ['tareas', 'dashboard', 'mi-panel'])
      notify('Tarea eliminada')
    },
    onError: (e) => notifyError(e),
  })

  const columnas = useMemo(() => {
    const s = busqueda.trim().toLowerCase()
    const lista = (q.data ?? []).filter((t) => !s || `${t.titulo} ${t.descripcion} ${t.cliente_nombre ?? ''}`.toLowerCase().includes(s))
    return ESTADOS_TAREA.map((e) => ({
      ...e,
      tareas: lista
        .filter((t) => t.estado === e.value)
        .sort((a, b) =>
          e.value === 'hecha'
            ? String(b.completada_en).localeCompare(String(a.completada_en))
            : ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999')),
        ),
    }))
  }, [q.data, busqueda])

  return (
    <>
      <PageHeader titulo={esAdmin ? 'Tareas' : 'Mis tareas'} subtitulo={esAdmin ? 'Qué hay que hacer, para quién y para cuándo' : 'Actualizá el estado a medida que avanzás'}>
        {esAdmin ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
            + Nueva tarea
          </button>
        ) : null}
      </PageHeader>
      <div className="filters">
        <input type="search" placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar tareas" />
        <select value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Cliente">
          <option value="">Todos los clientes</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        {esAdmin ? (
          <select value={persona} onChange={(e) => setPersona(e.target.value)} aria-label="Persona">
            <option value="">Todo el equipo</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <QueryState query={q} vacio={esAdmin ? 'No hay tareas. Creá la primera.' : 'No tenés tareas asignadas.'}>
        <div className="board">
          {columnas.map((col) => (
            <div key={col.value} className="board-col">
              <div className="board-col-head">
                <Tag color={col.tag}>{col.label}</Tag>
                <span className="muted small">{col.tareas.length}</span>
              </div>
              {col.tareas.map((t) => (
                <div key={t.id} className={`task-card${t.vencida ? ' task-card--late' : ''}`}>
                  <div className="task-card-top">
                    {t.cliente_nombre ? (
                      <span className="small">
                        <span className="cat-dot" style={{ background: t.cliente_color }} />
                        {t.cliente_nombre}
                      </span>
                    ) : (
                      <span className="small muted">Interna</span>
                    )}
                    <Tag color={PRIORIDADES.find((p) => p.value === t.prioridad)?.tag}>{labelDe(PRIORIDADES, t.prioridad)}</Tag>
                  </div>
                  <div className="task-card-title">{t.titulo}</div>
                  {t.descripcion ? <div className="task-card-desc">{t.descripcion}</div> : null}
                  <div className="task-card-foot">
                    <span className={`small ${t.vencida ? 'down' : 'muted'}`}>
                      {t.fecha_limite ? `${t.vencida ? '⚠ ' : ''}${formatFechaCorta(t.fecha_limite)}` : 'Sin fecha'}
                      {t.asignados_nombres.length ? ` · ${t.asignados_nombres.join(', ')}` : ''}
                    </span>
                  </div>
                  <div className="task-card-actions">
                    <select className="select-sm" aria-label="Cambiar estado" value={t.estado} onChange={(e) => cambiarEstado.mutate({ id: t.id, estado: e.target.value })}>
                      {ESTADOS_TAREA.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {esAdmin ? (
                      <>
                        <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(t)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-xs"
                          aria-label="Eliminar tarea"
                          onClick={async () => (await confirmar({ mensaje: `¿Eliminar «${t.titulo}»?`, peligro: true, confirmar: 'Eliminar' })) && borrar.mutate(t.id)}
                        >
                          🗑
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </QueryState>
      {editando ? <TareaForm inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
    </>
  )
}
