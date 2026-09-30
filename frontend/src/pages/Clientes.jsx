import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import ClienteForm from '../components/clientes/ClienteForm'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import StatCard from '../components/ui/StatCard'
import Tag from '../components/ui/Tag'
import { useClientes, useEsAdmin } from '../hooks/useData'
import { api } from '../lib/api'
import { ESTADOS_CLIENTE } from '../lib/constants'
import { currentMonth, fmtCorto, fmtPct, iniciales, monthLabel } from '../lib/format'
import { num } from '../lib/money'
import { QK } from '../lib/queryKeys'

export default function Clientes() {
  const navigate = useNavigate()
  const esAdmin = useEsAdmin()
  const q = useClientes()
  const mes = currentMonth()
  const rent = useQuery({
    queryKey: QK.rentabilidad(mes),
    queryFn: () => api.get('rentabilidad/', { params: { mes } }).then((r) => r.data),
    enabled: esAdmin,
  })
  const [estado, setEstado] = useState('activo')
  const [busqueda, setBusqueda] = useState('')
  const [nuevo, setNuevo] = useState(false)

  const rentPorCliente = useMemo(() => Object.fromEntries((rent.data?.clientes ?? []).map((r) => [r.cliente, r])), [rent.data])

  const lista = useMemo(() => {
    const s = busqueda.trim().toLowerCase()
    return (q.data ?? [])
      .filter((c) => !estado || c.estado === estado)
      .filter((c) => !s || [c.nombre, c.razon_social, c.rubro, c.contacto].some((x) => (x || '').toLowerCase().includes(s)))
  }, [q.data, estado, busqueda])

  const activos = (q.data ?? []).filter((c) => c.estado === 'activo')
  const mrr = activos.reduce((a, c) => a + num(c.fee_mensual), 0)
  const deuda = (q.data ?? []).reduce((a, c) => a + num(c.deuda), 0)
  const vencida = (q.data ?? []).reduce((a, c) => a + num(c.deuda_vencida), 0)

  return (
    <>
      <PageHeader titulo="Clientes" subtitulo={esAdmin ? 'Cartera, abonos y rentabilidad' : 'Contacto, equipo y notas de cada cuenta'}>
        {esAdmin ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setNuevo(true)}>
            + Nuevo cliente
          </button>
        ) : null}
      </PageHeader>

      {esAdmin ? (
        <div className="grid-4">
          <StatCard label="Clientes activos" value={activos.length} color="purple" />
          <StatCard label="Fee mensual recurrente" value={fmtCorto(mrr)} color="green" sub="Suma de contratos activos" />
          <StatCard label="Deuda abierta" value={fmtCorto(deuda)} color="gold" onClick={() => navigate('/cobros?vista=deuda')} />
          <StatCard label="Deuda vencida" value={<span className={vencida > 0 ? 'down' : ''}>{fmtCorto(vencida)}</span>} color="red" onClick={() => navigate('/cobros?vista=deuda')} />
        </div>
      ) : null}

      <div className="card" style={esAdmin ? { marginTop: 16 } : undefined}>
        <div className="filters">
          <input type="search" placeholder="Buscar cliente, rubro, contacto…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar clientes" />
          <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado">
            <option value="">Todos</option>
            {ESTADOS_CLIENTE.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>
        <QueryState query={q} vacio={esAdmin ? 'Todavía no cargaste clientes.' : 'No hay clientes con ese filtro.'} esVacio={() => lista.length === 0}>
          <div className="table-responsive tabla-apilada">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Equipo</th>
                  {esAdmin ? (
                    <>
                      <th className="num">Fee mensual</th>
                      <th className="num">Deuda</th>
                      <th className="num" title={`Ingresos menos costos de ${monthLabel(mes)}`}>
                        Margen {monthLabel(mes, { month: 'short' })}
                      </th>
                    </>
                  ) : (
                    <th>Contacto</th>
                  )}
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const r = rentPorCliente[c.id]
                  const est = ESTADOS_CLIENTE.find((e) => e.value === c.estado)
                  return (
                    <tr key={c.id} className="row-link" onClick={() => navigate(`/clientes/${c.id}`)}>
                      <td className="celda-principal">
                        <div className="cliente-cell">
                          <span className="avatar-sm" style={{ background: c.color }}>
                            {iniciales(c.nombre)}
                          </span>
                          <div>
                            <div className="cell-title">{c.nombre}</div>
                            <div className="cell-sub">{[c.rubro, c.contacto].filter(Boolean).join(' · ') || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="cell-sub celda-ancha" data-label="Equipo">
                        {c.asignados.map((a) => a.persona_nombre).join(', ') || '—'}
                      </td>
                      {esAdmin ? (
                        <>
                          <td className="num mono" data-label="Fee mensual">
                            {num(c.fee_mensual) ? fmtCorto(c.fee_mensual) : <span className="muted">sin contrato</span>}
                          </td>
                          <td className="num mono" data-label="Deuda">
                            {num(c.deuda) > 0 ? (
                              <>
                                <div className={num(c.deuda_vencida) > 0 ? 'down' : ''}>{fmtCorto(c.deuda)}</div>
                                {num(c.deuda_vencida) > 0 ? <div className="cell-sub down">{fmtCorto(c.deuda_vencida)} vencido</div> : null}
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="num mono" data-label={`Margen ${monthLabel(mes, { month: 'short' })}`}>
                            {r && (num(r.ingresos) || num(r.costo_total)) ? (
                              <>
                                <div className={num(r.margen) >= 0 ? 'up' : 'down'}>{fmtCorto(r.margen)}</div>
                                {r.margen_pct !== null ? <div className="cell-sub">{fmtPct(r.margen_pct).replace('+', '')}</div> : null}
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <td className="cell-sub celda-ancha" data-label="Contacto">
                          {[c.email, c.whatsapp].filter(Boolean).join(' · ') || '—'}
                        </td>
                      )}
                      <td data-label="Estado">
                        <Tag color={est?.tag}>{est?.label ?? c.estado}</Tag>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </QueryState>
      </div>
      {nuevo ? <ClienteForm onClose={() => setNuevo(false)} onGuardado={(c) => navigate(`/clientes/${c.id}`)} /> : null}
    </>
  )
}
