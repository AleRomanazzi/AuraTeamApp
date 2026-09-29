import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import MoneyInput from '../components/ui/MoneyInput'
import MonthPicker from '../components/ui/MonthPicker'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import StatCard from '../components/ui/StatCard'
import Tag from '../components/ui/Tag'
import { useCategorias } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { PERIODICIDADES, labelDe } from '../lib/constants'
import { currentMonth, fmt, fmtCorto, monthLabel } from '../lib/format'
import { num, repartirIgual } from '../lib/money'
import { notify, notifyError } from '../lib/notify'
import { DINERO, QK, invalidar } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

const METODOS = [
  { value: 'sin_division', label: 'Sin división' },
  { value: 'partes-iguales', label: 'Partes iguales' },
  { value: 'porcentaje', label: 'Por porcentaje' },
  { value: 'personalizado', label: 'Monto por persona' },
]

function calcularReparto(metodo, total, filas) {
  if (metodo === 'partes-iguales') {
    const montos = repartirIgual(total, filas.length)
    return filas.map((f, i) => ({ ...f, monto: montos[i] }))
  }
  if (metodo === 'porcentaje') {
    let acumulado = 0
    return filas.map((f, i) => {
      const monto = i === filas.length - 1 && filas.reduce((a, x) => a + num(x.porcentaje), 0) === 100 ? Math.round((num(total) - acumulado) * 100) / 100 : Math.round(num(total) * num(f.porcentaje)) / 100
      acumulado += monto
      return { ...f, monto }
    })
  }
  return filas.map((f) => ({ ...f, monto: num(f.monto) }))
}

