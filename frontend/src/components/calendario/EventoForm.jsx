import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import { opcionesEtiqueta, useClientes, useEtiquetas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { COLORES, GESTION_INTERNA } from '../../lib/constants'
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
  const etiquetas = useEtiquetas()
  const [f, setF] = useState(() => ({
    titulo: inicial?.titulo ?? '',
    etiqueta: inicial?.etiqueta ?? 'historias',
    inicio: inicial?.inicio ? toDatetimeLocal(inicial.inicio) : `${dia}T10:00`,
    fin: inicial?.fin ? toDatetimeLocal(inicial.fin) : '',
    cliente: inicial?.cliente ?? cliente?.id ?? '',
    color: inicial?.color ?? cliente?.color ?? COLORES[1],
    descripcion: inicial?.descripcion ?? '',
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const soloLectura = Boolean(inicial?.id) && !inicial.puede_editar

  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        inicio: new Date(f.inicio).toISOString(),
        fin: f.fin ? new Date(f.fin).toISOString() : null,
        cliente: f.cliente || null,
      }
      return inicial?.id ? api.put(`cal-eventos/${inicial.id}/`, body) : api.post('cal-eventos/', body)
    },
    onSuccess: () => {
      invalidarAgenda(qc)
      notify(inicial?.id ? 'Evento actualizado' : 'Evento creado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar el evento'),
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
                  (await confirmar({ mensaje: `¿Eliminar «${inicial.titulo}»?${inicial.google_event_id ? ' También se borra de Google Calendar.' : ''}`, peligro: true, confirmar: 'Eliminar' })) &&
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
        <div className="grid-2 tight">
          <Field label="Etiqueta" hint="Calendario de Google donde se guarda.">
            <select value={f.etiqueta} onChange={set('etiqueta')}>
              {opcionesEtiqueta(etiquetas, f.etiqueta).map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cliente" hint="En Google, el evento toma su color.">
            <select value={f.cliente ?? ''} onChange={elegirCliente}>
              <option value="">{GESTION_INTERNA}</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Field>
        </div>
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
      </fieldset>
    </Modal>
  )
}
