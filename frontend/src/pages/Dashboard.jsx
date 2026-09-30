import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import BarChart from '../components/ui/BarChart'
import MonthPicker from '../components/ui/MonthPicker'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import QueryState from '../components/ui/QueryState'
import StatCard from '../components/ui/StatCard'
import Tag from '../components/ui/Tag'
import { api } from '../lib/api'
import { currentMonth, diasHasta, fmt, fmtCorto, formatFechaCorta, monthLabel } from '../lib/format'
import { QK } from '../lib/queryKeys'

function Proximos({ items }) {
  if (!items.length) return <div className="empty">Nada por vencer en los próximos 15 días.</div>
  return items.map((i) => {
    const dias = diasHasta(i.fecha)
    return (
      <div key={`${i.tipo}-${i.id}`} className="list-row">
        <div className="list-row-main">
          <div className="list-row-title">
            {i.tipo === 'cobro' ? '💵' : '🔁'} {i.titulo}
          </div>
          <div className="list-row-sub">{i.detalle}</div>
        </div>
        <div className="list-row-side">
          <div className="mono">{fmt(i.monto)}</div>
          <Tag color={i.vencido ? 'red' : dias <= 3 ? 'yellow' : ''}>
            {i.vencido ? `Venció hace ${Math.abs(dias)} d` : dias === 0 ? 'Hoy' : `${formatFechaCorta(i.fecha)}`}
          </Tag>
        </div>
      </div>
    )
  })
}

