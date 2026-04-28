import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { QK } from '../lib/queryKeys'
import { notify } from '../lib/notify'

function metricasRows(display) {
  return Array.isArray(display?.metricas) ? display.metricas : []
}

function buildStatsPlain(display) {
  if (!display) return ''
  const rows = metricasRows(display)
  const blocks = [
    'Aura Team — Informe de estadísticas',
    `Plataforma: ${display.plataforma || '—'}`,
    `Generado: ${new Date().toLocaleString('es-AR')}`,
    '',
    display.interpretacion ? `Interpretación:\n${display.interpretacion}\n` : null,
    'Métrica | Anterior | Reciente | Variación',
    ...rows.map((m) => `${m.nombre ?? '—'} | ${m.antes ?? '—'} | ${m.despues ?? '—'} | ${m.variacion ?? '—'}`),
  ]
  return blocks.filter(Boolean).join('\n')
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildStatsHtml(display) {
  if (!display) return '<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body></body></html>'
  const rows = metricasRows(display)
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.nombre ?? '—')}</td><td>${escapeHtml(String(m.antes ?? '—'))}</td><td>${escapeHtml(String(m.despues ?? '—'))}</td><td>${escapeHtml(String(m.variacion ?? '—'))}</td></tr>`,
    )
    .join('')
  const interp = display.interpretacion
    ? `<p>${escapeHtml(display.interpretacion).replace(/\n/g, '<br/>')}</p>`
    : ''
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Estadísticas</title></head><body>
<h1>Comparativa de métricas</h1>
<p><strong>Plataforma:</strong> ${escapeHtml(display.plataforma || '—')}</p>
${interp}
<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Métrica</th><th>Anterior</th><th>Reciente</th><th>Variación</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Sin métricas</td></tr>'}</tbody></table>
</body></html>`
}

async function copyStatsForDocs(display) {
  const plain = buildStatsPlain(display)
  const html = buildStatsHtml(display)
  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([plain], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ])
      notify('Copiado. Abrí un documento nuevo en Google Docs y pegá (Cmd/Ctrl+V).')
      return
    }
  } catch {
    /* continuar con texto */
  }
  try {
    await navigator.clipboard.writeText(plain)
    notify('Copiado como texto plano')
  } catch {
    notify('No se pudo copiar al portapapeles')
  }
}

