import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModal } from '../context/ModalContext'
import { usePhase1 } from '../context/Phase1Context'
import { api } from '../lib/api'
import { QK } from '../lib/queryKeys'
import { useModalStore } from '../store/modalStore'
import { fmt } from '../lib/format'
import { notify } from '../lib/notify'

function filtrar(txs, mes, tipo, cat) {
  return txs.filter((t) => {
    const enMes = mes ? t.fecha.startsWith(mes) : true
    const enTipo = tipo ? t.tipo === tipo : true
    const enCat = cat ? t.cat === cat : true
    return enMes && enTipo && enCat
  })
}

const catColors = {
  Servicios: 'var(--accent2)',
  Alimentación: 'var(--gold)',
  Transporte: '#4fc3f7',
  Salud: 'var(--accent3)',
  Educación: 'var(--accent)',
  Entretenimiento: '#f06292',
  Otros: 'var(--text-dim)',
}

export default function Ingresos() {
  const { state } = usePhase1()
  const { openModal } = useModal()
  const qc = useQueryClient()
  const setEditTransaccionId = useModalStore((s) => s.setEditTransaccionId)
  const setAdjuntoTransaccionId = useModalStore((s) => s.setAdjuntoTransaccionId)
  const cur = state.config.moneda

  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [tipo, setTipo] = useState('')
  const [cat, setCat] = useState('')

  const txs = useMemo(() => filtrar(state.transacciones, mes, tipo, cat), [state.transacciones, mes, tipo, cat])

  const delTx = useMutation({
    mutationFn: (id) => api.delete(`transacciones/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.transacciones })
      notify('Transacción eliminada')
    },
    onError: () => notify('No se pudo eliminar'),
  })

  const delAdj = useMutation({
    mutationFn: (id) => api.delete(`adjuntos/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.transacciones })
      notify('Adjunto eliminado')
    },
    onError: () => notify('No se pudo eliminar el adjunto'),
  })

  const { ing, eg, bal, catBarsHtml } = useMemo(() => {
    const ingV = txs.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0)
    const egV = txs.filter((t) => t.tipo === 'egreso').reduce((s, t) => s + t.monto, 0)
    const balV = ingV - egV

    const cats = {}
    txs.filter((t) => t.tipo === 'egreso').forEach((t) => {
      cats[t.cat] = (cats[t.cat] || 0) + t.monto
    })
    const maxVal = Math.max(...Object.values(cats), 1)
    const catHtml =
      Object.entries(cats)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([c, val]) =>
            `<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;"><span>${c}</span><span style="font-family:var(--font-mono);color:var(--accent3);">${fmt(val, cur)}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${((val / maxVal) * 100).toFixed(1)}%;background:${catColors[c] || 'var(--accent)'}"></div></div></div>`,
        )
        .join('') || '<div style="color:var(--text-dim);font-size:13px;">Sin egresos en este período</div>'

    return { ing: ingV, eg: egV, bal: balV, catBarsHtml: catHtml }
  }, [txs, cur])

  const exportCSV = async () => {
    try {
      const res = await api.get('transacciones/export.csv/', {
        params: {
          mes: mes || undefined,
          tipo: tipo || undefined,
          categoria: cat || undefined,
        },
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = 'transacciones.csv'
      a.click()
      URL.revokeObjectURL(url)
      notify('📥 CSV exportado')
    } catch {
      notify('Error al exportar CSV')
    }
  }

  const openNuevaTx = () => {
    useModalStore.getState().clearTransaccionModal()
    openModal('modal-transaccion')
  }

  const openEditTx = (id) => {
    setEditTransaccionId(id)
    openModal('modal-transaccion')
  }

  const openAdjunto = (txId) => {
    setAdjuntoTransaccionId(txId)
    openModal('modal-adjunto')
  }

  return (
    <div className="page active" id="page-ingresos">
      <div className="section-header">
        <div>
          <h2>Ingresos &amp; Egresos</h2>
          <p>Control financiero mensual</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportCSV}>
            📥 Exportar CSV
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={openNuevaTx}>
            + Nueva transacción
          </button>
        </div>
      </div>
      <div className="card" style={{ padding: '16px 24px' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ margin: 0, whiteSpace: 'nowrap' }}>Mes:</label>
            <input type="month" id="filtro-mes" style={{ width: '160px' }} value={mes} onChange={(e) => setMes(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ margin: 0 }}>Tipo:</label>
            <select id="filtro-tipo" style={{ width: '140px' }} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ margin: 0 }}>Categoría:</label>
            <select id="filtro-cat" style={{ width: '160px' }} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Todas</option>
              <option>Salario</option>
              <option>Freelance</option>
              <option>Inversión</option>
              <option>Servicios</option>
              <option>Alimentación</option>
              <option>Transporte</option>
              <option>Salud</option>
              <option>Educación</option>
              <option>Entretenimiento</option>
              <option>Otros</option>
            </select>
          </div>
        </div>
      </div>
      <div className="grid-3" style={{ marginBottom: '20px' }}>
        <div className="stat-card green">
          <div className="stat-label">Total ingresos</div>
          <div className="stat-value" id="total-ing">
            {fmt(ing, cur)}
          </div>
        </div>
        <div className="stat-card red">
          <div className="stat-label">Total egresos</div>
          <div className="stat-value" id="total-eg">
            {fmt(eg, cur)}
          </div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Balance</div>
          <div className="stat-value" id="total-bal" style={{ color: bal >= 0 ? 'var(--accent)' : 'var(--accent3)' }}>
            {fmt(bal, cur)}
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: '20px' }}>
        <div className="card-title">
          <span className="dot" />
          Distribución por categoría
        </div>
        <div id="cat-bars" dangerouslySetInnerHTML={{ __html: catBarsHtml }} />
      </div>
      <div className="card">
        <div className="card-title">
          <span className="dot" style={{ background: 'var(--gold)' }} />
          Registro de transacciones
        </div>
        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Descripción</th>
                <th>Categoría</th>
                <th>Tipo</th>
                <th>Monto</th>
                <th>Adjuntos</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="tabla-transacciones">
              {txs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 32 }}>
                    Sin transacciones en este período
                  </td>
                </tr>
              ) : (
                txs.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{t.fecha}</td>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--text)' }}>{t.desc}</div>
                      {t.notas ? <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t.notas}</div> : null}
                    </td>
                    <td>
                      <span className="tag tag-purple">{t.cat}</span>
                    </td>
                    <td>
                      <span className={`tag ${t.tipo === 'ingreso' ? 'tag-green' : 'tag-red'}`}>{t.tipo === 'ingreso' ? '↑ Ingreso' : '↓ Egreso'}</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: t.tipo === 'ingreso' ? 'var(--accent)' : 'var(--accent3)' }}>
                      {t.tipo === 'ingreso' ? '+' : '-'}
                      {fmt(t.monto, cur)}
                    </td>
                    <td>
                      <div className="attach-list">
                        {(t.adjuntos || []).length ? (
                          (t.adjuntos || []).map((a) => (
                            <div key={a.id} className="attach-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <a href={a.dataUrl} download={a.nombre} target="_blank" rel="noreferrer">
                                📄 {a.desc || a.nombre}
                              </a>
                              <button type="button" className="btn btn-danger btn-xs" title="Eliminar" onClick={() => delAdj.mutate(a.id)}>
                                ✕
                              </button>
                            </div>
                          ))
                        ) : (
                          <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>Sin adjuntos</span>
                        )}
                      </div>
                      <button type="button" className="btn btn-secondary btn-xs" style={{ marginTop: 6 }} onClick={() => openAdjunto(t.id)}>
                        📎 Adjuntar
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button type="button" className="btn btn-warning btn-xs" onClick={() => openEditTx(t.id)}>
                          ✏️
                        </button>
                        <button type="button" className="btn btn-danger btn-xs" onClick={() => delTx.mutate(t.id)} disabled={delTx.isPending}>
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
