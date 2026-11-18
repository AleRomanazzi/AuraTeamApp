import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useEtiquetas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { ESTADOS_TAREA, PRIORIDADES } from '../../lib/constants'
import { notify, notifyError } from '../../lib/notify'
import { TAREAS, invalidar } from '../../lib/queryKeys'
import { confirmar } from '../../store/confirmStore'

/** Barra de acciones sobre las tareas seleccionadas: cada cambio se aplica a todas de una vez. */
export default function LoteBar({ ids, personas, esAdmin, onListo, onCancelar }) {
  const qc = useQueryClient()
  const etiquetas = useEtiquetas()
  const [fecha, setFecha] = useState('')
  const aplicar = useMutation({
    mutationFn: (body) => api.post('tareas/lote/', { ids, ...body }).then((r) => r.data),
    onSuccess: (r) => {
      invalidar(qc, TAREAS)
      if (r.hechas) notify(`${r.hechas} tarea${r.hechas === 1 ? '' : 's'} actualizada${r.hechas === 1 ? '' : 's'}`)
      if (r.errores.length) {
        toast.error(`${r.errores.length} sin cambios: ${r.errores.map((e) => `«${e.titulo}» (${e.detalle})`).join(' · ')}`, { duration: 8000 })
      } else {
        onListo()
      }
    },
    onError: (e) => notifyError(e, 'No se pudieron aplicar los cambios'),
  })
  const cambiar = (cambios) => aplicar.mutate({ cambios })
  const elegir = (fn) => (e) => {
    const v = e.target.value
    e.target.value = ''
    if (v) fn(v)
  }

  return (
    <div className="lote-bar" role="toolbar" aria-label="Acciones sobre las tareas seleccionadas">
      <strong>
        {ids.length} seleccionada{ids.length === 1 ? '' : 's'}
      </strong>
      <fieldset className="plain-fieldset lote-acciones" disabled={!ids.length || aplicar.isPending}>
        <select className="select-sm" defaultValue="" onChange={elegir((estado) => cambiar({ estado }))} aria-label="Cambiar estado">
          <option value="">Estado…</option>
          {ESTADOS_TAREA.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <span className="lote-fecha">
          <input type="date" className="select-sm" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Nueva fecha límite" />
          <button type="button" className="btn btn-secondary btn-xs" disabled={!fecha} onClick={() => cambiar({ fecha_limite: fecha })}>
            Fijar fecha
          </button>
        </span>
        <select className="select-sm" defaultValue="" onChange={elegir((prioridad) => cambiar({ prioridad }))} aria-label="Cambiar prioridad">
          <option value="">Prioridad…</option>
          {PRIORIDADES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select className="select-sm" defaultValue="" onChange={elegir((etiqueta) => cambiar({ etiqueta }))} aria-label="Cambiar calendario">
          <option value="">Calendario…</option>
          {etiquetas.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
        <select className="select-sm" defaultValue="" onChange={elegir((id) => cambiar({ agregar: [Number(id)] }))} aria-label="Sumar responsable">
          <option value="">+ Responsable…</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <select className="select-sm" defaultValue="" onChange={elegir((id) => cambiar({ quitar: [Number(id)] }))} aria-label="Quitar responsable">
          <option value="">− Responsable…</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        {esAdmin ? (
          <button
            type="button"
            className="btn btn-danger btn-xs"
            onClick={async () =>
              (await confirmar({ mensaje: `¿Eliminar ${ids.length} tarea${ids.length === 1 ? '' : 's'}?`, peligro: true, confirmar: 'Eliminar' })) && aplicar.mutate({ borrar: true })
            }
          >
            Eliminar
          </button>
        ) : null}
      </fieldset>
      <button type="button" className="btn btn-secondary btn-xs" onClick={onCancelar}>
        Listo
      </button>
    </div>
  )
}
