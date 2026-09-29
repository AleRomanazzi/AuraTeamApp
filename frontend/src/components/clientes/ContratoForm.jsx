import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import MoneyInput from '../ui/MoneyInput'
import { useCategorias, usePersonas } from '../../hooks/useData'
import { api } from '../../lib/api'
import { PERIODICIDADES_CONTRATO } from '../../lib/constants'
import { todayISO } from '../../lib/format'
import { notify, notifyError } from '../../lib/notify'
import { DINERO, invalidar } from '../../lib/queryKeys'

export default function ContratoForm({ clienteId, inicial, onClose }) {
  const qc = useQueryClient()
  const { data: categorias = [] } = useCategorias()
  const { data: personas = [] } = usePersonas()
  const [f, setF] = useState(() => ({
    concepto: inicial?.concepto ?? 'Fee mensual',
    monto: inicial?.monto ?? '',
    periodicidad: inicial?.periodicidad ?? 'mensual',
    dia_vencimiento: inicial?.dia_vencimiento ?? 10,
    fecha_inicio: inicial?.fecha_inicio ?? todayISO(),
    fecha_fin: inicial?.fecha_fin ?? '',
    categoria: inicial?.categoria ?? '',
    responsable: inicial?.responsable ?? '',
    activo: inicial?.activo ?? true,
    notas: inicial?.notas ?? '',
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const cats = categorias.filter((c) => c.tipo === 'ingreso' && c.activa)
  const tieneAjustes = Boolean(inicial?.ajustes?.length)

  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        cliente: clienteId,
        fecha_fin: f.fecha_fin || null,
        categoria: f.categoria || null,
        responsable: f.responsable || null,
      }
      return inicial?.id ? api.put(`contratos/${inicial.id}/`, body) : api.post('contratos/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contratos'] })
      invalidar(qc, DINERO)
      notify(inicial?.id ? 'Contrato actualizado' : 'Contrato creado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar el contrato'),
  })

  return (
    <Modal
      title={inicial?.id ? 'Editar contrato' : 'Nuevo contrato / servicio'}
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
        <Field label="Concepto">
          <input value={f.concepto} onChange={set('concepto')} required maxLength={160} placeholder="Fee mensual redes, pauta, web…" />
        </Field>
        <Field label="Monto" hint={tieneAjustes ? 'Para aumentos usá «Ajustar precio» y queda el historial.' : undefined}>
          <MoneyInput value={f.monto} onChange={set('monto')} required />
        </Field>
      </div>
      <div className="grid-3 tight">
        <Field label="Periodicidad">
          <select value={f.periodicidad} onChange={set('periodicidad')}>
            {PERIODICIDADES_CONTRATO.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Día de vencimiento">
          <input type="number" min={1} max={31} value={f.dia_vencimiento} onChange={set('dia_vencimiento')} required />
        </Field>
        <Field label="Categoría">
          <select value={f.categoria ?? ''} onChange={set('categoria')}>
            <option value="">Fee mensual (por defecto)</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-3 tight">
        <Field label="Inicio">
          <input type="date" value={f.fecha_inicio} onChange={set('fecha_inicio')} required />
        </Field>
        <Field label="Fin (opcional)">
          <input type="date" value={f.fecha_fin ?? ''} onChange={set('fecha_fin')} />
        </Field>
        <Field label="Responsable">
          <select value={f.responsable ?? ''} onChange={set('responsable')}>
            <option value="">—</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={f.activo} onChange={(e) => setF((s) => ({ ...s, activo: e.target.checked }))} /> Activo (genera cobros
        automáticamente)
      </label>
      <Field label="Notas">
        <textarea rows={2} value={f.notas} onChange={set('notas')} />
      </Field>
    </Modal>
  )
}
