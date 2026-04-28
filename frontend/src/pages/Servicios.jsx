import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModal } from '../context/ModalContext'
import { usePhase1 } from '../context/Phase1Context'
import { api } from '../lib/api'
import { servicioToApiPayload } from '../lib/mappers'
import { QK } from '../lib/queryKeys'
import { fmt } from '../lib/format'
import { notify } from '../lib/notify'
import {
  monthlyEquivalentMonto,
  normPersonName,
  parseAmountLoose,
  roundMoney2,
  splitMoneyExact,
  splitPctHundredExact,
} from '../lib/serviciosAmounts'

function formatFechaPago(iso) {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00`)
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Servicios() {
  const { state } = usePhase1()
  const { openModal } = useModal()
  const qc = useQueryClient()
  const cur = state.config.moneda

  const [calcNombre, setCalcNombre] = useState('')
  const [calcFechaPago, setCalcFechaPago] = useState(() => new Date().toISOString().slice(0, 10))
  const [calcMonto, setCalcMonto] = useState('')
  const [calcMetodo, setCalcMetodo] = useState('partes-iguales')
  const [calcN, setCalcN] = useState(2)
  const [rowEdits, setRowEdits] = useState({})
  const [resultadoHtml, setResultadoHtml] = useState('')
  const [showGuardarCalc, setShowGuardarCalc] = useState(false)
  const [splitSnapshot, setSplitSnapshot] = useState(null)

  const defaultPcts = useMemo(() => splitPctHundredExact(calcN), [calcN])

  const displayRows = useMemo(
    () =>
      Array.from({ length: calcN }, (_, i) => ({
        name: rowEdits[i]?.name ?? `Persona ${i + 1}`,
        pct: rowEdits[i]?.pct !== undefined ? rowEdits[i].pct : defaultPcts[i],
        monto: rowEdits[i]?.monto !== undefined ? rowEdits[i].monto : 0,
      })),
    [calcN, rowEdits, defaultPcts],
  )

  const totalMensualServicios = useMemo(() => {
    return state.servicios.reduce((acc, s) => acc + monthlyEquivalentMonto(s.monto, s.periodo), 0)
  }, [state.servicios])

  const totalesPorPersona = useMemo(() => {
    return state.personal.map((p) => {
      const key = normPersonName(p.nombre)
      let total = 0
      for (const s of state.servicios) {
        const rows = s.detallePersonas || []
        for (const row of rows) {
          if (normPersonName(row.name) === key) {
            total += monthlyEquivalentMonto(Number(row.monto) || 0, s.periodo)
          }
        }
      }
      return { id: p.id, nombre: p.nombre, total }
    })
  }, [state.servicios, state.personal])

  const calcularDivision = (montoOverride) => {
    const raw =
      typeof montoOverride === 'string' || typeof montoOverride === 'number' ? montoOverride : calcMonto
    const total = roundMoney2(parseAmountLoose(raw))
    const nombre = calcNombre || 'Gasto'
    if (!total) {
      setResultadoHtml('')
      setShowGuardarCalc(false)
      setSplitSnapshot(null)
      return
    }
    const resultados = []
    if (calcMetodo === 'partes-iguales') {
      const amounts = splitMoneyExact(total, calcN)
      for (let i = 0; i < calcN; i += 1) {
        const name = displayRows[i]?.name || `Persona ${i + 1}`
        resultados.push({ name, monto: roundMoney2(amounts[i] ?? 0) })
      }
    } else {
      for (let i = 0; i < calcN; i += 1) {
        const name = displayRows[i]?.name || `Persona ${i + 1}`
        let monto
        if (calcMetodo === 'porcentaje') {
          const pct = parseAmountLoose(displayRows[i]?.pct)
          monto = roundMoney2((total * pct) / 100)
        } else {
          monto = roundMoney2(parseAmountLoose(displayRows[i]?.monto))
        }
        resultados.push({ name, monto })
      }
    }
    const suma = roundMoney2(resultados.reduce((s, r) => s + r.monto, 0))
    const diff = roundMoney2(total - suma)
    const exacto = Math.abs(diff) < 0.005
    setShowGuardarCalc(true)
    setSplitSnapshot({ resultados, nombre, total, calcMetodo, displayRows: [...displayRows] })
    const pctLabel = (m) => (total > 0 ? ((m / total) * 100).toFixed(2) : '0.00')
    setResultadoHtml(`
    <div class="split-result">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;font-weight:600;">${nombre} — Total: ${fmt(total, cur)}</div>
      ${resultados
        .map(
          (r) =>
            `<div class="split-person"><div><div style="font-weight:500;">${r.name}</div><div style="font-size:11px;color:var(--text-dim);">${pctLabel(r.monto)}%</div></div><div class="split-amount">${fmt(r.monto, cur)}</div></div>`,
        )
        .join('')}
      ${exacto ? '<div style="margin-top:8px;font-size:12px;color:var(--accent);">✓ División exacta (±0,005)</div>' : `<div style="margin-top:8px;font-size:12px;color:var(--gold);">⚠️ Diferencia: ${fmt(Math.abs(diff), cur)}</div>`}
    </div>`)
  }

  const saveFromCalc = useMutation({
    mutationFn: async (snap) => {
      if (!snap) throw new Error('Sin cálculo')
      const { resultados, nombre, total, calcMetodo: met, fechaPago } = snap
      const detallePersonas = resultados.map((r) => ({ name: r.name, monto: r.monto }))
      const personasLabel = detallePersonas.map((p) => `${p.name}: ${fmt(p.monto, cur)}`).join(' · ')
      const payload = servicioToApiPayload({
        nombre: nombre || 'Servicio',
        monto: total,
        periodo: 'mensual',
        personas: personasLabel,
        dia: 1,
        metodo: met,
        detallePersonas,
        fechaPago: fechaPago || undefined,
      })
      await api.post('servicios/', payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.servicios })
      notify('Servicio guardado desde la calculadora')
      setSplitSnapshot(null)
      setShowGuardarCalc(false)
    },
    onError: () => notify('No se pudo guardar'),
  })

  const delServicio = useMutation({
    mutationFn: (id) => api.delete(`servicios/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.servicios })
      notify('Servicio eliminado')
    },
    onError: () => notify('No se pudo eliminar'),
  })

  const setRow = (i, patch) => {
    setRowEdits((prev) => ({ ...prev, [i]: { ...prev[i], ...patch } }))
  }

  /** Selector desde Personal (sin duplicar nombre en otro input). */
  const personaSelectEl = (i) => {
    if (!state.personal.length) return null
    return (
      <select
        aria-label={`Persona ${i + 1} del equipo`}
        value={rowEdits[i]?.personaId ?? ''}
        onChange={(e) => {
          const v = e.target.value
          if (!v) {
            setRow(i, { personaId: '', name: `Persona ${i + 1}` })
            return
          }
          const pers = state.personal.find((p) => String(p.id) === v)
          if (pers) setRow(i, { personaId: v, name: pers.nombre })
        }}
        style={{ width: '100%', padding: '8px 10px', borderRadius: 6 }}
      >
        <option value="">— Elegir —</option>
        {state.personal.map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.nombre}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="page active" id="page-servicios">
      <div className="section-header">
        <div>
          <h2>División de Servicios</h2>
          <p>Calculadora de gastos compartidos</p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            openModal('modal-servicio')
          }}
        >
          + Agregar servicio
        </button>
      </div>
      <div className="grid-2">
        <div>
          <div className="card">
            <div className="card-title">
              <span className="dot" />
              Mis servicios
            </div>
            <div id="lista-servicios">
              {state.servicios.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '20px 0', textAlign: 'center' }}>Sin servicios registrados</div>
              ) : (
                state.servicios.map((s) => {
                  const detalleHTML =
                    s.detallePersonas && s.detallePersonas.length ? (
                      <div style={{ marginTop: '8px', padding: '8px 10px', background: 'var(--surface2)', borderRadius: '6px' }}>
                        {s.detallePersonas.map((p) => (
                          <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0', color: 'var(--text-muted)' }}>
                            <span>{p.name}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fmt(p.monto, cur)}</span>
                          </div>
                        ))}
                        {s.metodo ? (
                          <div style={{ fontSize: '10px', color: 'var(--text-dim)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Método: {s.metodo.replace('-', ' ')}</div>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Personas: {s.personas || 'No especificado'}</div>
                    )
                  return (
                    <div key={s.id} style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <div style={{ fontWeight: 500, fontSize: '15px', color: 'var(--text)' }}>{s.nombre}</div>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => delServicio.mutate(s.id)} disabled={delServicio.isPending} title="Eliminar">
                              🗑
                            </button>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
                            Pago: {s.fechaPago ? formatFechaPago(s.fechaPago) : '—'} · {s.periodo} · Vence día {s.dia}
                          </div>
                          {detalleHTML}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: '11px', color: 'var(--text-dim)' }}>Total</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '18px', color: 'var(--accent)' }}>{fmt(s.monto, cur)}</div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
          <div className="stat-card purple">
            <div className="stat-label">Total mensual (servicios)</div>
            <div className="stat-value" id="srv-total-mensual">
              {fmt(totalMensualServicios, cur)}
            </div>
            <div className="stat-sub" style={{ color: 'var(--text-muted)' }}>
              Equivalente mensual de la suma de todos los montos totales
            </div>
            {state.personal.length > 0 ? (
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Por persona registrada</div>
                {totalesPorPersona.map((row) => (
                  <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.nombre}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{fmt(row.total, cur)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="stat-sub" style={{ color: 'var(--text-muted)', marginTop: 8 }}>
                Cargá personas en Personal para ver cuánto les corresponde según las divisiones guardadas (coincidencia por nombre).
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent2)' }} />
            Calculadora de división
          </div>
          <div className="form-row">
            <label>Nombre del gasto</label>
            <input type="text" id="calc-nombre" placeholder="Ej: Netflix, Luz, Internet..." value={calcNombre} onChange={(e) => setCalcNombre(e.target.value)} />
          </div>
          <div className="form-row">
            <label>Monto total ($)</label>
            <input
              type="text"
              inputMode="decimal"
              id="calc-monto"
              placeholder="0,00 · 1.234,56 · 1234.56"
              value={calcMonto}
              onChange={(e) => {
                const v = e.target.value
                setCalcMonto(v)
                calcularDivision(v)
              }}
            />
          </div>
          <div className="form-row">
            <label>Método de división</label>
            <select
              id="calc-metodo"
              value={calcMetodo}
              onChange={(e) => {
                setCalcMetodo(e.target.value)
                setRowEdits({})
              }}
            >
              <option value="partes-iguales">Partes iguales</option>
              <option value="porcentaje">Por porcentaje</option>
              <option value="personalizado">Monto personalizado</option>
            </select>
          </div>
          <div id="calc-personas-wrap">
            <div className="form-row">
              <label>Número de personas</label>
              <input
                type="number"
                id="calc-personas"
                value={calcN}
                min={2}
                max={10}
                onChange={(e) => {
                  setCalcN(Math.min(10, Math.max(2, parseInt(e.target.value, 10) || 2)))
                  setRowEdits({})
                }}
              />
            </div>
          </div>
          <div id="calc-persona-list">
            {calcMetodo === 'partes-iguales' &&
              displayRows.map((r, i) => (
                <div key={`${i}-eq`} className="form-row">
                  <label>Persona {i + 1}</label>
                  {state.personal.length > 0 ? (
                    personaSelectEl(i)
                  ) : (
                    <input
                      type="text"
                      id={`p-name-${i}`}
                      value={r.name}
                      onChange={(e) => setRow(i, { name: e.target.value })}
                      placeholder="Nombre"
                    />
                  )}
                </div>
              ))}
            {calcMetodo === 'porcentaje' &&
              displayRows.map((r, i) => (
                <div key={`${i}-pct`} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Persona {i + 1}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '8px', alignItems: 'start' }}>
                    {state.personal.length > 0 ? (
                      personaSelectEl(i)
                    ) : (
                      <input type="text" id={`p-name-${i}`} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Nombre" />
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      id={`p-pct-${i}`}
                      value={rowEdits[i]?.pct !== undefined ? String(rowEdits[i].pct) : String(r.pct)}
                      onChange={(e) => {
                        const t = e.target.value.trim()
                        if (t === '') setRow(i, { pct: undefined })
                        else setRow(i, { pct: parseAmountLoose(t) })
                      }}
                      placeholder="% (ej: 33,33)"
                    />
                  </div>
                </div>
              ))}
            {calcMetodo === 'personalizado' &&
              displayRows.map((r, i) => (
                <div key={`${i}-mon`} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Persona {i + 1}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '8px', alignItems: 'start' }}>
                    {state.personal.length > 0 ? (
                      personaSelectEl(i)
                    ) : (
                      <input type="text" id={`p-name-${i}`} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Nombre" />
                    )}
                    <input
                      type="text"
                      inputMode="decimal"
                      id={`p-monto-${i}`}
                      value={rowEdits[i]?.monto !== undefined ? String(rowEdits[i].monto) : String(r.monto)}
                      onChange={(e) => setRow(i, { monto: parseAmountLoose(e.target.value) })}
                      placeholder="Monto (ej: 1234,56)"
                    />
                  </div>
                </div>
              ))}
          </div>
          <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: '8px' }} onClick={() => calcularDivision()}>
            Calcular división
          </button>
          <div id="calc-resultado" dangerouslySetInnerHTML={{ __html: resultadoHtml }} />
          <div className="form-row" style={{ display: showGuardarCalc ? 'block' : 'none', marginTop: 10 }}>
            <label>Fecha de pago</label>
            <input type="date" value={calcFechaPago} onChange={(e) => setCalcFechaPago(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-purple"
            style={{ width: '100%', marginTop: '10px', display: showGuardarCalc ? 'inline-flex' : 'none' }}
            id="btn-guardar-calc"
            disabled={saveFromCalc.isPending || !splitSnapshot}
            onClick={() => saveFromCalc.mutate({ ...splitSnapshot, fechaPago: calcFechaPago })}
          >
            💾 Guardar servicio
          </button>
        </div>
      </div>
    </div>
  )
}