function SuscripcionForm({ inicial, onClose }) {
  const qc = useQueryClient()
  const { data: categorias = [] } = useCategorias()
  const [f, setF] = useState(() => ({
    nombre: inicial?.nombre ?? '',
    proveedor: inicial?.proveedor ?? '',
    monto_total: inicial?.monto_total ?? '',
    periodicidad: inicial?.periodicidad ?? 'mensual',
    dia_vencimiento: inicial?.dia_vencimiento ?? 1,
    fecha_pago: inicial?.fecha_pago ?? '',
    categoria: inicial?.categoria ?? '',
    metodo: inicial?.metodo ?? 'sin_division',
    mi_parte: inicial?.mi_parte && num(inicial.mi_parte) > 0 ? inicial.mi_parte : '',
    generar_egreso: inicial?.generar_egreso ?? true,
    activo: inicial?.activo ?? true,
  }))
  const [filas, setFilas] = useState(() => (inicial?.detalle?.length ? inicial.detalle.map((d) => ({ ...d })) : [{ nombre: 'Agencia', monto: '', porcentaje: '' }]))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const setFila = (i, k, v) => setFilas((arr) => arr.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const reparto = f.metodo === 'sin_division' ? [] : calcularReparto(f.metodo, f.monto_total, filas)
  const suma = reparto.reduce((a, x) => a + x.monto, 0)
  const diferencia = f.metodo === 'sin_division' ? 0 : Math.round((num(f.monto_total) - suma) * 100) / 100
  const cats = categorias.filter((c) => c.tipo === 'egreso' && c.activa)
  const agencia = num(f.mi_parte) > 0 ? num(f.mi_parte) : num(f.monto_total)

  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        categoria: f.categoria || null,
        fecha_pago: f.fecha_pago || null,
        mi_parte: f.mi_parte || '0',
        detalle: reparto.filter((x) => String(x.nombre).trim()).map((x) => ({ nombre: x.nombre, monto: String(x.monto), ...(f.metodo === 'porcentaje' ? { porcentaje: String(x.porcentaje ?? '') } : {}) })),
      }
      return inicial?.id ? api.put(`servicios/${inicial.id}/`, body) : api.post('servicios/', body)
    },
    onSuccess: () => {
      invalidar(qc, ['servicios', 'dashboard'])
      notify('Suscripción guardada')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar'),
  })

  return (
    <Modal
      title={inicial?.id ? `Editar ${inicial.nombre}` : 'Nueva suscripción'}
      onClose={onClose}
      size="lg"
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <span className="modal-total">
            La agencia paga <strong className="mono">{fmt(agencia)}</strong> {labelDe(PERIODICIDADES, f.periodicidad).toLowerCase()}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending || Math.abs(diferencia) > 1}>
            Guardar
          </button>
        </>
      }
    >
      <div className="grid-2 tight">
        <Field label="Nombre">
          <input value={f.nombre} onChange={set('nombre')} required maxLength={120} placeholder="Canva Pro, Meta Verified, Google Workspace…" />
        </Field>
        <Field label="Proveedor">
          <input value={f.proveedor} onChange={set('proveedor')} maxLength={120} />
        </Field>
      </div>
      <div className="grid-3 tight">
        <Field label="Monto total">
          <MoneyInput value={f.monto_total} onChange={set('monto_total')} required />
        </Field>
        <Field label="Periodicidad">
          <select value={f.periodicidad} onChange={set('periodicidad')}>
            {PERIODICIDADES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Día de débito">
          <input type="number" min={1} max={31} value={f.dia_vencimiento} onChange={set('dia_vencimiento')} required />
        </Field>
      </div>
      <div className="grid-2 tight">
        {f.periodicidad !== 'mensual' ? (
          <Field label="Fecha del último pago" hint="Para saber en qué meses corresponde">
            <input type="date" value={f.fecha_pago ?? ''} onChange={set('fecha_pago')} required />
          </Field>
        ) : null}
        <Field label="Categoría">
          <select value={f.categoria ?? ''} onChange={set('categoria')}>
            <option value="">Software y herramientas</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="calc-box">
        <div className="items-head">
          <span>¿Se comparte el costo?</span>
          <select className="select-sm" value={f.metodo} onChange={set('metodo')} aria-label="Método de división">
            {METODOS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {f.metodo !== 'sin_division' ? (
          <>
            {reparto.map((x, i) => (
              <div key={i} className="item-row">
                <input aria-label="Nombre" placeholder="Nombre" value={x.nombre} onChange={(e) => setFila(i, 'nombre', e.target.value)} />
                {f.metodo === 'porcentaje' ? (
                  <input aria-label="Porcentaje" type="number" step="0.01" placeholder="%" value={x.porcentaje ?? ''} onChange={(e) => setFila(i, 'porcentaje', e.target.value)} />
                ) : null}
                {f.metodo === 'personalizado' ? (
                  <MoneyInput value={filas[i].monto} onChange={(v) => setFila(i, 'monto', v)} />
                ) : (
                  <span className="mono">{fmt(x.monto)}</span>
                )}
                <button type="button" className="link-btn" title="Esta fila es lo que paga la agencia" onClick={() => setF((s) => ({ ...s, mi_parte: String(x.monto) }))}>
                  ← agencia
                </button>
                <button type="button" className="link-btn down" aria-label="Quitar" onClick={() => setFilas((a) => a.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            <div className="items-head">
              <button type="button" className="btn btn-secondary btn-xs" onClick={() => setFilas((a) => [...a, { nombre: '', monto: '', porcentaje: '' }])}>
                + Persona
              </button>
              <span className={`small ${Math.abs(diferencia) > 1 ? 'down' : 'muted'}`}>
                Suma {fmt(suma)} {Math.abs(diferencia) > 1 ? `· faltan ${fmt(diferencia)}` : '✓'}
              </span>
            </div>
          </>
        ) : null}
        <Field label="Parte que paga la agencia" hint="Vacío = paga el total. Solo esta parte se registra como egreso.">
          <MoneyInput value={f.mi_parte} onChange={set('mi_parte')} />
        </Field>
      </div>

      <label className="check-row">
        <input type="checkbox" checked={f.generar_egreso} onChange={(e) => setF((s) => ({ ...s, generar_egreso: e.target.checked }))} /> Registrar el egreso
        automáticamente cada mes que corresponda
      </label>
      <label className="check-row">
        <input type="checkbox" checked={f.activo} onChange={(e) => setF((s) => ({ ...s, activo: e.target.checked }))} /> Activa
      </label>
    </Modal>
  )
}

export default function Suscripciones() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const mes = sp.get('mes') || currentMonth()
  const [editando, setEditando] = useState(null)
  const q = useQuery({ queryKey: QK.servicios(mes), queryFn: () => getList('servicios/', { mes }) })
  const resumen = useQuery({ queryKey: QK.serviciosResumen, queryFn: () => api.get('servicios/resumen/').then((r) => r.data) })

  const generar = useMutation({
    mutationFn: () => api.post('servicios/generar-egresos/', { mes }).then((r) => r.data),
    onSuccess: (d) => {
      invalidar(qc, DINERO)
      notify(d.creados ? `Se registraron ${d.creados} egresos de ${monthLabel(mes)}` : 'No había egresos nuevos para registrar')
    },
    onError: (e) => notifyError(e),
  })
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`servicios/${id}/`),
    onSuccess: () => {
      invalidar(qc, ['servicios', 'dashboard'])
      notify('Suscripción eliminada')
    },
    onError: (e) => notifyError(e),
  })

  const lista = q.data ?? []
  const pendientes = lista.filter((s) => s.activo && s.generar_egreso && !s.pagado_mes).length

  return (
    <>
      <PageHeader titulo="Suscripciones" subtitulo="Herramientas y servicios que paga la agencia todos los meses">
        <MonthPicker value={mes} onChange={(v) => setSp({ mes: v }, { replace: true })} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando({})}>
          + Nueva
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={generar.isPending} onClick={() => generar.mutate()}>
          Registrar egresos de {monthLabel(mes, { month: 'long' })}
        </button>
      </PageHeader>
      <div className="grid-3">
        <StatCard label="Costo mensual" value={fmtCorto(resumen.data?.mensual)} color="red" sub={`${resumen.data?.cantidad ?? 0} activas`} />
        <StatCard label="Costo anual" value={fmtCorto(resumen.data?.anual)} color="gold" />
        <StatCard label={`Sin registrar en ${monthLabel(mes, { month: 'short' })}`} value={pendientes} color="purple" sub="con egreso automático" />
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <QueryState query={q} vacio="No hay suscripciones cargadas.">
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Suscripción</th>
                  <th className="num">Total</th>
                  <th className="num">Paga la agencia</th>
                  <th className="num">Por mes</th>
                  <th>{monthLabel(mes, { month: 'short' })}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((s) => (
                  <tr key={s.id} className={s.activo ? '' : 'row-muted'}>
                    <td>
                      <div className="cell-title">{s.nombre}</div>
                      <div className="cell-sub">
                        {labelDe(PERIODICIDADES, s.periodicidad)} · día {s.dia_vencimiento}
                        {s.proveedor ? ` · ${s.proveedor}` : ''}
                        {s.detalle.length ? ` · compartida (${s.detalle.map((d) => d.nombre).join(', ')})` : ''}
                      </div>
                    </td>
                    <td className="num mono">{fmt(s.monto_total)}</td>
                    <td className="num mono">{fmt(s.monto_agencia)}</td>
                    <td className="num mono">{fmtCorto(s.equivalente_mensual)}</td>
                    <td>
                      {!s.activo ? (
                        <Tag>Inactiva</Tag>
                      ) : !s.generar_egreso ? (
                        <Tag title="No genera egreso automático">Manual</Tag>
                      ) : s.pagado_mes ? (
                        <Tag color="green">Registrado</Tag>
                      ) : (
                        <Tag color="yellow">Pendiente</Tag>
                      )}
                    </td>
                    <td className="nowrap">
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(s)}>
                        Editar
                      </button>{' '}
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        aria-label="Eliminar"
                        onClick={async () =>
                          (await confirmar({ titulo: `Eliminar ${s.nombre}`, mensaje: 'Los egresos ya registrados se conservan en Movimientos. Si ya no la usan, también podés solo desactivarla.', peligro: true, confirmar: 'Eliminar' })) &&
                          borrar.mutate(s.id)
                        }
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </div>
      {editando ? <SuscripcionForm inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
    </>
  )
}
