import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import { insertPrimaryCalendarEvent } from '../../features/google/calendarApi'
import { isSignedIn } from '../../features/google/gapiClient'
import { useClientes } from '../../hooks/useData'
import { api } from '../../lib/api'
import { COLORES } from '../../lib/constants'
import { toDatetimeLocal } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { confirmar } from '../../store/confirmStore'

const invalidarAgenda = (qc) => {
  qc.invalidateQueries({ queryKey: ['cal-eventos'] })
  qc.invalidateQueries({ queryKey: ['google-calendar'] })
  qc.invalidateQueries({ queryKey: ['mi-panel'] })
}

/** Alta/edición de un evento. `cliente` preselecciona el cliente y usa su color. */
export default function EventoForm({ inicial, dia, cliente, onClose }) {
  const qc = useQueryClient()
  const { data: clientes = [] } = useClientes()
  const google = isSignedIn()
  const [f, setF] = useState(() => ({
    titulo: inicial?.titulo ?? '',
    inicio: inicial?.inicio ? toDatetimeLocal(inicial.inicio) : `${dia}T10:00`,
    fin: inicial?.fin ? toDatetimeLocal(inicial.fin) : '',
    cliente: inicial?.cliente ?? cliente?.id ?? '',
    color: inicial?.color ?? cliente?.color ?? COLORES[1],
    descripcion: inicial?.descripcion ?? '',
  }))
  const [copiarGoogle, setCopiarGoogle] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const soloLectura = Boolean(inicial?.id) && !inicial.puede_editar

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
      invalidarAgenda(qc)
      notify(inicial?.id ? 'Evento actualizado' : 'Evento creado')
      onClose()
    },
    onError: (e) => notifyError(e, e?.result?.error?.message || 'No se pudo guardar el evento'),
  })

  const borrar = useMutation({
    mutationFn: () => api.delete(`cal-eventos/${inicial.id}/`),
    onSuccess: () => {
      invalidarAgenda(qc)
      notify('Evento eliminado')
      onClose()
    },
    onError: (e) => notifyError(e),
  })

  const elegirCliente = (e) => {
    const id = e.target.value ? Number(e.target.value) : ''
    const c = clientes.find((x) => x.id === id)
    setF((s) => ({ ...s, cliente: id, color: c?.color || s.color }))
  }

  return (
    <Modal
      title={soloLectura ? 'Evento' : inicial?.id ? 'Editar evento' : 'Nuevo evento'}
      onClose={onClose}
      onSubmit={soloLectura ? undefined : () => guardar.mutate()}
      footer={
        soloLectura ? (
          <span className="muted small">Solo quien creó el evento puede editarlo.</span>
        ) : (
          <>
            {inicial?.id ? (
              <button
                type="button"
                className="btn btn-danger btn-sm modal-footer-start"
                disabled={borrar.isPending}
                onClick={async () =>
                  (await confirmar({ mensaje: `¿Eliminar «${inicial.titulo}»?${inicial.google_event_id ? ' (La copia en Google Calendar no se borra.)' : ''}`, peligro: true, confirmar: 'Eliminar' })) &&
                  borrar.mutate()
                }
              >
                Eliminar
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
              Guardar
            </button>
          </>
        )
      }
    >
      <fieldset className="plain-fieldset" disabled={soloLectura}>
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
          <select value={f.cliente ?? ''} onChange={elegirCliente}>
            <option value="">— Sin cliente —</option>
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
        <Field label="Color" hint={f.cliente ? 'Por defecto, el color del cliente.' : undefined}>
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
      </fieldset>
    </Modal>
  )
}
