import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Field from '../ui/Field'
import Modal from '../ui/Modal'
import MoneyInput from '../ui/MoneyInput'
import { api } from '../../lib/api'
import { MEDIOS_PAGO } from '../../lib/constants'
import { apiErrorMessage } from '../../lib/errors'
import { fmt, monthLabel, todayISO } from '../../lib/format'
import { num } from '../../lib/money'
import { notify, notifyError } from '../../lib/notify'
import { DINERO, invalidar } from '../../lib/queryKeys'

export default function RegistrarPago({ cobro, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ monto: cobro.saldo, fecha: todayISO(), medio_pago: 'transferencia', comprobante: '', notas: '' })
  const [archivo, setArchivo] = useState(null)
  const saldo = num(cobro.saldo)
  const parcial = num(f.monto) > 0 && num(f.monto) < saldo

  const guardar = useMutation({
    mutationFn: async () => {
      const { data: actualizado } = await api.post(`cobros/${cobro.id}/registrar-pago/`, f)
      if (!archivo || !actualizado.transaccion) return { adjunto: null }
      const fd = new FormData()
      fd.append('archivo', archivo)
      try {
        await api.post(`transacciones/${actualizado.transaccion}/adjuntos/`, fd)
        return { adjunto: true }
      } catch (e) {
        return { adjunto: false, error: e }
      }
    },
    onSuccess: ({ adjunto, error }) => {
      invalidar(qc, DINERO)
      notify(parcial ? 'Pago parcial registrado' : 'Cobro registrado')
      if (adjunto === false) {
        notify(`El pago quedó registrado, pero no se pudo adjuntar el comprobante (${apiErrorMessage(error, 'error del servidor')}). Adjuntalo desde Movimientos.`, 'error')
      }
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo registrar el pago'),
  })

  return (
    <Modal
      title="Registrar pago"
      onClose={onClose}
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending || num(f.monto) <= 0 || num(f.monto) > saldo}>
            {guardar.isPending ? 'Registrando…' : 'Registrar'}
          </button>
        </>
      }
    >
      <div className="info-box">
        <strong>{cobro.cliente_nombre}</strong> · {cobro.concepto} · {monthLabel(cobro.periodo)}
        <div className="muted small">
          Total {fmt(cobro.monto)} · ya cobrado {fmt(cobro.monto_cobrado)} · saldo <strong>{fmt(saldo)}</strong>
        </div>
      </div>
      <div className="grid-2 tight">
        <Field label="Monto recibido" hint={parcial ? `Queda un saldo de ${fmt(saldo - num(f.monto))}` : undefined}>
          <MoneyInput value={f.monto} onChange={(v) => setF((s) => ({ ...s, monto: v }))} required />
        </Field>
        <Field label="Fecha">
          <input type="date" value={f.fecha} onChange={(e) => setF((s) => ({ ...s, fecha: e.target.value }))} required />
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Medio de pago">
          <select value={f.medio_pago} onChange={(e) => setF((s) => ({ ...s, medio_pago: e.target.value }))}>
            {MEDIOS_PAGO.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="N.º de comprobante / factura">
          <input value={f.comprobante} onChange={(e) => setF((s) => ({ ...s, comprobante: e.target.value }))} maxLength={80} placeholder="Opcional" />
        </Field>
      </div>
      <Field label="Archivo del comprobante" hint="PDF, JPG, PNG o WEBP · hasta 10 MB. Queda adjunto al ingreso en Movimientos.">
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Notas">
        <textarea rows={2} value={f.notas} onChange={(e) => setF((s) => ({ ...s, notas: e.target.value }))} />
      </Field>
      <p className="muted small">Se crea automáticamente el ingreso en Movimientos.</p>
    </Modal>
  )
}
