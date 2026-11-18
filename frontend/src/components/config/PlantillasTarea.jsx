import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import QueryState from '../ui/QueryState'
import { useEtiquetas, usePersonas } from '../../hooks/useData'
import { api, getList } from '../../lib/api'
import { PRIORIDADES, labelDe } from '../../lib/constants'
import { notify, notifyError } from '../../lib/notify'
import { QK } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'

function PlantillaForm({ inicial, onClose }) {
  const qc = useQueryClient()
  const etiquetas = useEtiquetas()
  const { data: personas = [] } = usePersonas()
  const [f, setF] = useState(() => ({
    nombre: inicial?.nombre ?? '',
    titulo: inicial?.titulo ?? '',
    descripcion: inicial?.descripcion ?? '',
    etiqueta: inicial?.etiqueta ?? '',
    prioridad: inicial?.prioridad ?? 'media',
    dias_plazo: inicial?.dias_plazo ?? '',
    personas: inicial?.personas ?? [],
    checklist: (inicial?.subtareas ?? []).join('\n'),
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const toggle = (id) => setF((s) => ({ ...s, personas: s.personas.includes(id) ? s.personas.filter((x) => x !== id) : [...s.personas, id] }))
  const guardar = useMutation({
    mutationFn: () => {
      const { checklist, ...resto } = f
      const body = { ...resto, dias_plazo: f.dias_plazo === '' ? null : Number(f.dias_plazo), subtareas: checklist.split('\n') }
      return inicial?.id ? api.put(`plantillas-tarea/${inicial.id}/`, body) : api.post('plantillas-tarea/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.plantillas })
      notify('Plantilla guardada')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar la plantilla'),
  })
  return (
    <Modal
      title={inicial?.id ? `Editar «${inicial.nombre}»` : 'Nueva plantilla'}
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
      <div className="grid-2 tight">
        <Field label="Nombre de la plantilla">
          <input value={f.nombre} onChange={set('nombre')} required maxLength={80} placeholder="Reel, Cobertura de evento…" />
        </Field>
        <Field label="Título de la tarea" hint="Opcional: se puede completar al usarla.">
          <input value={f.titulo} onChange={set('titulo')} maxLength={200} />
        </Field>
      </div>
      <div className="grid-3 tight">
        <Field label="Calendario">
          <select value={f.etiqueta} onChange={set('etiqueta')}>
            <option value="">— No cambiar —</option>
            {etiquetas.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
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
        <Field label="Plazo (días)" hint="Fecha límite = hoy + estos días. Vacío: sin fecha.">
          <input type="number" min={0} max={365} value={f.dias_plazo} onChange={set('dias_plazo')} />
        </Field>
      </div>
      <Field label="Responsables" hint="Opcional. Si no elegís, quedan los que ya tenga la tarea.">
        <div className="chip-select">
          {personas
            .filter((p) => p.activo || f.personas.includes(p.id))
            .map((p) => (
              <button key={p.id} type="button" className={`chip${f.personas.includes(p.id) ? ' active' : ''}`} onClick={() => toggle(p.id)} aria-pressed={f.personas.includes(p.id)}>
                {p.nombre}
              </button>
            ))}
        </div>
      </Field>
      <Field label="Descripción">
        <textarea rows={3} value={f.descripcion} onChange={set('descripcion')} placeholder="Brief, pasos, observaciones…" />
      </Field>
      <Field label="Checklist" hint="Un ítem por línea.">
        <textarea rows={5} value={f.checklist} onChange={set('checklist')} placeholder={'Guion\nGrabación\nEdición\nAprobación del cliente'} />
      </Field>
    </Modal>
  )
}

/** Moldes para crear tareas que se repiten a mano: se eligen en «Usar plantilla…» al crear una tarea. */
export default function PlantillasTarea() {
  const qc = useQueryClient()
  const etiquetas = useEtiquetas()
  const { data: personas = [] } = usePersonas()
  const q = useQuery({ queryKey: QK.plantillas, queryFn: () => getList('plantillas-tarea/') })
  const [editando, setEditando] = useState(null)
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`plantillas-tarea/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.plantillas }),
    onError: (e) => notifyError(e),
  })
  const nombres = (ids) =>
    ids
      .map((id) => personas.find((p) => p.id === id)?.nombre)
      .filter(Boolean)
      .join(', ')
  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" /> Plantillas de tarea
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
          + Plantilla
        </button>
      </div>
      <p className="muted small">Al crear una tarea, «Usar plantilla…» completa título, calendario, prioridad, responsables, plazo y checklist.</p>
      <QueryState query={q} vacio="Todavía no hay plantillas.">
        {(lista) =>
          lista.map((p) => (
            <div key={p.id} className="list-row">
              <div className="list-row-main">
                <div className="list-row-title">{p.nombre}</div>
                <div className="list-row-sub">
                  {[
                    p.etiqueta && labelDe(etiquetas, p.etiqueta),
                    `prioridad ${labelDe(PRIORIDADES, p.prioridad).toLowerCase()}`,
                    p.dias_plazo !== null && `${p.dias_plazo} días de plazo`,
                    p.subtareas.length && `${p.subtareas.length} ítems`,
                    p.personas.length && nombres(p.personas),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <div className="nowrap">
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(p)}>
                  Editar
                </button>{' '}
                <button
                  type="button"
                  className="btn btn-danger btn-xs"
                  onClick={async () => (await confirmar({ mensaje: `¿Eliminar la plantilla «${p.nombre}»?`, peligro: true, confirmar: 'Eliminar' })) && borrar.mutate(p.id)}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))
        }
      </QueryState>
      {editando ? <PlantillaForm inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
    </div>
  )
}
