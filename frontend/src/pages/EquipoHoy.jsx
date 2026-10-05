import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import QueryState from '../components/ui/QueryState'
import StatCard from '../components/ui/StatCard'
import Tag from '../components/ui/Tag'
import { usePersonas } from '../hooks/useData'
import { api } from '../lib/api'
import { ESTADOS_TAREA, ROLES_EQUIPO, labelDe } from '../lib/constants'
import { formatFechaCorta, iniciales, todayISO } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { QK, TAREAS, invalidar } from '../lib/queryKeys'

const SEMAFORO = { rojo: 'Con vencidas', amarillo: 'Para hoy o bloqueadas', verde: 'Al día' }

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`)
const colorPct = (v) => (v === null || v === undefined ? 'var(--text-dim)' : v >= 80 ? 'var(--success)' : v >= 50 ? 'var(--gold)' : 'var(--accent3)')

function FilaTarea({ t, fecha, personas, onCambiar, pendiente }) {
  const vencida = t.estado !== 'hecha' && t.fecha_limite && t.fecha_limite < fecha
  const esHoy = t.fecha_limite === fecha
  return (
    <div className="seg-tarea">
      <div className="seg-tarea-main">
        <Link to={`/tareas?tarea=${t.id}`} className={`seg-tarea-titulo${t.estado === 'hecha' ? ' tachada' : ''}`}>
          {t.titulo}
        </Link>
        <div className="list-row-sub">
          {t.cliente_nombre ? `${t.cliente_nombre} · ` : ''}
          {t.fecha_limite ? (
            <span className={vencida ? 'down' : esHoy ? 'tc-hoy' : ''}>{vencida ? `venció ${formatFechaCorta(t.fecha_limite)}` : esHoy ? 'hoy' : formatFechaCorta(t.fecha_limite)}</span>
          ) : (
            'sin fecha'
          )}
        </div>
      </div>
      <select className="select-sm" aria-label="Estado" value={t.estado} disabled={pendiente} onChange={(e) => onCambiar(t, { estado: e.target.value })}>
        {ESTADOS_TAREA.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </select>
      <select className="select-sm" aria-label="Reasignar" value="" disabled={pendiente} onChange={(e) => e.target.value && onCambiar(t, { asignados: [Number(e.target.value)] }, true)}>
        <option value="">Reasignar…</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
    </div>
  )
}

function TarjetaPersona({ p, fecha, abierta, onToggle, personas, onCambiar, pendiente }) {
  const c = p.conteos
  return (
    <div className="card seg-card">
      <div className="seg-head">
        <span className="avatar-sm" style={{ background: p.color }}>
          {iniciales(p.nombre)}
        </span>
        <div className="seg-head-main">
          <div className="cell-title">{p.nombre}</div>
          <div className="cell-sub">{p.es_admin ? 'Administrador' : p.roles.map((r) => labelDe(ROLES_EQUIPO, r)).join(' + ') || 'Equipo'}</div>
        </div>
        <span className={`semaforo ${p.semaforo}`} title={SEMAFORO[p.semaforo]} aria-label={SEMAFORO[p.semaforo]} />
      </div>
      <div className="seg-conteos">
        <div className={c.vencidas ? 'down' : ''}>
          <strong>{c.vencidas}</strong>
          <span>vencidas</span>
        </div>
        <div>
          <strong>{c.hoy}</strong>
          <span>para hoy</span>
        </div>
        <div>
          <strong>{c.proximas}</strong>
          <span>próx. 3 días</span>
        </div>
        <div>
          <strong>{c.en_revision}</strong>
          <span>en revisión</span>
        </div>
        <div className={c.hechas_hoy ? 'up' : ''}>
          <strong>{c.hechas_hoy}</strong>
          <span>hechas hoy</span>
        </div>
      </div>
      <div className="seg-cumplimiento">
        <span>Cumplimiento en fecha · 7 días</span>
        <strong style={{ color: colorPct(p.cumplimiento_7) }}>{pct(p.cumplimiento_7)}</strong>
      </div>
      <ProgressBar valor={p.cumplimiento_7 ?? 0} color={colorPct(p.cumplimiento_7)} etiqueta="Cumplimiento 7 días" />
      <div className="muted small" style={{ marginTop: 4 }}>
        30 días: {pct(p.cumplimiento_30)}
        {c.bloqueadas ? <span className="down"> · {c.bloqueadas} bloqueada{c.bloqueadas === 1 ? '' : 's'}</span> : null}
        {c.sin_fecha ? ` · ${c.sin_fecha} sin fecha` : ''}
      </div>
      {p.tareas.length ? (
        <>
          <button type="button" className="link-btn seg-toggle" onClick={onToggle} aria-expanded={abierta}>
            {abierta ? 'Ocultar tareas' : `Ver tareas (${p.tareas.length})`}
          </button>
          {abierta ? (
            <div className="seg-tareas">
              {p.tareas.map((t) => (
                <FilaTarea key={t.id} t={t} fecha={fecha} personas={personas.filter((x) => x.id !== p.id)} onCambiar={onCambiar} pendiente={pendiente} />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="muted small" style={{ marginTop: 8 }}>
          Nada pendiente para estos días.
        </div>
      )}
    </div>
  )
}

export default function EquipoHoy() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const fecha = sp.get('fecha') || todayISO()
  const rol = sp.get('rol') || ''
  const [toggles, setToggles] = useState({})
  const { data: personas = [] } = usePersonas()
  const activas = personas.filter((p) => p.activo)
  const q = useQuery({
    queryKey: QK.seguimiento(fecha, rol),
    queryFn: () => api.get('equipo/seguimiento/', { params: { fecha, rol: rol || undefined } }).then((r) => r.data),
    refetchInterval: 120_000,
  })
  const filtrar = (cambios) => {
    const next = Object.fromEntries([...sp.entries(), ...Object.entries(cambios)].filter(([, v]) => v))
    setSp(next, { replace: true })
  }

  const cambiar = useMutation({
    mutationFn: ({ t, cambios }) => api.patch(`tareas/${t.id}/`, cambios),
    onSuccess: (_r, { t, reasignada }) => {
      invalidar(qc, TAREAS)
      notify(reasignada ? `«${t.titulo}» reasignada` : 'Tarea actualizada')
    },
    onError: (e) => notifyError(e, 'No se pudo actualizar la tarea'),
  })

  return (
    <>
      <PageHeader titulo="Equipo hoy" subtitulo="Qué tiene cada uno para hoy, qué se venció y cuánto cumple en fecha">
        <select className="select-sm" value={rol} onChange={(e) => filtrar({ rol: e.target.value })} aria-label="Filtrar por rol">
          <option value="">Todos los roles</option>
          {ROLES_EQUIPO.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
          <option value="admin">Socios</option>
        </select>
        <input type="date" className="select-sm" value={fecha} onChange={(e) => filtrar({ fecha: e.target.value })} aria-label="Fecha" />
      </PageHeader>
      <QueryState query={q} vacio="No hay personas activas con usuario del panel.">
        {(d) => (
          <>
            <div className="grid-4">
              <StatCard label="Vencidas" value={d.totales.vencidas} color="red" sub={`${d.totales.en_rojo} persona${d.totales.en_rojo === 1 ? '' : 's'} en rojo`} />
              <StatCard label="Para hoy" value={d.totales.hoy} color="gold" sub={`${d.totales.hechas_hoy} hechas hoy`} />
              <StatCard label="En revisión" value={d.totales.en_revision} color="purple" sub={d.totales.bloqueadas ? `${d.totales.bloqueadas} bloqueadas` : 'para aprobar'} />
              <StatCard label="Cumplimiento (7 días)" value={pct(d.totales.cumplimiento_7)} color="green" sub="promedio del equipo" />
            </div>
            {d.onboarding_atrasado?.length ? (
              <div className="card" style={{ marginTop: 16 }}>
                <div className="card-title">
                  <span className="dot" style={{ background: 'var(--accent3)' }} /> Onboarding atrasado
                </div>
                {d.onboarding_atrasado.map((o) => (
                  <Link key={o.cliente} to={`/clientes/${o.cliente}`} className="list-row list-row--link">
                    <div className="list-row-main">
                      <div className="list-row-title">{o.nombre}</div>
                      <div className="list-row-sub">
                        {o.hechas}/{o.total} pasos · {o.vencidas} vencido{o.vencidas === 1 ? '' : 's'}
                      </div>
                    </div>
                    <Tag color="red">Atrasado</Tag>
                  </Link>
                ))}
              </div>
            ) : null}
            <div className="seg-grid">
              {d.personas.map((p) => (
                <TarjetaPersona
                  key={p.id}
                  p={p}
                  fecha={fecha}
                  personas={activas}
                  abierta={toggles[p.id] ?? p.semaforo === 'rojo'}
                  onToggle={() => setToggles((s) => ({ ...s, [p.id]: !(s[p.id] ?? p.semaforo === 'rojo') }))}
                  onCambiar={(t, cambios, reasignada = false) => cambiar.mutate({ t, cambios, reasignada })}
                  pendiente={cambiar.isPending}
                />
              ))}
            </div>
          </>
        )}
      </QueryState>
    </>
  )
}
