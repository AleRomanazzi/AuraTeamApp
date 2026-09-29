import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import CobrosTabla from '../components/cobros/CobrosTabla'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import MoneyInput from '../components/ui/MoneyInput'
import MonthPicker from '../components/ui/MonthPicker'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import QueryState from '../components/ui/QueryState'
import StatCard from '../components/ui/StatCard'
import Tabs from '../components/ui/Tabs'
import { useClientes } from '../hooks/useData'
import { api, descargarArchivo, getList } from '../lib/api'
import { currentMonth, fmtCorto, monthLabel, todayISO } from '../lib/format'
import { num } from '../lib/money'
import { notify, notifyError } from '../lib/notify'
import { DINERO, QK, invalidar } from '../lib/queryKeys'

function CobroManual({ mes, onClose }) {
  const qc = useQueryClient()
  const { data: clientes = [] } = useClientes()
  const [f, setF] = useState({ cliente: '', concepto: '', monto: '', vencimiento: todayISO(), periodo: mes, notas: '' })
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const guardar = useMutation({
    mutationFn: () => api.post('cobros/', f),
    onSuccess: () => {
      invalidar(qc, DINERO)
      notify('Cobro creado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo crear el cobro'),
  })
  return (
    <Modal
      title="Cobro puntual"
      onClose={onClose}
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
            Crear
          </button>
        </>
      }
    >
      <p className="muted small">Para trabajos extra que no forman parte de un contrato (una campaña, un video, etc.).</p>
      <Field label="Cliente">
        <select value={f.cliente} onChange={set('cliente')} required>
          <option value="">Elegí un cliente</option>
          {clientes
            .filter((c) => c.estado !== 'baja')
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Concepto">
        <input value={f.concepto} onChange={set('concepto')} required maxLength={200} />
      </Field>
      <div className="grid-3 tight">
        <Field label="Monto">
          <MoneyInput value={f.monto} onChange={set('monto')} required />
        </Field>
        <Field label="Vencimiento">
          <input type="date" value={f.vencimiento} onChange={set('vencimiento')} required />
        </Field>
        <Field label="Período">
          <input type="month" value={f.periodo} onChange={set('periodo')} required />
        </Field>
      </div>
    </Modal>
  )
}

export default function Cobros() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const vista = sp.get('vista') || 'mes'
  const mes = sp.get('mes') || currentMonth()
  const [estado, setEstado] = useState('')
  const [cliente, setCliente] = useState('')
  const [manual, setManual] = useState(false)
  const { data: clientes = [] } = useClientes()

  const setParam = (k, v) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    setSp(n, { replace: true })
  }

  const params =
    vista === 'deuda'
      ? { estado: 'abierto', cliente: cliente || undefined }
      : { periodo: mes, estado: estado || undefined, cliente: cliente || undefined }
  const q = useQuery({ queryKey: QK.cobros(params), queryFn: () => getList('cobros/', params) })
  const resumen = useQuery({ queryKey: QK.cobrosResumen({ periodo: mes }), queryFn: () => api.get('cobros/resumen/', { params: { periodo: mes } }).then((r) => r.data) })
  const deuda = useQuery({ queryKey: QK.cobrosResumen({ estado: 'abierto' }), queryFn: () => api.get('cobros/resumen/', { params: { estado: 'abierto' } }).then((r) => r.data) })

  const generar = useMutation({
    mutationFn: () => api.post('cobros/generar/', { mes }).then((r) => r.data),
    onSuccess: (d) => {
      invalidar(qc, DINERO)
      notify(d.creados ? `Se generaron ${d.creados} cobros para ${monthLabel(mes)}` : 'No había cobros nuevos para generar')
    },
    onError: (e) => notifyError(e, 'No se pudieron generar los cobros'),
  })

  const deudaPorCliente = useMemo(() => {
    if (vista !== 'deuda') return []
    const m = {}
    ;(q.data ?? []).forEach((c) => {
      m[c.cliente] = m[c.cliente] || { id: c.cliente, nombre: c.cliente_nombre, color: c.cliente_color, total: 0, vencido: 0, cobros: [] }
      m[c.cliente].total += num(c.saldo)
      if (c.vencido) m[c.cliente].vencido += num(c.saldo)
      m[c.cliente].cobros.push(c)
    })
    return Object.values(m).sort((a, b) => b.vencido - a.vencido || b.total - a.total)
  }, [q.data, vista])

  const r = resumen.data
  const pctCobrado = r && num(r.facturado) > 0 ? (num(r.cobrado) / num(r.facturado)) * 100 : 0

  return (
    <>
      <PageHeader titulo="Cobros" subtitulo="Qué hay que cobrar, qué entró y quién debe">
        {vista === 'mes' ? <MonthPicker value={mes} onChange={(v) => setParam('mes', v)} /> : null}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => descargarArchivo('cobros/export.csv/', vista === 'deuda' ? 'deuda-clientes.csv' : `cobros-${mes}.csv`, params).catch((e) => notifyError(e))}
        >
          ⬇ CSV
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setManual(true)}>
          + Cobro puntual
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={generar.isPending} onClick={() => generar.mutate()}>
          {generar.isPending ? 'Generando…' : `Generar cobros de ${monthLabel(mes, { month: 'long' })}`}
        </button>
      </PageHeader>

      <div className="grid-4">
        <StatCard label={`Facturado ${monthLabel(mes, { month: 'short' })}`} value={fmtCorto(r?.facturado)} color="purple" sub={r ? `${r.cantidad} cobros` : null} />
        <StatCard label="Cobrado" value={fmtCorto(r?.cobrado)} color="green" sub={<ProgressBar valor={pctCobrado} etiqueta="Porcentaje cobrado" />} />
        <StatCard label="Pendiente del mes" value={fmtCorto(r?.pendiente)} color="gold" />
        <StatCard label="Deuda vencida total" value={<span className="down">{fmtCorto(deuda.data?.vencido)}</span>} color="red" sub={`Deuda abierta: ${fmtCorto(deuda.data?.pendiente)}`} onClick={() => setParam('vista', 'deuda')} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="filters">
          <Tabs
            value={vista}
            onChange={(v) => setParam('vista', v === 'mes' ? '' : v)}
            tabs={[
              { value: 'mes', label: 'Por mes' },
              { value: 'deuda', label: 'Deuda por cliente', badge: deuda.data && num(deuda.data.vencido) > 0 ? '!' : null },
            ]}
          />
          {vista === 'mes' ? (
            <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
              <option value="">Todos los estados</option>
              <option value="abierto">Pendientes</option>
              <option value="vencido">Vencidos</option>
              <option value="pagado">Cobrados</option>
              <option value="anulado">Anulados</option>
            </select>
          ) : null}
          <select value={cliente} onChange={(e) => setCliente(e.target.value)} aria-label="Cliente">
            <option value="">Todos los clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <QueryState
          query={q}
          vacio={
            vista === 'deuda' ? (
              '🎉 Ningún cliente debe nada.'
            ) : (
              <>
                No hay cobros en {monthLabel(mes)}. Usá <strong>Generar cobros</strong> para crearlos desde los contratos activos.
              </>
            )
          }
        >
          {vista === 'mes' ? (
            <CobrosTabla cobros={q.data ?? []} />
          ) : (
            deudaPorCliente.map((d) => (
              <div key={d.id} className="deuda-grupo">
                <div className="deuda-grupo-head">
                  <span className="cell-title">
                    <span className="cat-dot" style={{ background: d.color }} />
                    {d.nombre}
                  </span>
                  <span className="mono">
                    {d.vencido > 0 ? <span className="down">{fmtCorto(d.vencido)} vencido · </span> : null}
                    total {fmtCorto(d.total)}
                  </span>
                </div>
                <CobrosTabla cobros={d.cobros} mostrarCliente={false} mostrarPeriodo />
              </div>
            ))
          )}
        </QueryState>
      </div>
      {manual ? <CobroManual mes={mes} onClose={() => setManual(false)} /> : null}
    </>
  )
}
