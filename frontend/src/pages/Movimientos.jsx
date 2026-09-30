import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { useCategorias, useClientes, usePersonas } from '../hooks/useData'
import { abrirArchivo, api, descargarArchivo, getList } from '../lib/api'
import { MEDIOS_PAGO, labelDe } from '../lib/constants'
import { currentMonth, fmt, fmtCorto, formatFecha, monthLabel, todayISO } from '../lib/format'
import { num } from '../lib/money'
import { notify, notifyError } from '../lib/notify'
import { DINERO, QK, invalidar } from '../lib/queryKeys'
import { confirmar } from '../store/confirmStore'

const ORIGEN = { cobro: 'Cobro', liquidacion: 'Pago equipo', suscripcion: 'Suscripción' }

function FormMovimiento({ inicial, onClose }) {
  const qc = useQueryClient()
  const { data: categorias = [] } = useCategorias()
  const { data: clientes = [] } = useClientes()
  const { data: personas = [] } = usePersonas()
  const [f, setF] = useState(() => ({
    tipo: inicial?.tipo ?? 'ingreso',
    fecha: inicial?.fecha ?? todayISO(),
    descripcion: inicial?.descripcion ?? '',
    monto: inicial?.monto ?? '',
    categoria: inicial?.categoria ?? '',
    cliente: inicial?.cliente ?? '',
    persona: inicial?.persona ?? '',
    medio_pago: inicial?.medio_pago ?? 'transferencia',
    comprobante: inicial?.comprobante ?? '',
    notas: inicial?.notas ?? '',
  }))
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e?.target ? e.target.value : e }))
  const cats = categorias.filter((c) => c.tipo === f.tipo && (c.activa || String(c.id) === String(f.categoria)))
  const vinculado = Boolean(inicial?.origen)

  const guardar = useMutation({
    mutationFn: () => {
      const body = { ...f, categoria: f.categoria || cats[0]?.id, cliente: f.cliente || null, persona: f.persona || null }
      return inicial?.id ? api.put(`transacciones/${inicial.id}/`, body) : api.post('transacciones/', body)
    },
    onSuccess: () => {
      invalidar(qc, DINERO)
      notify(inicial?.id ? 'Movimiento actualizado' : 'Movimiento registrado')
      onClose()
    },
    onError: (e) => notifyError(e, 'No se pudo guardar el movimiento'),
  })

  return (
    <Modal
      title={inicial?.id ? 'Editar movimiento' : 'Nuevo movimiento'}
      onClose={onClose}
      size="lg"
      onSubmit={() => guardar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }
    >
      {vinculado ? (
        <div className="info-box">
          Este movimiento se generó desde <strong>{ORIGEN[inicial.origen.tipo]}</strong>. El monto se cambia desde esa sección.
        </div>
      ) : null}
      <div className="segmented" role="radiogroup" aria-label="Tipo de movimiento">
        {['ingreso', 'egreso'].map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={f.tipo === t}
            disabled={vinculado}
            className={f.tipo === t ? `active ${t}` : ''}
            onClick={() => setF((s) => ({ ...s, tipo: t, categoria: '' }))}
          >
            {t === 'ingreso' ? 'Ingreso' : 'Egreso'}
          </button>
        ))}
      </div>
      <div className="grid-2 tight">
        <Field label="Monto">
          <MoneyInput value={f.monto} onChange={set('monto')} required disabled={vinculado} />
        </Field>
        <Field label="Fecha">
          <input type="date" value={f.fecha} onChange={set('fecha')} required />
        </Field>
      </div>
      <Field label="Descripción">
        <input value={f.descripcion} onChange={set('descripcion')} maxLength={200} required placeholder={f.tipo === 'ingreso' ? 'Ej: Fee de octubre' : 'Ej: Canva Pro'} />
      </Field>
      <div className="grid-2 tight">
        <Field label="Categoría">
          <select value={f.categoria || cats[0]?.id || ''} onChange={set('categoria')} required>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cliente (opcional)">
          <select value={f.cliente ?? ''} onChange={set('cliente')}>
            <option value="">— Sin cliente —</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid-2 tight">
        <Field label="Medio de pago">
          <select value={f.medio_pago} onChange={set('medio_pago')}>
            <option value="">—</option>
            {MEDIOS_PAGO.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Comprobante / N.º de factura">
          <input value={f.comprobante} onChange={set('comprobante')} maxLength={80} />
        </Field>
      </div>
      {f.tipo === 'egreso' ? (
        <Field label="Persona del equipo (opcional)">
          <select value={f.persona ?? ''} onChange={set('persona')}>
            <option value="">— Ninguna —</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Notas">
        <textarea rows={2} value={f.notas} onChange={set('notas')} />
      </Field>
    </Modal>
  )
}

function Adjuntos({ tx }) {
  const qc = useQueryClient()
  const input = useRef(null)
  const subir = useMutation({
    mutationFn: (file) => {
      const fd = new FormData()
      fd.append('archivo', file)
      return api.post(`transacciones/${tx.id}/adjuntos/`, fd)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transacciones'] })
      notify('Comprobante adjuntado')
    },
    onError: (e) => notifyError(e, 'No se pudo adjuntar'),
  })
  const borrar = useMutation({
    mutationFn: (id) => api.delete(`adjuntos/${id}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transacciones'] }),
    onError: (e) => notifyError(e),
  })
  return (
    <div className="attach-cell">
      {tx.adjuntos.map((a) => (
        <span key={a.id} className="attach-chip">
          <button type="button" className="link-btn" title={a.nombre_original} onClick={() => abrirArchivo(`adjuntos/${a.id}/descargar/`).catch((e) => notifyError(e))}>
            📎 {a.nombre_original.length > 16 ? `${a.nombre_original.slice(0, 14)}…` : a.nombre_original}
          </button>
          <button
            type="button"
            className="link-btn down"
            aria-label="Quitar adjunto"
            onClick={async () => (await confirmar({ mensaje: `¿Quitar «${a.nombre_original}»?`, peligro: true, confirmar: 'Quitar' })) && borrar.mutate(a.id)}
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" className="btn btn-secondary btn-xs" disabled={subir.isPending} onClick={() => input.current?.click()}>
        {subir.isPending ? '…' : '+ Adjuntar'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) subir.mutate(file)
        }}
      />
    </div>
  )
}

export default function Movimientos() {
  const qc = useQueryClient()
  const [sp, setSp] = useSearchParams()
  const mes = sp.get('mes') || currentMonth()
  const tipo = sp.get('tipo') || ''
  const categoria = sp.get('categoria') || ''
  const cliente = sp.get('cliente') || ''
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState(null)
  const { data: categorias = [] } = useCategorias()
  const { data: clientes = [] } = useClientes()

  const setParam = (k, v) => {
    const n = new URLSearchParams(sp)
    if (v) n.set(k, v)
    else n.delete(k)
    setSp(n, { replace: true })
  }

  const params = { mes, tipo: tipo || undefined, categoria: categoria || undefined, cliente: cliente || undefined }
  const q = useQuery({ queryKey: QK.transacciones(params), queryFn: () => getList('transacciones/', params) })
  const todasMes = useQuery({ queryKey: QK.transacciones({ mes }), queryFn: () => getList('transacciones/', { mes }) })

  const borrar = useMutation({
    mutationFn: (id) => api.delete(`transacciones/${id}/`),
    onSuccess: () => {
      invalidar(qc, DINERO)
      notify('Movimiento eliminado')
    },
    onError: (e) => notifyError(e),
  })

  const filtradas = useMemo(() => {
    const s = busqueda.trim().toLowerCase()
    const lista = q.data ?? []
    if (!s) return lista
    return lista.filter((t) => [t.descripcion, t.notas, t.comprobante, t.cliente_nombre, t.categoria_nombre].some((x) => (x || '').toLowerCase().includes(s)))
  }, [q.data, busqueda])

  const resumen = useMemo(() => {
    const lista = todasMes.data ?? []
    const ing = lista.filter((t) => t.tipo === 'ingreso').reduce((a, t) => a + num(t.monto), 0)
    const eg = lista.filter((t) => t.tipo === 'egreso').reduce((a, t) => a + num(t.monto), 0)
    const porCat = {}
    lista.forEach((t) => {
      const k = `${t.tipo}|${t.categoria_nombre}`
      porCat[k] = porCat[k] || { tipo: t.tipo, nombre: t.categoria_nombre, color: t.categoria_color, id: t.categoria, total: 0 }
      porCat[k].total += num(t.monto)
    })
    return { ing, eg, cats: Object.values(porCat).sort((a, b) => b.total - a.total) }
  }, [todasMes.data])

  const eliminar = async (t) => {
    const extra = t.origen ? ` Como viene de ${ORIGEN[t.origen.tipo]}, ese registro vuelve a quedar pendiente.` : ''
    if (await confirmar({ titulo: 'Eliminar movimiento', mensaje: `¿Eliminar «${t.descripcion}» por ${fmt(t.monto)}?${extra}`, peligro: true, confirmar: 'Eliminar' })) {
      borrar.mutate(t.id)
    }
  }

  const maxCat = Math.max(1, ...resumen.cats.map((c) => c.total))

  return (
    <>
      <PageHeader titulo="Movimientos" subtitulo="Ingresos y egresos de la agencia">
        <MonthPicker value={mes} onChange={(v) => setParam('mes', v)} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => descargarArchivo('transacciones/export.csv/', `movimientos-${mes}.csv`, params).catch((e) => notifyError(e))}>
          ⬇ CSV
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditando({})}>
          + Nuevo movimiento
        </button>
      </PageHeader>

      <div className="grid-3">
        <StatCard label={`Ingresos — ${monthLabel(mes)}`} value={fmtCorto(resumen.ing)} color="green" onClick={() => setParam('tipo', 'ingreso')} />
        <StatCard label="Egresos" value={fmtCorto(resumen.eg)} color="red" onClick={() => setParam('tipo', 'egreso')} />
        <StatCard label="Resultado" value={<span className={resumen.ing - resumen.eg >= 0 ? 'up' : 'down'}>{fmtCorto(resumen.ing - resumen.eg)}</span>} color="purple" />
      </div>

      <div className="grid-2 layout-side" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="filters">
            <input type="search" placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar movimientos" />
            <select value={tipo} onChange={(e) => setParam('tipo', e.target.value)} aria-label="Tipo">
              <option value="">Ingresos y egresos</option>
              <option value="ingreso">Solo ingresos</option>
              <option value="egreso">Solo egresos</option>
            </select>
            <select value={categoria} onChange={(e) => setParam('categoria', e.target.value)} aria-label="Categoría">
              <option value="">Todas las categorías</option>
              {categorias
                .filter((c) => !tipo || c.tipo === tipo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({c.tipo})
                  </option>
                ))}
            </select>
            <select value={cliente} onChange={(e) => setParam('cliente', e.target.value)} aria-label="Cliente">
              <option value="">Todos los clientes</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <QueryState query={q} vacio="No hay movimientos con estos filtros.">
            <div className="table-responsive tabla-apilada">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th className="num">Monto</th>
                    <th>Comprobantes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((t) => (
                    <tr key={t.id}>
                      <td className="nowrap" data-label="Fecha">
                        {formatFecha(t.fecha, { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="celda-principal">
                        <div className="cell-title">{t.descripcion}</div>
                        <div className="cell-sub">
                          {t.cliente_nombre ? <span>🏷️ {t.cliente_nombre} </span> : null}
                          {t.persona_nombre ? <span>👤 {t.persona_nombre} </span> : null}
                          {t.medio_pago ? <span>· {labelDe(MEDIOS_PAGO, t.medio_pago)} </span> : null}
                          {t.origen ? <Tag color="purple">{ORIGEN[t.origen.tipo]}</Tag> : null}
                        </div>
                      </td>
                      <td data-label="Categoría">
                        <span className="cat-dot" style={{ background: t.categoria_color }} />
                        {t.categoria_nombre}
                      </td>
                      <td className={`num mono nowrap ${t.tipo === 'ingreso' ? 'up' : 'down'}`} data-label="Monto">
                        {t.tipo === 'ingreso' ? '+' : '−'}
                        {fmt(t.monto)}
                      </td>
                      <td className="celda-ancha">
                        <Adjuntos tx={t} />
                      </td>
                      <td className="nowrap actions-cell">
                        <button type="button" className="btn btn-secondary btn-xs" onClick={() => setEditando(t)}>
                          Editar
                        </button>{' '}
                        <button type="button" className="btn btn-danger btn-xs" onClick={() => eliminar(t)} aria-label="Eliminar">
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
        <div className="card">
          <div className="card-title">
            <span className="dot" /> Por categoría
          </div>
          {resumen.cats.length === 0 ? (
            <div className="empty">Sin datos este mes.</div>
          ) : (
            resumen.cats.map((c) => (
              <button key={`${c.tipo}-${c.nombre}`} type="button" className="cat-row" onClick={() => setParam('categoria', String(c.id))}>
                <div className="cat-row-head">
                  <span>
                    <span className="cat-dot" style={{ background: c.color }} />
                    {c.nombre}
                  </span>
                  <span className={`mono ${c.tipo === 'ingreso' ? 'up' : 'down'}`}>{fmtCorto(c.total)}</span>
                </div>
                <ProgressBar valor={(c.total / maxCat) * 100} color={c.tipo === 'ingreso' ? 'var(--success)' : 'var(--accent3)'} />
              </button>
            ))
          )}
        </div>
      </div>
      {editando ? <FormMovimiento inicial={editando.id ? editando : null} onClose={() => setEditando(null)} /> : null}
    </>
  )
}
