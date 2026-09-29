import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import Tag from '../components/ui/Tag'
import { useClientes } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { PLATAFORMAS, labelDe } from '../lib/constants'
import { currentMonth, formatFecha, formatFechaHora } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { QK } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

const MAX_POR_GRUPO = 6
const MAX_BYTES = 8 * 1024 * 1024
const ESTADO = { procesando: { label: 'Analizando…', tag: 'purple' }, listo: { label: 'Listo', tag: 'green' }, error: { label: 'Error', tag: 'red' } }

function textoPlano(a) {
  return [
    `Aura Team — ${a.cliente_nombre || 'Estadísticas'} · ${a.plataforma_label || ''}`,
    a.periodo_desde || a.periodo_hasta ? `Período: ${formatFecha(a.periodo_desde)} – ${formatFecha(a.periodo_hasta)}` : null,
    '',
    'Métrica | Antes | Después | Variación',
    ...a.metricas.map((m) => `${m.nombre} | ${m.antes || '—'} | ${m.despues || '—'} | ${m.variacion || '—'}`),
    '',
    a.interpretacion,
  ]
    .filter((x) => x !== null)
    .join('\n')
}

function ImagenProtegida({ id }) {
  const q = useQuery({
    queryKey: ['stats-img', id],
    queryFn: () => api.get(`stats-imagenes/${id}/ver/`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data)),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  })
  if (q.isError) return <div className="thumb thumb--error">No disponible</div>
  if (!q.data) return <div className="thumb" />
  return (
    <a href={q.data} target="_blank" rel="noreferrer">
      <img className="thumb" src={q.data} alt="Captura" />
    </a>
  )
}

