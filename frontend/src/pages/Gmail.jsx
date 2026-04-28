import { useCallback, useState } from 'react'
import { useModal } from '../context/ModalContext'
import { usePhase1 } from '../context/Phase1Context'
import { listInboxMessages, getMessageFull } from '../features/google/gmailApi'
import { isSignedIn } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { formatDate, parseFrom } from '../lib/format'
import { notify } from '../lib/notify'

export default function Gmail() {
  const { state } = usePhase1()
  const { openModal } = useModal()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const inboxGoogle = useGoogleStore((s) => s.inboxPreview)
  const setInboxPreview = useGoogleStore((s) => s.setInboxPreview)

  const emails =
    inboxGoogle.length > 0 ? inboxGoogle : state.googleConnected ? [] : state.gmailPreview || []

  const filtered = emails.filter((e) => {
    if (!q.trim()) return true
    const s = q.toLowerCase()
    return (
      (e.subject || '').toLowerCase().includes(s) ||
      (e.snippet || '').toLowerCase().includes(s) ||
      (e.from || '').toLowerCase().includes(s)
    )
  })

  const colors = ['#4fffb0', '#7c6fff', '#ff6b6b', '#ffd166', '#4fc3f7', '#f06292']

  const loadGmail = useCallback(async () => {
    if (!isSignedIn()) {
      notify('Conectá Google primero (Configuración)')
      return
    }
    setLoadingList(true)
    try {
      const list = await listInboxMessages(20, 10)
      setInboxPreview(list)
      if (!list.length) notify('Bandeja vacía')
      else notify('Correos actualizados')
    } catch (e) {
      notify(e.result?.error?.message || e.message || 'Error Gmail')
    } finally {
      setLoadingList(false)
    }
  }, [setInboxPreview])

  const openEmail = async (e) => {
    setSelected(e)
    setDetail(null)
    if (!isSignedIn()) return
    setLoadingDetail(true)
    try {
      const d = await getMessageFull(e.id)
      setDetail(d)
    } catch (err) {
      notify(err.result?.error?.message || err.message || 'No se pudo cargar el correo')
    } finally {
      setLoadingDetail(false)
    }
  }

  return (
    <div className="page active" id="page-gmail">
      <div className="section-header">
        <div>
          <h2>Gmail</h2>
          <p>Tus correos conectados</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={loadingList} onClick={loadGmail}>
            {loadingList ? '⏳…' : '🔄 Actualizar'}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => openModal('modal-email')}>
            ✉️ Redactar
          </button>
        </div>
      </div>
      <div className="info-box">
        <strong>📌 Para conectar Gmail:</strong> Ve a <strong>Configuración</strong>, guardá API Key y Client ID, y pulsá <strong>Conectar Google</strong>.
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <span className="dot" />
            Bandeja de entrada
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input type="text" id="gmail-search" placeholder="Buscar en correos..." style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div id="gmail-list">
            {filtered.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '20px 0', textAlign: 'center' }}>
                {state.googleConnected ? 'Pulsá Actualizar para cargar INBOX' : 'Conecta Gmail para ver tus correos'}
              </div>
            ) : (
              filtered.map((e, i) => (
                <div
                  key={e.id}
                  className={`gmail-item ${e.unread ? 'unread' : ''}`}
                  onClick={() => openEmail(e)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => ev.key === 'Enter' && openEmail(e)}
                >
                  <div className="gmail-avatar" style={{ background: `${colors[i % colors.length]}22`, color: colors[i % colors.length] }}>
                    {parseFrom(e.from || '').charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', fontWeight: e.unread ? 600 : 400, color: e.unread ? 'var(--text)' : 'var(--text-muted)' }}>{parseFrom(e.from || '')}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{formatDate(e.date)}</span>
                    </div>
                    <div className="gmail-subject">{e.subject || '(Sin asunto)'}</div>
                    <div className="gmail-preview">{e.snippet}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent2)' }} />
            Vista previa
          </div>
          <div id="email-detail" style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '20px 0', textAlign: 'center' }}>
            {!selected ? (
              'Selecciona un correo para leerlo'
            ) : loadingDetail ? (
              'Cargando…'
            ) : detail ? (
              <div style={{ textAlign: 'left' }}>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '18px', marginBottom: '8px', color: 'var(--text)' }}>{detail.subject}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>De: {detail.from}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Fecha: {detail.date}</div>
                </div>
                <div style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: '16px', whiteSpace: 'pre-wrap', maxHeight: 420, overflowY: 'auto' }}>{detail.body}</div>
              </div>
            ) : (
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '18px', marginBottom: '8px', color: 'var(--text)' }}>{selected.subject || '(Sin asunto)'}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>De: {selected.from}</div>
                <div style={{ fontSize: '14px', marginTop: 12, color: 'var(--text-dim)' }}>{selected.snippet}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