export default function Dashboard() {
  const [mes, setMes] = useState(currentMonth)
  const navigate = useNavigate()
  const q = useQuery({ queryKey: QK.dashboard(mes), queryFn: () => api.get('dashboard/', { params: { mes } }).then((r) => r.data) })

  return (
    <>
      <PageHeader titulo="Dashboard" subtitulo={`Resumen de la agencia — ${monthLabel(mes)}`}>
        <MonthPicker value={mes} onChange={setMes} />
      </PageHeader>
      <QueryState query={q}>
        {(d) => (
          <>
            <div className="grid-4">
              <StatCard label="Ingresos del mes" value={fmtCorto(d.ingresos_mes)} color="green" variacion={d.variacion.ingresos} onClick={() => navigate(`/movimientos?mes=${mes}&tipo=ingreso`)} />
              <StatCard label="Egresos del mes" value={fmtCorto(d.egresos_mes)} color="red" variacion={d.variacion.egresos} invertir onClick={() => navigate(`/movimientos?mes=${mes}&tipo=egreso`)} />
              <StatCard
                label="Resultado"
                value={<span className={Number(d.balance) >= 0 ? 'up' : 'down'}>{fmtCorto(d.balance)}</span>}
                color="purple"
                sub={d.margen_pct !== null ? `Margen ${d.margen_pct}%` : null}
              />
              <StatCard label="Ingreso recurrente (MRR)" value={fmtCorto(d.mrr)} color="gold" sub={`${d.clientes_activos} clientes activos`} onClick={() => navigate('/clientes')} />
            </div>

            <div className="grid-3" style={{ marginTop: 16 }}>
              <div className="card">
                <div className="card-title">
                  <span className="dot" /> Cobranza del mes
                </div>
                <div className="kpi-line">
                  <span>Facturado</span>
                  <strong className="mono">{fmt(d.cobros_mes.facturado)}</strong>
                </div>
                <div className="kpi-line">
                  <span>Cobrado</span>
                  <strong className="mono up">{fmt(d.cobros_mes.cobrado)}</strong>
                </div>
                <div className="kpi-line">
                  <span>Falta cobrar</span>
                  <strong className="mono">{fmt(d.cobros_mes.pendiente)}</strong>
                </div>
                <ProgressBar valor={d.cobros_mes.pct_cobrado ?? 0} etiqueta="Porcentaje cobrado" />
                <div className="muted small" style={{ marginTop: 6 }}>
                  {d.cobros_mes.pct_cobrado !== null ? `${d.cobros_mes.pct_cobrado}% cobrado` : 'Todavía no hay cobros generados este mes.'}{' '}
                  <Link to={`/cobros?mes=${mes}`}>Ver cobros</Link>
                </div>
              </div>
              <div className="card">
                <div className="card-title">
                  <span className="dot" style={{ background: 'var(--accent3)' }} /> Deuda vencida
                </div>
                <div className="stat-value down" style={{ marginBottom: 10 }}>
                  {fmtCorto(d.deuda_vencida)}
                </div>
                {d.top_deudores.length === 0 ? (
                  <div className="empty">Ningún cliente con pagos vencidos. 🎉</div>
                ) : (
                  d.top_deudores.map((t) => (
                    <Link key={t.cliente} to={`/clientes/${t.cliente}`} className="list-row list-row--link">
                      <div className="list-row-main">
                        <div className="list-row-title">{t.nombre}</div>
                        <div className="list-row-sub">
                          {t.cobros} cobro{t.cobros === 1 ? '' : 's'} · hace {t.dias} días
                        </div>
                      </div>
                      <div className="mono down">{fmt(t.deuda)}</div>
                    </Link>
                  ))
                )}
              </div>
              <div className="card">
                <div className="card-title">
                  <span className="dot" style={{ background: 'var(--accent2)' }} /> Costos fijos
                </div>
                <div className="kpi-line">
                  <span>Equipo este mes</span>
                  <strong className="mono">{fmt(d.equipo.costo_mes)}</strong>
                </div>
                <div className="kpi-line">
                  <span>Pendiente de pagar al equipo</span>
                  <strong className="mono">{fmt(d.equipo.pendiente_pago)}</strong>
                </div>
                <div className="kpi-line">
                  <span>Suscripciones / mes</span>
                  <strong className="mono">{fmt(d.suscripciones_mensual)}</strong>
                </div>
                <div className="kpi-line">
                  <span>Tareas abiertas</span>
                  <strong>
                    {d.tareas.abiertas}
                    {d.tareas.vencidas ? <span className="down"> ({d.tareas.vencidas} vencidas)</span> : null}
                  </strong>
                </div>
                <div className="muted small" style={{ marginTop: 6 }}>
                  <Link to="/pagos-equipo">Pagos al equipo</Link> · <Link to="/suscripciones">Suscripciones</Link> · <Link to="/tareas">Tareas</Link>
                </div>
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="card-title">
                  <span className="dot" /> Últimos 6 meses
                </div>
                <BarChart
                  data={d.series_6_meses.map((s) => ({
                    label: s.label,
                    valores: [
                      { nombre: 'Ingresos', valor: Number(s.ingreso), color: 'var(--success)' },
                      { nombre: 'Egresos', valor: Number(s.egreso), color: 'var(--accent3)' },
                    ],
                  }))}
                />
              </div>
              <div className="card">
                <div className="card-title">
                  <span className="dot" style={{ background: 'var(--gold)' }} /> Próximos vencimientos
                </div>
                <Proximos items={d.proximos_vencimientos} />
              </div>
            </div>

            <div className="grid-2">
              <div className="card">
                <div className="card-title">
                  <span className="dot" style={{ background: 'var(--accent2)' }} /> Rentabilidad por cliente
                </div>
                {d.rentabilidad.length === 0 ? (
                  <div className="empty">Sin movimientos asociados a clientes este mes.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente</th>
                        <th className="num">Cobrado</th>
                        <th className="num">Costo</th>
                        <th className="num">Margen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...d.rentabilidad, ...d.rentabilidad_peor.filter((p) => !d.rentabilidad.some((r) => r.cliente === p.cliente))].map((r) => (
                        <tr key={r.cliente}>
                          <td>
                            <Link to={`/clientes/${r.cliente}`}>{r.cliente_nombre}</Link>
                          </td>
                          <td className="num mono">{fmtCorto(r.ingresos)}</td>
                          <td className="num mono">{fmtCorto(r.costo_total)}</td>
                          <td className={`num mono ${Number(r.margen) >= 0 ? 'up' : 'down'}`}>
                            {fmtCorto(r.margen)}
                            {r.margen_pct !== null ? <span className="muted small"> ({r.margen_pct}%)</span> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card">
                <div className="card-title">
                  <span className="dot" /> Últimos movimientos
                </div>
                {d.ultimas_transacciones.length === 0 ? (
                  <div className="empty">Sin movimientos registrados.</div>
                ) : (
                  d.ultimas_transacciones.map((t) => (
                    <div key={t.id} className="list-row">
                      <div className="list-row-main">
                        <div className="list-row-title">{t.descripcion}</div>
                        <div className="list-row-sub">
                          {formatFechaCorta(t.fecha)} · {t.categoria_nombre}
                          {t.cliente_nombre ? ` · ${t.cliente_nombre}` : ''}
                        </div>
                      </div>
                      <div className={`mono ${t.tipo === 'ingreso' ? 'up' : 'down'}`}>
                        {t.tipo === 'ingreso' ? '+' : '−'}
                        {fmt(t.monto)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </QueryState>
    </>
  )
}