function Subida({ titulo, archivos, onChange }) {
  const agregar = (files) => {
    const nuevos = []
    for (const file of Array.from(files || [])) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_BYTES) {
        notify(`«${file.name}» supera los 8 MB`, 'error')
        continue
      }
      nuevos.push({ file, url: URL.createObjectURL(file) })
    }
    const todos = [...archivos, ...nuevos]
    if (todos.length > MAX_POR_GRUPO) notify(`Máximo ${MAX_POR_GRUPO} capturas por período`, 'error')
    todos.slice(MAX_POR_GRUPO).forEach((a) => URL.revokeObjectURL(a.url))
    onChange(todos.slice(0, MAX_POR_GRUPO))
  }
  return (
    <div
      className="dropzone"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        agregar(e.dataTransfer.files)
      }}
    >
      <div className="dropzone-head">
        <strong>{titulo}</strong>
        <label className="btn btn-secondary btn-xs">
          + Capturas
          <input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => {
              agregar(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {archivos.length === 0 ? (
        <div className="muted small">Arrastrá capturas acá (máx. {MAX_POR_GRUPO})</div>
      ) : (
        <div className="thumbs">
          {archivos.map((a, i) => (
            <div key={a.url} className="thumb-wrap">
              <img className="thumb" src={a.url} alt={a.file.name} />
              <button
                type="button"
                className="thumb-x"
                aria-label="Quitar"
                onClick={() => {
                  URL.revokeObjectURL(a.url)
                  onChange(archivos.filter((_, j) => j !== i))
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DetalleAnalisis({ analisis, onClose }) {
  const qc = useQueryClient()
  const { data: clientes = [] } = useClientes()
  const [f, setF] = useState(() => ({
    cliente: analisis.cliente ?? '',
    plataforma: analisis.plataforma ?? '',
    periodo_desde: analisis.periodo_desde ?? '',
    periodo_hasta: analisis.periodo_hasta ?? '',
    interpretacion: analisis.interpretacion ?? '',
    notas: analisis.notas ?? '',
  }))
  const [metricas, setMetricas] = useState(() => analisis.metricas.map((m) => ({ ...m })))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const setMet = (i, k, v) => setMetricas((arr) => arr.map((m, j) => (j === i ? { ...m, [k]: v } : m)))
  const antes = analisis.imagenes.filter((i) => i.grupo === 'antes')
  const despues = analisis.imagenes.filter((i) => i.grupo === 'despues')

  const guardar = useMutation({
    mutationFn: () =>
      api.patch(`stats/${analisis.id}/`, {
        ...f,
        cliente: f.cliente || null,
        periodo_desde: f.periodo_desde || null,
        periodo_hasta: f.periodo_hasta || null,
        metricas: metricas.filter((m) => String(m.nombre).trim()),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stats'] })
      qc.invalidateQueries({ queryKey: ['clientes'] })
      notify('Análisis actualizado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar'),
  })
  const borrar = useMutation({
    mutationFn: () => api.delete(`stats/${analisis.id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stats'] })
      notify('Análisis eliminado')
      onClose()
    },
    onError: (e) => notifyError(e),
  })

  return (
    <Modal
      title={`${analisis.cliente_nombre || 'Sin cliente'} · ${analisis.plataforma_label || 'Estadísticas'}`}
      onClose={onClose}
      size="xl"
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => (await confirmar({ mensaje: 'Se borra el análisis y sus capturas.', peligro: true, confirmar: 'Eliminar' })) && borrar.mutate()}
          >
            Eliminar
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigator.clipboard?.writeText(textoPlano({ ...analisis, ...f, metricas })).then(() => notify('Copiado: pegalo en Docs o WhatsApp'))}
          >
            Copiar texto
          </button>
          {analisis.cliente ? (
            <Link className="btn btn-secondary" to={`/clientes/${analisis.cliente}/reporte?mes=${(analisis.periodo_hasta || analisis.creado).slice(0, 7) || currentMonth()}`}>
              Reporte del mes
            </Link>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
            Guardar cambios
          </button>
        </>
      }
    >
      <div className="grid-2 tight">
        <div>
          <div className="small muted">Antes</div>
          <div className="thumbs">{antes.length ? antes.map((i) => <ImagenProtegida key={i.id} id={i.id} />) : <span className="muted small">—</span>}</div>
        </div>
        <div>
          <div className="small muted">Después</div>
          <div className="thumbs">{despues.length ? despues.map((i) => <ImagenProtegida key={i.id} id={i.id} />) : <span className="muted small">—</span>}</div>
        </div>
      </div>
      <div className="grid-4 tight">
        <Field label="Cliente">
          <select value={f.cliente ?? ''} onChange={set('cliente')}>
            <option value="">—</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Plataforma">
          <select value={f.plataforma} onChange={set('plataforma')}>
            <option value="">—</option>
            {PLATAFORMAS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Desde">
          <input type="date" value={f.periodo_desde ?? ''} onChange={set('periodo_desde')} />
        </Field>
        <Field label="Hasta">
          <input type="date" value={f.periodo_hasta ?? ''} onChange={set('periodo_hasta')} />
        </Field>
      </div>
      <div className="items-editor">
        <div className="items-head">
          <span>Métricas</span>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => setMetricas((a) => [...a, { nombre: '', antes: '', despues: '', variacion: '' }])}>
            + Métrica
          </button>
        </div>
        {metricas.map((m, i) => (
          <div key={i} className="item-row item-row--4">
            <input aria-label="Métrica" placeholder="Seguidores, alcance…" value={m.nombre} onChange={(e) => setMet(i, 'nombre', e.target.value)} />
            <input aria-label="Antes" placeholder="Antes" value={m.antes} onChange={(e) => setMet(i, 'antes', e.target.value)} />
            <input aria-label="Después" placeholder="Después" value={m.despues} onChange={(e) => setMet(i, 'despues', e.target.value)} />
            <input aria-label="Variación" placeholder="+12%" value={m.variacion} onChange={(e) => setMet(i, 'variacion', e.target.value)} />
            <button type="button" className="link-btn down" aria-label="Quitar" onClick={() => setMetricas((a) => a.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
      </div>
      <Field label="Interpretación">
        <textarea rows={5} value={f.interpretacion} onChange={set('interpretacion')} />
      </Field>
      <Field label="Notas internas">
        <textarea rows={2} value={f.notas} onChange={set('notas')} />
      </Field>
    </Modal>
  )
}

export default function Estadisticas() {
  const qc = useQueryClient()
  const [sp] = useSearchParams()
  const { data: clientes = [] } = useClientes()
  const [form, setForm] = useState(() => ({ cliente: sp.get('cliente') || '', plataforma: 'instagram', periodo_desde: '', periodo_hasta: '' }))
  const [antes, setAntes] = useState([])
  const [despues, setDespues] = useState([])
  const [filtroCliente, setFiltroCliente] = useState(sp.get('cliente') || '')
  const [abierto, setAbierto] = useState(null)
  const params = { cliente: filtroCliente || undefined }

  const historial = useQuery({
    queryKey: QK.stats(params),
    queryFn: () => getList('stats/', params),
    refetchInterval: (query) => (query.state.data?.some((a) => a.estado === 'procesando') ? 3000 : false),
  })

  const analizar = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      antes.forEach(({ file }) => fd.append('antes', file))
      despues.forEach(({ file }) => fd.append('despues', file))
      Object.entries(form).forEach(([k, v]) => v && fd.append(k, v))
      return api.post('stats/analizar/', fd).then((r) => r.data)
    },
    onSuccess: (a) => {
      ;[...antes, ...despues].forEach((x) => URL.revokeObjectURL(x.url))
      setAntes([])
      setDespues([])
      qc.invalidateQueries({ queryKey: ['stats'] })
      notify(a.estado === 'procesando' ? 'Capturas subidas. El análisis tarda unos segundos…' : 'Análisis guardado')
      if (a.estado !== 'procesando') setAbierto(a)
    },
    onError: (e) => notifyError(e, 'No se pudo analizar'),
  })

  const setF = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }))
  const actual = abierto ? (historial.data ?? []).find((a) => a.id === abierto.id) || abierto : null

  return (
    <>
      <PageHeader titulo="Estadísticas" subtitulo="Subí capturas de antes y después; la IA extrae las métricas y las guarda en la ficha del cliente" />
      <div className="card">
        <div className="card-title">
          <span className="dot" /> Nuevo análisis
        </div>
        <div className="grid-4 tight">
          <Field label="Cliente">
            <select value={form.cliente} onChange={setF('cliente')}>
              <option value="">— Sin cliente —</option>
              {clientes
                .filter((c) => c.estado !== 'baja')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Plataforma">
            <select value={form.plataforma} onChange={setF('plataforma')}>
              {PLATAFORMAS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Período desde">
            <input type="date" value={form.periodo_desde} onChange={setF('periodo_desde')} />
          </Field>
          <Field label="Período hasta">
            <input type="date" value={form.periodo_hasta} onChange={setF('periodo_hasta')} />
          </Field>
        </div>
        <div className="grid-2 tight">
          <Subida titulo="Antes (período anterior)" archivos={antes} onChange={setAntes} />
          <Subida titulo="Después (período actual)" archivos={despues} onChange={setDespues} />
        </div>
        <div className="header-actions" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={analizar.isPending || (!antes.length && !despues.length)} onClick={() => analizar.mutate()}>
            {analizar.isPending ? 'Subiendo…' : 'Analizar'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title-row">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent2)' }} /> Historial
          </div>
          <select className="select-sm" value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)} aria-label="Filtrar por cliente">
            <option value="">Todos los clientes</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <QueryState query={historial} vacio="Todavía no hay análisis.">
          {(lista) =>
            lista.map((a) => (
              <button key={a.id} type="button" className="list-row list-row--link" onClick={() => setAbierto(a)} disabled={a.estado === 'procesando'}>
                <div className="list-row-main">
                  <div className="list-row-title">
                    {a.cliente_nombre || 'Sin cliente'} · {a.plataforma_label || labelDe(PLATAFORMAS, a.plataforma)}
                  </div>
                  <div className="list-row-sub">
                    {a.periodo_hasta ? `${formatFecha(a.periodo_desde)} – ${formatFecha(a.periodo_hasta)}` : formatFechaHora(a.creado)} · {a.metricas.length} métricas · {a.imagenes.length} capturas
                  </div>
                </div>
                <Tag color={ESTADO[a.estado]?.tag}>{ESTADO[a.estado]?.label ?? a.estado}</Tag>
              </button>
            ))
          }
        </QueryState>
      </div>
      {actual && actual.estado !== 'procesando' ? <DetalleAnalisis key={actual.id} analisis={actual} onClose={() => setAbierto(null)} /> : null}
    </>
  )
}
