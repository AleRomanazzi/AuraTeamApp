import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import MoneyInput from '../ui/MoneyInput'
import { useClientes, usePersonas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { MODALIDADES } from '../../lib/constants'
import { notify, notifyError } from '../../lib/notify'

/** Asigna una persona del equipo a un cliente, con un pago de referencia. Fijar `clienteId` o `personaId` para ocultar ese selector. */
export default function AsignacionForm({ inicial, clienteId, personaId, onClose }) {
  const qc = useQueryClient()
  const { data: clientes = [] } = useClientes()
  const { data: personas = [] } = usePersonas()
  const [f, setF] = useState(() => ({
    cliente: inicial?.cliente ?? clienteId ?? '',
    persona: inicial?.persona ?? personaId ?? '',
    rol: inicial?.rol ?? '',
    modalidad: inicial?.modalidad ?? 'fijo',
    valor: inicial?.valor ?? '',
    activo: inicial?.activo ?? true,
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))

  const guardar = useMutation({
    mutationFn: () => {
      const body = { ...f, valor: f.valor || '0' }
      return inicial?.id ? api.put(`asignaciones-cliente/${inicial.id}/`, body) : api.post('asignaciones-cliente/', body)
    },
    onSuccess: () => {
      ;['asignaciones-cliente', 'clientes', 'personal'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      notify('Asignación guardada')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar la asignación'),
  })

  return (
    <Modal
      title={inicial?.id ? 'Editar asignación' : 'Asignar al equipo'}
      onClose={onClose}
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
      {!clienteId ? (
        <Field label="Cliente">
          <select value={f.cliente} onChange={set('cliente')} required>
            <option value="">Elegí un cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {!personaId ? (
        <Field label="Persona">
          <select value={f.persona} onChange={set('persona')} required>
            <option value="">Elegí una persona</option>
            {personas
              .filter((p) => p.activo || p.id === f.persona)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
          </select>
        </Field>
      ) : null}
      <Field label="Rol en la cuenta">
        <input value={f.rol} onChange={set('rol')} maxLength={80} placeholder="Community manager, diseño, pauta…" />
      </Field>
      <div className="grid-2 tight">
        <Field label="Cómo se paga (referencia)">
          <select value={f.modalidad} onChange={set('modalidad')}>
            {MODALIDADES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={f.modalidad === 'porcentaje' ? 'Porcentaje' : f.modalidad === 'por_pieza' ? 'Valor por pieza' : 'Monto mensual'}>
          {f.modalidad === 'porcentaje' ? (
            <input type="number" min={0} max={100} step="0.01" value={f.valor} onChange={set('valor')} />
          ) : (
            <MoneyInput value={f.valor} onChange={set('valor')} />
          )}
        </Field>
      </div>
      <p className="muted small">Es solo una referencia: los pagos se cargan a mano en «Pagos al equipo → Repartir cobro».</p>
      <label className="check-row">
        <input type="checkbox" checked={f.activo} onChange={(e) => setF((s) => ({ ...s, activo: e.target.checked }))} /> Sigue trabajando en la cuenta
      </label>
    </Modal>
  )
}
