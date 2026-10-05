import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import AjusteForm from '../components/clientes/AjusteForm'
import ClienteForm from '../components/clientes/ClienteForm'
import ContratoForm from '../components/clientes/ContratoForm'
import EnviosCliente from '../components/clientes/EnviosCliente'
import OnboardingCliente from '../components/clientes/OnboardingCliente'
import CobrosTabla from '../components/cobros/CobrosTabla'
import AsignacionForm from '../components/equipo/AsignacionForm'
import BarChart from '../components/ui/BarChart'
import LineChart from '../components/ui/LineChart'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import StatCard from '../components/ui/StatCard'
import Tabs from '../components/ui/Tabs'
import Tag from '../components/ui/Tag'
import { useEsAdmin, usePuede } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { ESTADOS_CLIENTE, ESTADOS_TAREA, MODALIDADES, PERIODICIDADES_CONTRATO, PLATAFORMAS, labelDe } from '../lib/constants'
import { currentMonth, fmt, fmtCorto, formatFecha, monthLabel } from '../lib/format'
import { num } from '../lib/money'
import { notify, notifyError } from '../lib/notify'
import { DINERO, QK, invalidar } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

function Resumen({ cliente }) {
  const datos = [
    ...('cuit' in cliente
      ? [
          ['Razón social', cliente.razon_social],
          ['CUIT', cliente.cuit],
        ]
      : []),
    ['Rubro', cliente.rubro],
    ['Contacto', cliente.contacto],
    ['Email', cliente.email ? <a href={`mailto:${cliente.email}`}>{cliente.email}</a> : null],
    [
      'WhatsApp',
      cliente.whatsapp ? (
        <a href={`https://wa.me/${cliente.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
          {cliente.whatsapp}
        </a>
      ) : null,
    ],
    ['Cliente desde', formatFecha(cliente.fecha_alta)],
  ]
  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-title">
          <span className="dot" /> Datos
        </div>
        <dl className="data-list">
          {datos.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v || <span className="muted">—</span>}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="card">
        <div className="card-title">
          <span className="dot" /> Notas
        </div>
        <p className="pre-wrap">{cliente.notas || <span className="muted">Sin notas.</span>}</p>
      </div>
    </div>
  )
}

function TareasCliente({ clienteId }) {
  const params = { cliente: clienteId }
  const q = useQuery({ queryKey: QK.tareas(params), queryFn: () => getList('tareas/', params) })
  const ordenadas = useMemo(() => [...(q.data ?? [])].sort((a, b) => (a.estado === 'hecha') - (b.estado === 'hecha')), [q.data])
  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" /> Tareas del cliente
        </div>
        <Link to="/tareas" className="btn btn-secondary btn-sm">
          Ir a Tareas
        </Link>
      </div>
      <QueryState query={q} esVacio={() => ordenadas.length === 0} vacio="No hay tareas para este cliente.">
        <div>
          {ordenadas.map((t) => (
            <div key={t.id} className={`list-row${t.estado === 'hecha' ? ' row-muted' : ''}`}>
              <div className="list-row-main">
                <div className="list-row-title">{t.titulo}</div>
                <div className="list-row-sub">
                  <Tag color={labelTag(ESTADOS_TAREA, t.estado)}>{labelDe(ESTADOS_TAREA, t.estado)}</Tag>{' '}
                  {t.asignados_nombres.length ? `👤 ${t.asignados_nombres.join(', ')}` : 'Sin responsable'}
                </div>
              </div>
              <div className={`list-row-side small${t.vencida ? ' down' : ''}`}>{t.fecha_limite ? formatFecha(t.fecha_limite) : <span className="muted">Sin fecha</span>}</div>
            </div>
          ))}
        </div>
      </QueryState>
    </div>
  )
}

const labelTag = (lista, value) => lista.find((x) => x.value === value)?.tag

function Contratos({ clienteId }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK.contratos({ cliente: clienteId }), queryFn: () => getList('contratos/', { cliente: clienteId }) })
  const [editando, setEditando] = useState(null)
  const [ajustando, setAjustando] = useState(null)
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`contratos/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contratos'] })
      invalidar(qc, DINERO)
      notify('Contrato eliminado')
    },
    onError: (e) => notifyError(e),
  })
  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" /> Contratos y servicios
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
          + Contrato
        </button>
      </div>
      <QueryState query={q} vacio="Sin contratos. Agregá el fee mensual para que se generen los cobros automáticamente.">
        {(lista) =>
          lista.map((c) => (
            <div key={c.id} className={`contrato-card${c.activo ? '' : ' row-muted'}`}>
              <div className="contrato-head">
                <div>
                  <div className="cell-title">
                    {c.concepto} {c.activo ? null : <Tag>Inactivo</Tag>}
                  </div>
                  <div className="cell-sub">
                    {labelDe(PERIODICIDADES_CONTRATO, c.periodicidad)} · vence el día {c.dia_vencimiento} · desde {formatFecha(c.fecha_inicio)}
                    {c.fecha_fin ? ` hasta ${formatFecha(c.fecha_fin)}` : ''}
                    {c.responsable_nombre ? ` · resp. ${c.responsable_nombre}` : ''}
                  </div>
                </div>
                <div className="contrato-monto">
                  <div className="mono big">{fmt(c.monto_actual)}</div>
                  {c.periodicidad !== 'mensual' && c.periodicidad !== 'unico' ? <div className="cell-sub">≈ {fmtCorto(c.equivalente_mensual)}/mes</div> : null}
                </div>
              </div>
              {c.ajustes.length ? (
                <details className="ajustes">
                  <summary>Historial de ajustes ({c.ajustes.length})</summary>
                  <ul>
                    {c.ajustes.map((a) => (
                      <li key={a.id}>
                        {formatFecha(a.fecha_desde)}: {fmt(a.monto_anterior)} → <strong>{fmt(a.monto_nuevo)}</strong>
                        {a.porcentaje ? ` (+${num(a.porcentaje)}%)` : ''}
                        {a.nota ? <span className="muted"> — {a.nota}</span> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="contrato-actions">
                {c.periodicidad !== 'unico' ? (
                  <button type="button" className="btn btn-secondary btn-xs" onClick={() => setAjustando(c)}>
                    📈 Ajustar precio
                  </button>
                ) : null}
                <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(c)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-xs"
                  onClick={async () =>
                    (await confirmar({
                      titulo: 'Eliminar contrato',
                      mensaje: `¿Eliminar «${c.concepto}»? Los cobros ya generados se conservan. Si solo terminó, mejor desactivalo.`,
                      peligro: true,
                      confirmar: 'Eliminar',
                    })) && borrar.mutate(c.id)
                  }
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))
        }
      </QueryState>
      {editando ? <ContratoForm clienteId={clienteId} inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
      {ajustando ? <AjusteForm contrato={ajustando} onClose={() => setAjustando(null)} /> : null}
    </div>
  )
}

function CobrosCliente({ clienteId }) {
  const q = useQuery({ queryKey: QK.cobros({ cliente: clienteId }), queryFn: () => getList('cobros/', { cliente: clienteId }) })
  const ordenados = useMemo(() => [...(q.data ?? [])].sort((a, b) => b.vencimiento.localeCompare(a.vencimiento)), [q.data])
  return (
    <div className="card">
      <QueryState query={q} vacio="Todavía no hay cobros para este cliente.">
        <CobrosTabla cobros={ordenados} mostrarCliente={false} mostrarPeriodo />
      </QueryState>
    </div>
  )
}

function EquipoCliente({ clienteId }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: QK.asignaciones({ cliente: clienteId }), queryFn: () => getList('asignaciones-cliente/', { cliente: clienteId }) })
  const [editando, setEditando] = useState(null)
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`asignaciones-cliente/${id}/`),
    onSuccess: () => ['asignaciones-cliente', 'clientes', 'personal'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
    onError: (e) => notifyError(e),
  })
  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" /> Equipo asignado
        </div>
        <div className="header-actions">
          <Link to={`/pagos-equipo?repartir=${clienteId}`} className="btn btn-secondary btn-sm">
            Repartir cobro
          </Link>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
            + Asignar
          </button>
        </div>
      </div>
      <QueryState query={q} vacio="Nadie asignado. Asigná a quienes trabajan en la cuenta; su pago de referencia se sugiere al repartir cada cobro.">        {(lista) => (
          <table>
            <thead>
              <tr>
                <th>Persona</th>
                <th>Rol</th>
                <th>Pago de referencia</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} className={a.activo ? '' : 'row-muted'}>
                  <td className="cell-title">{a.persona_nombre}</td>
                  <td>{a.rol || '—'}</td>
                  <td>
                    {a.modalidad === 'porcentaje' ? `${num(a.valor)}% de lo cobrado` : a.modalidad === 'por_pieza' ? `${fmt(a.valor)} por pieza` : `${fmt(a.valor)}/mes`}
                    <div className="cell-sub">{labelDe(MODALIDADES, a.modalidad)}</div>
                  </td>
                  <td className="nowrap">
                    <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(a)}>
                      Editar
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn-danger btn-xs"
                      onClick={async () => (await confirmar({ mensaje: `¿Quitar a ${a.persona_nombre} de la cuenta?`, peligro: true, confirmar: 'Quitar' })) && borrar.mutate(a.id)}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
      {editando ? <AsignacionForm clienteId={clienteId} inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
    </div>
  )
}

function EstadisticasCliente({ clienteId }) {
  const [plataforma, setPlataforma] = useState('')
  const q = useQuery({
    queryKey: QK.clienteEvolucion(clienteId, plataforma),
    queryFn: () => api.get(`clientes/${clienteId}/evolucion/`, { params: { plataforma: plataforma || undefined } }).then((r) => r.data),
  })
  const series = Object.entries(q.data?.series ?? {}).filter(([, pts]) => pts.length > 0)
  return (
    <div className="card">
      <div className="card-title-row">
        <div className="card-title">
          <span className="dot" /> Evolución de métricas
        </div>
        <div className="header-actions">
          <select className="select-sm" value={plataforma} onChange={(e) => setPlataforma(e.target.value)} aria-label="Plataforma">
            <option value="">Todas las plataformas</option>
            {PLATAFORMAS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <Link to={`/estadisticas?cliente=${clienteId}`} className="btn btn-secondary btn-sm">
            + Analizar capturas
          </Link>
        </div>
      </div>
      <QueryState query={q} esVacio={() => series.length === 0} vacio="Todavía no hay análisis de estadísticas asociados a este cliente.">
        <div className="grid-3">
          {series.map(([nombre, pts]) => {
            const ultimo = pts[pts.length - 1].valor
            const primero = pts[0].valor
            const variacion = primero ? ((ultimo - primero) / Math.abs(primero)) * 100 : null
            return (
              <div key={nombre} className="metric-card">
                <div className="metric-head">
                  <span>{nombre}</span>
                  <span className="mono">
                    {ultimo.toLocaleString('es-AR')}
                    {variacion !== null && pts.length > 1 ? <span className={variacion >= 0 ? 'up' : 'down'}> {variacion >= 0 ? '▲' : '▼'} {Math.abs(variacion).toFixed(0)}%</span> : null}
                  </span>
                </div>
                <LineChart puntos={pts} />
              </div>
            )
          })}
        </div>
      </QueryState>
    </div>
  )
}

function RentabilidadCliente({ clienteId }) {
  const q = useQuery({ queryKey: QK.clienteRentabilidad(clienteId), queryFn: () => api.get(`clientes/${clienteId}/rentabilidad/`, { params: { meses: 6 } }).then((r) => r.data) })
  return (
    <div className="card">
      <div className="card-title">
        <span className="dot" /> Rentabilidad — últimos 6 meses
      </div>
      <QueryState query={q}>
        {(d) => (
          <>
            <BarChart
              data={d.serie.map((s) => ({
                label: s.label,
                valores: [
                  { nombre: 'Cobrado', valor: num(s.ingresos), color: 'var(--success)' },
                  { nombre: 'Costos', valor: num(s.costo_total), color: 'var(--accent3)' },
                ],
              }))}
            />
            <div className="table-responsive" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th className="num">Facturado</th>
                    <th className="num">Cobrado</th>
                    <th className="num">Equipo</th>
                    <th className="num">Otros costos</th>
                    <th className="num">Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {d.serie.map((s) => (
                    <tr key={s.periodo}>
                      <td>{monthLabel(s.periodo)}</td>
                      <td className="num mono">{fmtCorto(s.facturado)}</td>
                      <td className="num mono">{fmtCorto(s.ingresos)}</td>
                      <td className="num mono">{fmtCorto(s.costo_equipo)}</td>
                      <td className="num mono">{fmtCorto(s.otros_egresos)}</td>
                      <td className={`num mono ${num(s.margen) >= 0 ? 'up' : 'down'}`}>
                        {fmtCorto(s.margen)}
                        {s.margen_pct !== null && s.margen_pct !== undefined ? <span className="cell-sub"> ({s.margen_pct}%)</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Costos del equipo según las liquidaciones del mes (aunque no estén pagadas) más egresos asignados al cliente.</p>
          </>
        )}
      </QueryState>
    </div>
  )
}

export default function ClienteDetalle() {
  const { id } = useParams()
  const clienteId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const esAdmin = useEsAdmin()
  const verStats = usePuede('estadisticas')
  const tabs = [
    { value: 'resumen', label: 'Resumen' },
    { value: 'tareas', label: 'Tareas' },
    ...(esAdmin
      ? [
          { value: 'contratos', label: 'Contratos' },
          { value: 'cobros', label: 'Cobros' },
          { value: 'equipo', label: 'Equipo' },
          { value: 'emails', label: 'Emails' },
        ]
      : []),
    ...(verStats ? [{ value: 'estadisticas', label: 'Estadísticas' }] : []),
    ...(esAdmin ? [{ value: 'rentabilidad', label: 'Rentabilidad' }] : []),
  ]
  const tab = tabs.some((t) => t.value === sp.get('tab')) ? sp.get('tab') : 'resumen'
  const [editando, setEditando] = useState(false)
  const q = useQuery({ queryKey: QK.cliente(clienteId), queryFn: () => api.get(`clientes/${clienteId}/`).then((r) => r.data) })

  const borrar = useMutation({
    mutationFn: () => api.delete(`clientes/${clienteId}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clientes'] })
      notify('Cliente eliminado')
      navigate('/clientes')
    },
    onError: (e) => notifyError(e),
  })

  return (
    <QueryState query={q}>
      {(c) => {
        const est = ESTADOS_CLIENTE.find((e) => e.value === c.estado)
        return (
          <>
            <Link to="/clientes" className="back-link">
              ← Clientes
            </Link>
            <PageHeader
              titulo={
                <span className="cliente-cell">
                  <span className="cat-dot lg" style={{ background: c.color }} /> {c.nombre} <Tag color={est?.tag}>{est?.label}</Tag>
                </span>
              }
              subtitulo={c.asignados.length ? `Equipo: ${c.asignados.map((a) => a.persona_nombre + (a.rol ? ` (${a.rol})` : '')).join(', ')}` : c.rubro}
            >
              {esAdmin ? (
                <>
                  <Link to={`/clientes/${clienteId}/reporte?mes=${currentMonth()}`} className="btn btn-secondary btn-sm">
                    📄 Reporte mensual
                  </Link>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando(true)}>
                    Editar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={async () =>
                      (await confirmar({
                        titulo: `Eliminar ${c.nombre}`,
                        mensaje: 'Se borran sus contratos y asignaciones. Si tiene cobros no se puede borrar: marcalo como «Baja».',
                        peligro: true,
                        escribir: c.nombre,
                        confirmar: 'Eliminar',
                      })) && borrar.mutate()
                    }
                  >
                    Eliminar
                  </button>
                </>
              ) : null}
            </PageHeader>

            {esAdmin ? (
              <div className="grid-3">
                <StatCard label="Fee mensual" value={fmtCorto(c.fee_mensual)} color="green" />
                <StatCard label="Deuda abierta" value={fmtCorto(c.deuda)} color="gold" onClick={() => setSp({ tab: 'cobros' }, { replace: true })} />
                <StatCard label="Deuda vencida" value={<span className={num(c.deuda_vencida) > 0 ? 'down' : ''}>{fmtCorto(c.deuda_vencida)}</span>} color="red" />
              </div>
            ) : null}

            <div style={{ margin: '16px 0' }}>
              <Tabs
                value={tab}
                onChange={(v) => setSp(v === 'resumen' ? {} : { tab: v }, { replace: true })}
                tabs={tabs.map((t) => (t.value === 'cobros' ? { ...t, badge: num(c.deuda_vencida) > 0 ? '!' : null } : t))}
              />
            </div>

            {tab === 'resumen' ? (
              <>
                <Resumen cliente={c} />
                <OnboardingCliente clienteId={clienteId} esAdmin={esAdmin} />
              </>
            ) : null}
            {tab === 'tareas' ? <TareasCliente clienteId={clienteId} /> : null}
            {tab === 'contratos' ? <Contratos clienteId={clienteId} /> : null}
            {tab === 'cobros' ? <CobrosCliente clienteId={clienteId} /> : null}
            {tab === 'equipo' ? <EquipoCliente clienteId={clienteId} /> : null}
            {tab === 'emails' ? <EnviosCliente clienteId={clienteId} email={c.email} /> : null}
            {tab === 'estadisticas' ? <EstadisticasCliente clienteId={clienteId} /> : null}
            {tab === 'rentabilidad' ? <RentabilidadCliente clienteId={clienteId} /> : null}
            {editando ? <ClienteForm inicial={c} onClose={() => setEditando(false)} /> : null}
          </>
        )
      }}
    </QueryState>
  )
}
