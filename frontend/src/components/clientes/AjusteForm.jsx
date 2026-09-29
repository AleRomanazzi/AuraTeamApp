import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import MoneyInput from '../ui/MoneyInput'
import { api } from '../../lib/api'
import { fmt, todayISO } from '../../lib/format'
import { num } from '../../lib/money'
import { notify, notifyError } from '../../lib/notify'
import { DINERO, invalidar } from '../../lib/queryKeys'

export default function AjusteForm({ contrato, onClose }) {
  const qc = useQueryClient()
  const [modo, setModo] = useState('porcentaje')
  const [f, setF] = useState({ fecha_desde: todayISO().slice(0, 8) + '01', porcentaje: '', monto_nuevo: '', nota: '', actualizar_pendientes: true })
  const actual = num(contrato.monto_actual)
  const nuevo = modo === 'porcentaje' ? Math.round(actual * (1 + num(f.porcentaje) / 100) * 100) / 100 : num(f.monto_nuevo)

  const guardar = useMutation({
    mutationFn: () =>
      api.post(`contratos/${contrato.id}/ajustar/`, {
        fecha_desde: f.fecha_desde,
        nota: f.nota,
        actualizar_pendientes: f.actualizar_pendientes,
        ...(modo === 'porcentaje' ? { porcentaje: f.porcentaje } : { monto_nuevo: f.monto_nuevo }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contratos'] })
      invalidar(qc, DINERO)
      notify('Ajuste aplicado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo aplicar el ajuste'),
  })

  return (
    <Modal
      title={`Ajustar precio — ${contrato.concepto}`}
      onClose={onClose}
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending || nuevo <= 0}>
            Aplicar ajuste
          </button>
        </>
      }
    >
      <div className="segmented">
        <button type="button" className={modo === 'porcentaje' ? 'active' : ''} onClick={() => setModo('porcentaje')}>
          Por porcentaje
        </button>
        <button type="button" className={modo === 'monto' ? 'active' : ''} onClick={() => setModo('monto')}>
          Monto nuevo
        </button>
      </div>
      <div className="grid-2 tight">
        {modo === 'porcentaje' ? (
          <Field label="Aumento (%)" hint="Ej: inflación del trimestre">
            <input type="number" step="0.01" value={f.porcentaje} onChange={(e) => setF((s) => ({ ...s, porcentaje: e.target.value }))} required />
          </Field>
        ) : (
          <Field label="Monto nuevo">
            <MoneyInput value={f.monto_nuevo} onChange={(v) => setF((s) => ({ ...s, monto_nuevo: v }))} required />
          </Field>
        )}
        <Field label="Vigente desde">
          <input type="date" value={f.fecha_desde} onChange={(e) => setF((s) => ({ ...s, fecha_desde: e.target.value }))} required />
        </Field>
      </div>
      <div className="info-box">
        {fmt(actual)} → <strong>{fmt(nuevo)}</strong>
        {actual > 0 && nuevo > 0 ? <span className="muted"> ({(((nuevo - actual) / actual) * 100).toFixed(1)}%)</span> : null}
      </div>
      <Field label="Nota (opcional)">
        <input value={f.nota} onChange={(e) => setF((s) => ({ ...s, nota: e.target.value }))} maxLength={200} placeholder="Ajuste por IPC" />
      </Field>
      <label className="check-row">
        <input type="checkbox" checked={f.actualizar_pendientes} onChange={(e) => setF((s) => ({ ...s, actualizar_pendientes: e.target.checked }))} />{' '}
        Actualizar también los cobros pendientes desde esa fecha
      </label>
    </Modal>
  )
}