function downloadStatsTxt(display) {
  const blob = new Blob([buildStatsPlain(display)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `estadisticas-${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(url)
  notify('Archivo .txt descargado')
}

export default function Estadisticas() {
  const qc = useQueryClient()
  const [antes, setAntes] = useState([])
  const [despues, setDespues] = useState([])
  const [lastResult, setLastResult] = useState(null)

  const statsQ = useQuery({
    queryKey: QK.stats,
    queryFn: () => api.get('stats/').then((r) => r.data),
  })

  const ready = antes.length > 0 && despues.length > 0

  const onFiles = useCallback((files, which) => {
    const list = Array.from(files || []).map((file) => ({ file, name: file.name, url: URL.createObjectURL(file) }))
    if (which === 'antes') setAntes((p) => [...p, ...list])
    else setDespues((p) => [...p, ...list])
  }, [])

  const remove = (which, idx) => {
    const row = which === 'antes' ? antes[idx] : despues[idx]
    if (row?.url) URL.revokeObjectURL(row.url)
    if (which === 'antes') setAntes((p) => p.filter((_, i) => i !== idx))
    else setDespues((p) => p.filter((_, i) => i !== idx))
  }

  const analizar = useMutation({
    mutationFn: async () => {
      const fd = new FormData()
      antes.forEach(({ file }) => fd.append('antes', file))
      despues.forEach(({ file }) => fd.append('despues', file))
      fd.append('plataforma', 'instagram')
      const { data } = await api.post('stats/analizar/', fd)
      return data
    },
    onSuccess: (data) => {
      setLastResult(data)
      qc.invalidateQueries({ queryKey: QK.stats })
      notify('Análisis guardado')
    },
    onError: (e) => notify(e.response?.data?.detail || 'Error al analizar'),
  })

  const delStat = useMutation({
    mutationFn: (id) => api.delete(`stats/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.stats })
      notify('Eliminado del historial')
    },
    onError: () => notify('No se pudo eliminar'),
  })

  const limpiar = () => {
    antes.forEach((r) => r.url && URL.revokeObjectURL(r.url))
    despues.forEach((r) => r.url && URL.revokeObjectURL(r.url))
    setAntes([])
    setDespues([])
    setLastResult(null)
    notify('Vista limpiada')
  }

  const display = lastResult || null
  const metricas = Array.isArray(display?.metricas) ? display.metricas : []

  return (
    <div className="page active" id="page-estadisticas">
      <div className="section-header">
        <div>
          <h2>Estadísticas 📈</h2>
          <p>Comparativa de métricas de redes sociales con IA</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={limpiar}>
            🗑 Limpiar
          </button>
          <button type="button" className="btn btn-primary btn-sm" style={{ display: ready ? 'inline-flex' : 'none' }} disabled={analizar.isPending} onClick={() => analizar.mutate()}>
            {analizar.isPending ? '⏳ Analizando…' : '🤖 Analizar con IA'}
          </button>
        </div>
      </div>
      <div className="grid-2" style={{ marginBottom: '20px' }}>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent3)' }} />
            Screenshots ANTERIORES
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '12px' }}>Período de referencia (más antiguo)</div>
          <div
            style={{ border: '2px dashed var(--border)', borderRadius: '10px', padding: '32px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
            onClick={() => document.getElementById('input-antes')?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              e.currentTarget.style.borderColor = 'var(--accent3)'
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.style.borderColor = 'var(--border)'
              onFiles(e.dataTransfer.files, 'antes')
            }}
            role="presentation"
          >
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Arrastrá o hacé clic para subir imágenes</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>JPG, PNG, WEBP</div>
          </div>
          <input type="file" id="input-antes" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files, 'antes')} />
          <div id="preview-antes" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {antes.map((f, idx) => (
              <div key={`${f.name}-${idx}`} style={{ position: 'relative' }}>
                <img src={f.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
                <button type="button" className="btn btn-danger btn-xs" style={{ position: 'absolute', top: 2, right: 2 }} onClick={() => remove('antes', idx)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent)' }} />
            Screenshots RECIENTES
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '12px' }}>Período actual (más nuevo)</div>
          <div
            style={{ border: '2px dashed var(--border)', borderRadius: '10px', padding: '32px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s' }}
            onClick={() => document.getElementById('input-despues')?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              e.currentTarget.style.borderColor = 'var(--accent)'
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.style.borderColor = 'var(--border)'
              onFiles(e.dataTransfer.files, 'despues')
            }}
            role="presentation"
          >
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
            <div style={{ fontSize: '14px', color: 'var(--text-muted)' }}>Arrastrá o hacé clic para subir imágenes</div>
            <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>JPG, PNG, WEBP</div>
          </div>
          <input type="file" id="input-despues" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files, 'despues')} />
          <div id="preview-despues" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
            {despues.map((f, idx) => (
              <div key={`${f.name}-${idx}`} style={{ position: 'relative' }}>
                <img src={f.url} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8 }} />
                <button type="button" className="btn btn-danger btn-xs" style={{ position: 'absolute', top: 2, right: 2 }} onClick={() => remove('despues', idx)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {analizar.isPending ? (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ textAlign: 'center', padding: '32px' }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', display: 'inline-block' }}>⚙️</div>
            <div style={{ fontSize: '16px', color: 'var(--text)' }}>Analizando imágenes…</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '6px' }}>Extrayendo métricas de las capturas</div>
          </div>
        </div>
      ) : null}
      {display ? (
        <div className="card" style={{ marginBottom: '20px' }}>
          <div className="card-title" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="dot" />
              Comparativa de métricas
            </span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: 'auto' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyStatsForDocs(display)}>
                📋 Copiar para Docs
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadStatsTxt(display)}>
                ⬇ .txt
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  window.open('https://docs.google.com/document/create', '_blank', 'noopener,noreferrer')
                  notify('Abrí el documento y pegá el informe si ya lo copiaste.')
                }}
              >
                Google Docs ↗
              </button>
            </span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>{display.plataforma || '—'}</div>
          {display.interpretacion ? (
            <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 16 }}>{display.interpretacion}</p>
          ) : null}
          <table>
            <thead>
              <tr>
                <th>Métrica</th>
                <th>Período anterior</th>
                <th>Período reciente</th>
                <th>Variación</th>
              </tr>
            </thead>
            <tbody>
              {metricas.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--text-muted)', padding: 16 }}>
                    Sin filas de métricas (configurá IA en el servidor para extracción automática).
                  </td>
                </tr>
              ) : (
                metricas.map((m, i) => (
                  <tr key={i}>
                    <td>{m.nombre}</td>
                    <td>{m.antes ?? '—'}</td>
                    <td>{m.despues ?? '—'}</td>
                    <td>{m.variacion ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="card">
        <div className="card-title">
          <span className="dot" style={{ background: 'var(--gold)' }} />
          Historial
        </div>
        {statsQ.isPending ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cargando…</p>
        ) : (statsQ.data || []).length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Sin análisis previos</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {(statsQ.data || []).map((s) => (
              <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{new Date(s.creado).toLocaleString('es-AR')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{s.plataforma || 'sin plataforma'}</div>
                </div>
                <button type="button" className="btn btn-danger btn-xs" onClick={() => delStat.mutate(s.id)} disabled={delStat.isPending}>
                  🗑
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
