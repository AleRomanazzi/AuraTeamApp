import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { notify, notifyError } from '../../lib/notify'
import { QK } from '../../lib/queryKeys'
import Field from '../ui/Field'
import QueryState from '../ui/QueryState'

function Formulario({ inicial }) {
  const qc = useQueryClient()
  const [f, setF] = useState(inicial)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const guardar = useMutation({
    mutationFn: () => api.put('envios/config/', f).then((r) => r.data),
    onSuccess: (d) => {
      qc.setQueryData(QK.enviosConfig, d)
      setF(d)
      notify('Configuración guardada')
    },
    onError: (e) => notifyError(e, 'No se pudo guardar'),
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        guardar.mutate()
      }}
    >
      <div className="grid-3 tight">
        <Field label="Día del mes para el reporte" hint="Ese día se arman los borradores del mes anterior">
          <input type="number" min={1} max={28} value={f.dia_reporte} onChange={set('dia_reporte')} required />
        </Field>
        <Field label="Recordar días antes del vencimiento" hint="0 = no avisar antes">
          <input type="number" min={0} max={15} value={f.dias_antes} onChange={set('dias_antes')} required />
        </Field>
        <Field label="Si sigue impago, a los días" hint="Separados por coma">
          <input value={f.dias_despues} onChange={set('dias_despues')} placeholder="3,7" />
        </Field>
      </div>
      <button type="submit" className="btn btn-primary btn-sm" disabled={guardar.isPending}>
        Guardar
      </button>
    </form>
  )
}

export default function ConfigEnvios() {
  const q = useQuery({ queryKey: QK.enviosConfig, queryFn: () => api.get('envios/config/').then((r) => r.data) })
  return (
    <div className="card">
      <div className="card-title">
        <span className="dot" /> Emails automáticos a clientes
      </div>
      <p className="muted small">
        Salen desde el Gmail de la agencia, con copia oculta a la misma cuenta, a partir de las 9 h. El recordatorio de cobro (también el día del vencimiento) se activa por cliente en su ficha; el reporte queda
        como borrador para revisar en el Dashboard, salvo los clientes marcados para enviarlo solo.
      </p>
      <QueryState query={q}>{(d) => <Formulario inicial={d} />}</QueryState>
    </div>
  )
}
