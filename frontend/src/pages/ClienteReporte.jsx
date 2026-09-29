import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import MonthPicker from '../components/ui/MonthPicker'
import QueryState from '../components/ui/QueryState'
import { api } from '../lib/api'
import { currentMonth, fmt, formatFecha, monthLabel } from '../lib/format'
import { num } from '../lib/money'
import { QK } from '../lib/queryKeys'

export default function ClienteReporte() {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const mes = sp.get('mes') || currentMonth()
  const [interno, setInterno] = useState(false)
  const q = useQuery({ queryKey: QK.clienteReporte(Number(id), mes), queryFn: () => api.get(`clientes/${id}/reporte/`, { params: { mes } }).then((r) => r.data) })

  return (
    <>
      <div className="no-print report-toolbar">
        <Link to={`/clientes/${id}`} className="back-link">
          ← Volver a la ficha
        </Link>
        <MonthPicker value={mes} onChange={(v) => setSp({ mes: v }, { replace: true })} />
        <label className="check-row">
          <input type="checkbox" checked={interno} onChange={(e) => setInterno(e.target.checked)} /> Incluir datos internos (costos y margen)
        </label>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
          🖨 Imprimir / PDF
        </button>
      </div>
      <QueryState query={q}>
        {(d) => (
          <article className="report">
            <header className="report-head">
              <div>
                <div className="report-brand">AURA TEAM</div>
                <h1>Reporte mensual — {d.cliente.nombre}</h1>
                <div className="muted">{monthLabel(d.periodo)}</div>
              </div>
              <span className="cat-dot lg" style={{ background: d.cliente.color }} />
            </header>

            {d.analisis.length ? (
              <section>
                <h2>Resultados en redes</h2>
                {d.analisis.map((a) => (
                  <div key={a.id} className="report-block">
                    <h3>
                      {a.plataforma_label || 'Estadísticas'}
                      {a.periodo_desde || a.periodo_hasta ? (
                        <span className="muted small">
                          {' '}
                          · {formatFecha(a.periodo_desde)} – {formatFecha(a.periodo_hasta)}
                        </span>
                      ) : null}
                    </h3>
                    {a.metricas.length ? (
                      <table>
                        <thead>
                          <tr>
                            <th>Métrica</th>
                            <th className="num">Antes</th>
                            <th className="num">Después</th>
                            <th className="num">Variación</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a.metricas.map((m) => (
                            <tr key={m.nombre}>
                              <td>{m.nombre}</td>
                              <td className="num">{m.antes || '—'}</td>
                              <td className="num">{m.despues || '—'}</td>
                              <td className={`num ${String(m.variacion).startsWith('-') ? 'down' : 'up'}`}>{m.variacion || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    {a.interpretacion ? <p className="pre-wrap">{a.interpretacion}</p> : null}
                  </div>
                ))}
              </section>
            ) : null}

            <section>
              <h2>Trabajo realizado</h2>
              {d.tareas_hechas.length ? (
                <ul className="report-list">
                  {d.tareas_hechas.map((t) => (
                    <li key={t.id}>
                      ✓ {t.titulo} <span className="muted small">{formatFecha(t.completada_en, { day: 'numeric', month: 'short' })}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No hay tareas completadas registradas este mes.</p>
              )}
              {d.eventos.length ? (
                <>
                  <h3>Acciones y eventos</h3>
                  <ul className="report-list">
                    {d.eventos.map((e) => (
                      <li key={e.id}>
                        {formatFecha(e.inicio, { day: 'numeric', month: 'short' })} — {e.titulo}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {d.tareas_pendientes.length ? (
                <>
                  <h3>Próximos pasos</h3>
                  <ul className="report-list">
                    {d.tareas_pendientes.map((t) => (
                      <li key={t.id}>
                        • {t.titulo}
                        {t.fecha_limite ? <span className="muted small"> (para el {formatFecha(t.fecha_limite, { day: 'numeric', month: 'short' })})</span> : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </section>

            <section>
              <h2>Estado de cuenta</h2>
              {d.cobros.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Vencimiento</th>
                      <th className="num">Monto</th>
                      <th className="num">Pagado</th>
                      <th className="num">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.cobros
                      .filter((c) => c.estado !== 'anulado')
                      .map((c) => (
                        <tr key={c.id}>
                          <td>{c.concepto}</td>
                          <td>{formatFecha(c.vencimiento)}</td>
                          <td className="num">{fmt(c.monto)}</td>
                          <td className="num">{fmt(c.monto_cobrado)}</td>
                          <td className="num">{fmt(c.saldo)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted">Sin cobros en el período.</p>
              )}
              <p>
                Saldo total pendiente: <strong>{fmt(d.deuda_total)}</strong>
              </p>
            </section>

            {interno && d.rentabilidad ? (
              <section className="report-interno">
                <h2>Interno — rentabilidad</h2>
                <table>
                  <tbody>
                    <tr>
                      <td>Cobrado en el mes</td>
                      <td className="num">{fmt(d.rentabilidad.ingresos)}</td>
                    </tr>
                    <tr>
                      <td>Costo del equipo</td>
                      <td className="num">{fmt(d.rentabilidad.costo_equipo)}</td>
                    </tr>
                    <tr>
                      <td>Otros costos directos</td>
                      <td className="num">{fmt(d.rentabilidad.otros_egresos)}</td>
                    </tr>
                    <tr>
                      <th>Margen</th>
                      <th className={`num ${num(d.rentabilidad.margen) >= 0 ? 'up' : 'down'}`}>
                        {fmt(d.rentabilidad.margen)}
                        {d.rentabilidad.margen_pct !== null ? ` (${d.rentabilidad.margen_pct}%)` : ''}
                      </th>
                    </tr>
                  </tbody>
                </table>
              </section>
            ) : null}
            <footer className="report-foot muted small">Generado el {formatFecha(new Date().toISOString())} · Aura Team</footer>
          </article>
        )}
      </QueryState>
    </>
  )
}
