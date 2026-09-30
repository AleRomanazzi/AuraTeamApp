import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import { api } from '../../lib/api'
import { COLORES, COLORES_GOOGLE, ESTADOS_CLIENTE } from '../../lib/constants'
import { todayISO } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'

const VACIO = {
  nombre: '',
  razon_social: '',
  cuit: '',
  rubro: '',
  contacto: '',
  email: '',
  whatsapp: '',
  estado: 'activo',
  fecha_alta: todayISO(),
  color: COLORES[0],
  google_color: '',
  palabras_clave: '',
  notas: '',
}

export default function ClienteForm({ inicial, onClose, onGuardado }) {
  const qc = useQueryClient()
  const [f, setF] = useState(() => ({ ...VACIO, ...(inicial || {}) }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  const guardar = useMutation({
    mutationFn: () => {
      const body = Object.fromEntries(Object.keys(VACIO).map((k) => [k, f[k]]))
      return (inicial?.id ? api.put(`clientes/${inicial.id}/`, body) : api.post('clientes/', body)).then((r) => r.data)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['clientes'] })
      notify(inicial?.id ? 'Cliente actualizado' : 'Cliente creado')
      onGuardado?.(data)
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar el cliente'),
  })

  return (
    <Modal
      title={inicial?.id ? `Editar ${inicial.nombre}` : 'Nuevo cliente'}
      onClose={onClose}
      size="lg"
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      <div className="grid-2 tight">
        <Field label="Nombre / marca">
          <input value={f.nombre} onChange={set('nombre')} required maxLength={120} />
        </Field>
        <Field label="Estado">
          <select value={f.estado} onChange={set('estado')}>
            {ESTADOS_CLIENTE.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Razón social">
          <input value={f.razon_social} onChange={set('razon_social')} maxLength={160} />
        </Field>
        <Field label="CUIT">
          <input value={f.cuit} onChange={set('cuit')} maxLength={20} placeholder="30-12345678-9" />
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Rubro">
          <input value={f.rubro} onChange={set('rubro')} maxLength={80} placeholder="Gastronomía, salud…" />
        </Field>
        <Field label="Fecha de alta">
          <input type="date" value={f.fecha_alta} onChange={set('fecha_alta')} />
        </Field>
      </div>
      <div className="grid-3 tight">
        <Field label="Contacto">
          <input value={f.contacto} onChange={set('contacto')} maxLength={120} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="WhatsApp" hint="Con código de país: 5493511234567">
          <input value={f.whatsapp} onChange={set('whatsapp')} maxLength={40} inputMode="tel" />
        </Field>
      </div>
      <Field label="Color" hint={`Es también el color de sus eventos en Google Calendar${f.google_color ? ` (${COLORES_GOOGLE.find((c) => c.value === f.google_color)?.label})` : ''}.`}>
        <div className="color-picker">
          {COLORES_GOOGLE.map((c) => (
            <button
              key={c.value}
              type="button"
              className={`color-swatch${f.google_color === c.value ? ' active' : ''}`}
              style={{ background: c.hex }}
              aria-label={`Color ${c.label}`}
              title={c.label}
              onClick={() => setF((s) => ({ ...s, google_color: c.value, color: c.hex }))}
            />
          ))}
        </div>
      </Field>
      <Field label="Palabras clave" hint="Separadas por coma. Sirven para reconocer al cliente en eventos cargados directo en Google (además de su nombre).">
        <input value={f.palabras_clave} onChange={set('palabras_clave')} maxLength={200} placeholder="Cycles, Ferreyra" />
      </Field>
      <Field label="Notas">
        <textarea rows={3} value={f.notas} onChange={set('notas')} />
      </Field>
    </Modal>
  )
}
