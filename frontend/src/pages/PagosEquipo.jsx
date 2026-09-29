import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import MoneyInput from '../components/ui/MoneyInput'
import MonthPicker from '../components/ui/MonthPicker'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import QueryState from '../components/ui/QueryState'
import StatCard from '../components/ui/StatCard'
import Tag from '../components/ui/Tag'
import { useClientes, usePersonas } from '../hooks/useData'
import { api, descargarArchivo, getList } from '../lib/api'
import { ESTADOS_LIQUIDACION, MEDIOS_PAGO, MODALIDADES, labelDe } from '../lib/constants'
import { currentMonth, fmt, fmtCorto, formatFechaCorta, monthLabel, todayISO } from '../lib/format'
import { num } from '../lib/money'
import { notify, notifyError } from '../lib/notify'
import { DINERO, QK, invalidar } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

function LiquidacionForm({ inicial, mes, onClose }) {
  const qc = useQueryClient()
  const { data: personas = [] } = usePersonas()
  const { data: clientes = [] } = useClientes()
  const [f, setF] = useState(() => ({
    persona: inicial?.persona ?? '',
    periodo: inicial?.periodo ?? mes,
    concepto: inicial?.concepto ?? '',
    cliente: inicial?.cliente ?? '',
    monto_base: inicial?.monto_base ?? '',
    notas: inicial?.notas ?? '',
  }))
  const [items, setItems] = useState(() => (inicial?.items ?? []).map((i) => ({ ...i })))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const setItem = (idx, k, v) => setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, [k]: v } : it)))
  const total = num(f.monto_base) + items.reduce((a, i) => a + num(i.cantidad) * num(i.monto_unitario), 0)

  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        cliente: f.cliente || null,
        monto_base: f.monto_base || '0',
        items: items.filter((i) => i.concepto.trim()).map(({ concepto, cantidad, monto_unitario }) => ({ concepto, cantidad: cantidad || '0', monto_unitario: monto_unitario || '0' })),
      }
      return inicial?.id ? api.put(`liquidaciones/${inicial.id}/`, body) : api.post('liquidaciones/', body)
    },
    onSuccess: () => {
      invalidar(qc, DINERO)
      notify('Liquidación guardada')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar'),
  })

  return (
    <Modal
      title={inicial?.id ? `Editar — ${inicial.persona_nombre}` : 'Nueva liquidación'}
      onClose={onClose}
      size="lg"
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <span className="modal-total">
            Total: <strong className="mono">{fmt(total)}</strong>
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
            Guardar
          </button>
        </>
      }
    >
      <div className="grid-2 tight">
        <Field label="Persona">
          <select value={f.persona} onChange={set('persona')} required disabled={Boolean(inicial?.id)}>
            <option value="">Elegí una persona</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Período">
          <input type="month" value={f.periodo} onChange={set('periodo')} required disabled={Boolean(inicial?.id)} />
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Concepto">
          <input value={f.concepto} onChange={set('concepto')} required maxLength={200} placeholder="Bono, trabajo extra…" />
        </Field>
        <Field label="Cliente (opcional)">
          <select value={f.cliente ?? ''} onChange={set('cliente')}>
            <option value="">—</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Monto base">
        <MoneyInput value={f.monto_base} onChange={set('monto_base')} />
      </Field>
      <div className="items-editor">
        <div className="items-head">
          <span>Ítems (piezas, extras; usá montos negativos para descuentos)</span>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => setItems((a) => [...a, { concepto: '', cantidad: '1', monto_unitario: '' }])}>
            + Ítem
          </button>
        </div>
        {items.map((it, i) => (
          <div key={it.id ?? `n${i}`} className="item-row">
            <input aria-label="Concepto" placeholder="Concepto" value={it.concepto} onChange={(e) => setItem(i, 'concepto', e.target.value)} />
            <input aria-label="Cantidad" type="number" step="0.01" value={it.cantidad} onChange={(e) => setItem(i, 'cantidad', e.target.value)} />
            <input aria-label="Valor unitario" type="number" step="0.01" placeholder="Valor unitario" value={it.monto_unitario} onChange={(e) => setItem(i, 'monto_unitario', e.target.value)} />
            <span className="mono">{fmtCorto(num(it.cantidad) * num(it.monto_unitario))}</span>
            <button type="button" className="link-btn down" aria-label="Quitar ítem" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <Field label="Notas">
        <textarea rows={2} value={f.notas} onChange={set('notas')} />
      </Field>
    </Modal>
  )
}

function RepartirForm({ clienteInicial, mes, onClose }) {
  const qc = useQueryClient()
  const { data: personas = [] } = usePersonas()
  const { data: clientes = [] } = useClientes()
  const [f, setF] = useState(() => ({
    cliente: clienteInicial ?? '',
    periodo: mes,
    concepto: '',
    pagado: false,
    fecha: todayISO(),
    medio_pago: 'transferencia',
    comprobante: '',
  }))
  const [filas, setFilas] = useState([{ persona: '', monto: '' }])
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const setFila = (idx, k, v) => setFilas((arr) => arr.map((it, i) => (i === idx ? { ...it, [k]: v } : it)))

  const filtro = { cliente: f.cliente, periodo: f.periodo }
  const cobros = useQuery({ queryKey: QK.cobros(filtro), queryFn: () => getList('cobros/', filtro), enabled: Boolean(f.cliente) })
  const historial = useQuery({
    queryKey: QK.liquidaciones({ cliente: f.cliente }),
    queryFn: () => getList('liquidaciones/', { cliente: f.cliente }),
    enabled: Boolean(f.cliente),
  })
  const asignaciones = useQuery({
    queryKey: QK.asignaciones({ cliente: f.cliente }),
    queryFn: () => getList('asignaciones-cliente/', { cliente: f.cliente }),
    enabled: Boolean(f.cliente),
  })

  const cobrado = (cobros.data ?? []).reduce((a, c) => a + num(c.monto_cobrado), 0)
  const yaRepartido = (historial.data ?? []).filter((l) => l.periodo === f.periodo && l.estado !== 'anulada')
  const sugerencia = useMemo(() => {
    const previas = (historial.data ?? []).filter((l) => l.periodo < f.periodo && l.estado !== 'anulada')
    const ultimo = previas.reduce((m, l) => (l.periodo > m ? l.periodo : m), '')
    if (ultimo) {
      const porPersona = {}
      previas.filter((l) => l.periodo === ultimo).forEach((l) => (porPersona[l.persona] = (porPersona[l.persona] || 0) + num(l.total)))
      return { origen: `reparto de ${monthLabel(ultimo)}`, filas: Object.entries(porPersona).map(([persona, monto]) => ({ persona, monto: String(monto) })) }
    }
    const fijas = (asignaciones.data ?? []).filter((a) => a.activo && a.modalidad === 'fijo' && num(a.valor) > 0)
    return fijas.length ? { origen: 'pagos de referencia del equipo', filas: fijas.map((a) => ({ persona: String(a.persona), monto: a.valor })) } : null
  }, [historial.data, asignaciones.data, f.periodo])

  const total = filas.reduce((a, r) => a + num(r.monto), 0)
  const restante = cobrado - total

  const guardar = useMutation({
    mutationFn: () =>
      api.post('liquidaciones/repartir/', {
        ...f,
        filas: filas.filter((r) => r.persona && num(r.monto) > 0).map((r) => ({ persona: r.persona, monto: r.monto })),
      }),
    onSuccess: (r) => {
      invalidar(qc, DINERO)
      notify(f.pagado ? `${r.data.length} pagos registrados` : `${r.data.length} liquidaciones creadas`)
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar el reparto'),
  })

  return (
    <Modal
      title="Repartir cobro"
      onClose={onClose}
      size="lg"
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <span className="modal-total">
            Repartido <strong className="mono">{fmt(total)}</strong>
            {f.cliente ? (
              <>
                {' '}
                · Agencia <strong className={`mono ${restante < 0 ? 'down' : ''}`}>{fmt(restante)}</strong>
              </>
            ) : null}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending || total <= 0}>
            {f.pagado ? 'Registrar pagos' : 'Crear liquidaciones'}
          </button>
        </>
      }
    >
      <div className="grid-3 tight">
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
        <Field label="Período">
          <input type="month" value={f.periodo} onChange={set('periodo')} required />
        </Field>
        <Field label="Concepto (opcional)">
          <input value={f.concepto} onChange={set('concepto')} maxLength={200} placeholder="Por defecto, el cliente" />
        </Field>
      </div>

      {f.cliente ? (
        <div className="info-box">
          Cobrado en {monthLabel(f.periodo)}: <strong className="mono">{fmt(cobrado)}</strong>
          {yaRepartido.length ? (
            <>
              {' '}
              · ya repartido: <strong className="mono">{fmt(yaRepartido.reduce((a, l) => a + num(l.total), 0))}</strong> ({yaRepartido.length})
            </>
          ) : null}
          {sugerencia ? (
            <>
              {' '}
              ·{' '}
              <button type="button" className="link-btn" onClick={() => setFilas(sugerencia.filas)}>
                Usar {sugerencia.origen}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="items-editor">
        <div className="items-head">
          <span>¿Cuánto le corresponde a cada uno?</span>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => setFilas((a) => [...a, { persona: '', monto: '' }])}>
            + Persona
          </button>
        </div>
        {filas.map((r, i) => (
          <div key={i} className="item-row reparto-row">
            <select aria-label="Persona" value={r.persona} onChange={(e) => setFila(i, 'persona', e.target.value)}>
              <option value="">Persona</option>
              {personas
                .filter((p) => p.activo || String(p.id) === String(r.persona))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
            </select>
            <MoneyInput value={r.monto} onChange={(v) => setFila(i, 'monto', v)} />
            <button type="button" className="link-btn down" aria-label="Quitar persona" onClick={() => setFilas((a) => a.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
      </div>

      <label className="check-row">
        <input type="checkbox" checked={f.pagado} onChange={(e) => setF((s) => ({ ...s, pagado: e.target.checked }))} /> Ya se pagó (registra los egresos)
      </label>
      {f.pagado ? (
        <div className="grid-3 tight">
          <Field label="Fecha de pago">
            <input type="date" value={f.fecha} onChange={set('fecha')} required />
          </Field>
          <Field label="Medio">
            <select value={f.medio_pago} onChange={set('medio_pago')}>
              {MEDIOS_PAGO.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Comprobante">
            <input value={f.comprobante} onChange={set('comprobante')} maxLength={80} />
          </Field>
        </div>
      ) : (
        <p className="muted small">Quedan pendientes: después se revisan, aprueban y pagan desde esta pantalla.</p>
      )}
    </Modal>
  )
}

function PagarForm({ liqs, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ fecha: todayISO(), medio_pago: 'transferencia', comprobante: '' })
  const total = liqs.reduce((a, l) => a + num(l.total), 0)
  const pagar = useMutation({
    mutationFn: async () => {
      for (const l of liqs) await api.post(`liquidaciones/${l.id}/pagar/`, f)
    },
    onSuccess: () => {
      invalidar(qc, DINERO)
      notify(liqs.length > 1 ? `${liqs.length} pagos registrados` : 'Pago registrado')
      onClose()
    },
    onError: (e) => {
      invalidar(qc, DINERO)
      notifyError(e, 'No se pudo registrar el pago')
    },
  })
  return (
    <Modal
      title={`Pagar a ${liqs[0].persona_nombre}`}
      onClose={onClose}
      onSubmit={() => pagar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={pagar.isPending}>
            Pagar {fmt(total)}
          </button>
        </>
      }
    >
      <ul className="report-list">
        {liqs.map((l) => (
          <li key={l.id}>
            {l.concepto} — <span className="mono">{fmt(l.total)}</span>
          </li>
        ))}
      </ul>
      {liqs[0].persona_alias_cbu ? (
        <div className="info-box">
          Alias / CBU: <strong className="mono">{liqs[0].persona_alias_cbu}</strong>{' '}
          <button type="button" className="link-btn" onClick={() => navigator.clipboard?.writeText(liqs[0].persona_alias_cbu).then(() => notify('Copiado'))}>
            Copiar
          </button>
        </div>
      ) : null}
      <div className="grid-3 tight">
        <Field label="Fecha">
          <input type="date" value={f.fecha} onChange={(e) => setF((s) => ({ ...s, fecha: e.target.value }))} required />
        </Field>
        <Field label="Medio">
          <select value={f.medio_pago} onChange={(e) => setF((s) => ({ ...s, medio_pago: e.target.value }))}>
            {MEDIOS_PAGO.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Comprobante">
          <input value={f.comprobante} onChange={(e) => setF((s) => ({ ...s, comprobante: e.target.value }))} maxLength={80} />
        </Field>
      </div>
      <p className="muted small">Se registra el egreso en Movimientos (categoría Honorarios del equipo).</p>
    </Modal>
  )
}

export default function PagosEquipo() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const mes = sp.get('mes') || currentMonth()
  const [editando, setEditando] = useState(null)
  const [pagando, setPagando] = useState(null)
  const [repartiendo, setRepartiendo] = useState(() => (sp.get('repartir') ? { cliente: sp.get('repartir') } : null))
  const params = { periodo: mes }
  const q = useQuery({ queryKey: QK.liquidaciones(params), queryFn: () => getList('liquidaciones/', params) })
  const resumen = useQuery({ queryKey: QK.liquidacionesResumen(params), queryFn: () => api.get('liquidaciones/resumen/', { params }).then((r) => r.data) })

  const cerrarReparto = () => {
    setRepartiendo(null)
    if (sp.get('repartir')) setSp({ mes }, { replace: true })
  }

  const accion = useMutation({
    mutationFn: ({ id, tipo }) => (tipo === 'borrar' ? api.delete(`liquidaciones/${id}/`) : api.post(`liquidaciones/${id}/${tipo}/`)),
    onSuccess: (_, { tipo }) => {
      invalidar(qc, DINERO)
      notify({ aprobar: 'Aprobada', revertir: 'Pago revertido', anular: 'Anulada', borrar: 'Eliminada' }[tipo])
    },
    onError: (e) => notifyError(e),
  })

  const ejecutar = async (l, tipo) => {
    if (tipo !== 'aprobar') {
      const msg = {
        revertir: `Se elimina el egreso de ${fmt(l.total)} y vuelve a «Aprobada».`,
        anular: 'No se pagará este mes (queda en el historial).',
        borrar: 'Se elimina definitivamente.',
      }[tipo]
      if (!(await confirmar({ titulo: `${l.persona_nombre} — ${l.concepto}`, mensaje: msg, peligro: tipo !== 'anular', confirmar: 'Continuar' }))) return
    }
    accion.mutate({ id: l.id, tipo })
  }

  const porPersona = useMemo(() => {
    const m = {}
    ;(q.data ?? []).forEach((l) => {
      m[l.persona] = m[l.persona] || { id: l.persona, nombre: l.persona_nombre, color: l.persona_color, liqs: [] }
      m[l.persona].liqs.push(l)
    })
    return Object.values(m).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [q.data])

  const r = resumen.data
  const pct = r && num(r.total) ? (num(r.pagado) / num(r.total)) * 100 : 0

  return (
    <>
      <PageHeader titulo="Pagos al equipo" subtitulo="Cada cobro se reparte a mano: repartir → aprobar → pagar">
        <MonthPicker value={mes} onChange={(v) => setSp({ mes: v }, { replace: true })} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => descargarArchivo('liquidaciones/export.csv/', `pagos-equipo-${mes}.csv`, params).catch((e) => notifyError(e))}>
          ⬇ CSV
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando({})}>
          + Pago suelto
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setRepartiendo({})}>
          Repartir cobro
        </button>
      </PageHeader>

      <div className="grid-3">
        <StatCard label={`A pagar ${monthLabel(mes, { month: 'short' })}`} value={fmtCorto(r?.total)} color="purple" />
        <StatCard label="Pagado" value={fmtCorto(r?.pagado)} color="green" sub={<ProgressBar valor={pct} etiqueta="Porcentaje pagado" />} />
        <StatCard label="Pendiente" value={fmtCorto(r?.pendiente)} color="gold" />
      </div>

      <div style={{ marginTop: 16 }}>
        <QueryState
          query={q}
          vacio={
            <>
              No hay pagos cargados en {monthLabel(mes)}. Usá <strong>Repartir cobro</strong> para cargar cuánto le corresponde a cada uno por un cliente, o <strong>Pago suelto</strong> para
              bonos y trabajos extra.
            </>
          }
        >
          {porPersona.map((p) => {
            const aprobadas = p.liqs.filter((l) => l.estado === 'aprobada')
            const pendientes = p.liqs.filter((l) => l.estado === 'pendiente')
            const total = p.liqs.filter((l) => l.estado !== 'anulada').reduce((a, l) => a + num(l.total), 0)
            return (
              <div key={p.id} className="card persona-liq">
                <div className="card-title-row">
                  <div className="card-title">
                    <span className="dot" style={{ background: p.color }} /> {p.nombre}
                    <span className="mono muted"> · {fmt(total)}</span>
                  </div>
                  <div className="header-actions">
                    {pendientes.length ? (
                      <button type="button" className="btn btn-secondary btn-xs" onClick={() => pendientes.forEach((l) => accion.mutate({ id: l.id, tipo: 'aprobar' }))}>
                        Aprobar todo
                      </button>
                    ) : null}
                    {aprobadas.length ? (
                      <button type="button" className="btn btn-primary btn-xs" onClick={() => setPagando(aprobadas)}>
                        Pagar aprobadas ({fmtCorto(aprobadas.reduce((a, l) => a + num(l.total), 0))})
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="table-responsive">
                  <table>
                    <tbody>
                      {p.liqs.map((l) => {
                        const est = ESTADOS_LIQUIDACION[l.estado]
                        const porPiezaSinCargar = l.modalidad === 'por_pieza' && num(l.total) === 0
                        return (
                          <tr key={l.id} className={l.estado === 'anulada' ? 'row-muted' : ''}>
                            <td>
                              <div className="cell-title">{l.concepto}</div>
                              <div className="cell-sub">
                                {l.modalidad ? labelDe(MODALIDADES, l.modalidad) : l.origen === 'base' ? 'Honorario base' : l.cliente ? 'Reparto de cobro' : 'Pago suelto'}
                                {l.items.length ? ` · ${l.items.length} ítem(s)` : ''}
                                {l.fecha_pago ? ` · pagado ${formatFechaCorta(l.fecha_pago)}` : ''}
                                {porPiezaSinCargar ? <span className="down"> · cargá las piezas</span> : null}
                              </div>
                            </td>
                            <td className="num mono nowrap">{fmt(l.total)}</td>
                            <td>
                              <Tag color={est?.tag}>{est?.label}</Tag>
                            </td>
                            <td className="nowrap actions-cell">
                              {l.estado === 'pendiente' || l.estado === 'aprobada' ? (
                                <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(l)}>
                                  Editar
                                </button>
                              ) : null}
                              {l.estado === 'pendiente' ? (
                                <button type="button" className="btn btn-secondary btn-xs" onClick={() => ejecutar(l, 'aprobar')}>
                                  Aprobar
                                </button>
                              ) : null}
                              {l.estado === 'aprobada' ? (
                                <button type="button" className="btn btn-primary btn-xs" onClick={() => setPagando([l])}>
                                  Pagar
                                </button>
                              ) : null}
                              {l.estado === 'pagada' ? (
                                <Link to={`/pagos-equipo/${l.id}/recibo`} className="btn btn-secondary btn-xs">
                                  Recibo
                                </Link>
                              ) : null}
                              <details className="menu">
                                <summary className="btn btn-secondary btn-xs" aria-label="Más acciones">
                                  ⋯
                                </summary>
                                <div className="menu-list">
                                  {l.estado === 'pagada' ? (
                                    <button type="button" onClick={() => ejecutar(l, 'revertir')}>
                                      Revertir pago
                                    </button>
                                  ) : null}
                                  {l.estado === 'pendiente' || l.estado === 'aprobada' ? (
                                    <button type="button" onClick={() => ejecutar(l, 'anular')}>
                                      Anular
                                    </button>
                                  ) : null}
                                  {l.estado !== 'pagada' ? (
                                    <button type="button" className="down" onClick={() => ejecutar(l, 'borrar')}>
                                      Eliminar
                                    </button>
                                  ) : null}
                                </div>
                              </details>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </QueryState>
      </div>
      {editando ? <LiquidacionForm inicial={editando.id ? editando : null} mes={mes} onClose={() => setEditando(null)} /> : null}
      {pagando ? <PagarForm liqs={pagando} onClose={() => setPagando(null)} /> : null}
      {repartiendo ? <RepartirForm clienteInicial={repartiendo.cliente} mes={mes} onClose={cerrarReparto} /> : null}
    </>
  )
}
