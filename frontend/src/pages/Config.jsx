import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { usePhase1 } from '../context/Phase1Context'
import { initGapiClientAndSignIn, signOutGoogle } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { api } from '../lib/api'
import { QK } from '../lib/queryKeys'
import { notify } from '../lib/notify'

export default function Config() {
  const { state, refetchAll } = usePhase1()
  const qc = useQueryClient()
  const c = state.config
  const importRef = useRef(null)

  const [apiKey, setApiKey] = useState(c.apiKey)
  const [clientId, setClientId] = useState(c.clientId)
  const [gmail, setGmail] = useState(c.gmail)
  const [moneda, setMoneda] = useState(c.moneda)
  const [nombre, setNombre] = useState(c.nombre)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    // Sincronizar formulario cuando el servidor devuelve nuevos valores tras guardar / importar.
    queueMicrotask(() => {
      setApiKey(c.apiKey)
      setClientId(c.clientId)
      setGmail(c.gmail)
      setMoneda(c.moneda)
      setNombre(c.nombre)
    })
  }, [c.apiKey, c.clientId, c.gmail, c.moneda, c.nombre, c.googleOauthManaged, c.googleLoginHint])

  const saveCfg = useMutation({
    mutationFn: () => {
      const body = {
        moneda,
        nombre_display: nombre,
        gmail_account: gmail,
      }
      if (!c.googleOauthManaged) {
        body.google_api_key = apiKey
        body.google_client_id = clientId
      }
      return api.put('me/config/', body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.me })
      notify('Configuración guardada')
    },
    onError: () => notify('No se pudo guardar'),
  })

  const exportJson = useMutation({
    mutationFn: () => api.get('me/export/').then((r) => r.data),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'aurateam-export.json'
      a.click()
      URL.revokeObjectURL(url)
      notify('Exportación lista')
    },
    onError: () => notify('Error al exportar'),
  })

  const importJson = useMutation({
    mutationFn: (file) => {
      const reader = new FileReader()
      return new Promise((resolve, reject) => {
        reader.onload = () => {
          try {
            resolve(JSON.parse(reader.result))
          } catch {
            reject(new Error('JSON inválido'))
          }
        }
        reader.onerror = reject
        reader.readAsText(file)
      }).then((body) => api.post('me/import/', body))
    },
    onSuccess: () => {
      refetchAll()
      qc.invalidateQueries({ queryKey: QK.me })
      notify('Datos importados')
    },
    onError: () => notify('No se pudo importar'),
  })

  const connectGoogle = async () => {
    if (!clientId.trim()) {
      notify(c.googleOauthManaged ? 'Falta Client ID en el servidor (AURA_GOOGLE_CLIENT_ID)' : 'Ingresá el Client ID (OAuth) primero')
      return
    }
    setConnecting(true)
    try {
      const hint = c.googleLoginHint?.trim()
      await initGapiClientAndSignIn(
        { apiKey: apiKey.trim(), clientId: clientId.trim() },
        hint ? { prompt: '', hint } : { prompt: '' },
      )
      const body = {
        moneda,
        nombre_display: nombre,
        gmail_account: gmail,
        google_connected: true,
      }
      if (!c.googleOauthManaged) {
        body.google_api_key = apiKey
        body.google_client_id = clientId
      }
      await api.put('me/config/', body)
      await qc.invalidateQueries({ queryKey: QK.me })
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'google-calendar' })
      notify('Google conectado')
    } catch (e) {
      const msg =
        e?.error ||
        e?.details ||
        e?.message ||
        (e?.result?.error?.message ? e.result.error.message : null) ||
        'No se pudo conectar (revisá consola de Google y orígenes OAuth)'
      notify(String(msg))
    } finally {
      setConnecting(false)
    }
  }

  const disconnectGoogle = async () => {
    try {
      signOutGoogle()
      useGoogleStore.getState().reset()
      qc.removeQueries({ predicate: (q) => q.queryKey[0] === 'google-calendar' })
      await api.put('me/config/', { google_connected: false })
      await qc.invalidateQueries({ queryKey: QK.me })
      notify('Sesión Google cerrada en este navegador')
    } catch {
      notify('No se pudo actualizar el servidor')
    }
  }

  const clearData = useMutation({
    mutationFn: () => api.delete('me/data/'),
    onSuccess: () => {
      refetchAll()
      qc.invalidateQueries({ queryKey: QK.me })
      notify('Datos borrados')
    },
    onError: () => notify('Error al borrar'),
  })

  return (
    <div className="page active" id="page-config">
      <div className="section-header">
        <div>
          <h2>Configuración</h2>
          <p>Conecta tus cuentas de Google</p>
        </div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <span className="dot" />
            Google API
          </div>
          <div className="config-section">
            <h3>Credenciales</h3>
            {c.googleOauthManaged ? (
              <div className="info-box">
                <strong>Credenciales Google fijas</strong> (variables <code>AURA_GOOGLE_CLIENT_ID</code> / <code>AURA_GOOGLE_API_KEY</code> en el servidor). No se pueden editar desde la app.
                {c.googleLoginHint ? (
                  <>
                    {' '}
                    Cuenta sugerida al conectar: <strong>{c.googleLoginHint}</strong> (<code>AURA_GOOGLE_LOGIN_HINT</code>).
                  </>
                ) : null}
              </div>
            ) : (
              <>
                <div className="info-box">
                  Client ID OAuth (aplicación web) en <strong>console.cloud.google.com</strong>. Gmail API y Calendar API habilitadas. La conexión usa{' '}
                  <strong>Google Identity Services</strong> (sin el flujo antiguo gapi.auth2). La API Key es opcional.
                </div>
                <div className="form-row">
                  <label>Google API Key (opcional)</label>
                  <input type="password" id="cfg-api-key" placeholder="AIza… (opcional)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Client ID (OAuth 2.0)</label>
                  <input type="text" id="cfg-client-id" placeholder="xxxx.apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                </div>
              </>
            )}
            <div className="form-row">
              <label>Tu dirección de Gmail</label>
              <input type="email" id="cfg-gmail" placeholder="tunombre@gmail.com" value={gmail} onChange={(e) => setGmail(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary" disabled={connecting} onClick={connectGoogle}>
                {connecting ? '⏳ Conectando…' : '🔌 Conectar Google'}
              </button>
              {state.googleConnected ? (
                <button type="button" className="btn btn-secondary" onClick={disconnectGoogle}>
                  Cerrar sesión Google
                </button>
              ) : null}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 10 }}>
              OAuth server-side: <code style={{ fontSize: 11 }}>POST /api/integraciones/google/exchange/</code> (pendiente).
            </p>
            <div className="api-status" id="google-api-status">
              <span className={`status-dot ${state.googleConnected ? 'connected' : 'disconnected'}`} />
              <span>{state.googleConnected ? 'Credenciales guardadas y sesión activa en este navegador' : 'No conectado'}</span>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">
            <span className="dot" style={{ background: 'var(--accent2)' }} />
            Preferencias
          </div>
          <div className="config-section">
            <h3>Moneda y formato</h3>
            <div className="form-row">
              <label>Moneda</label>
              <select id="cfg-moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
                <option value="$">Peso (ARS $)</option>
                <option value="USD">Dólar (USD $)</option>
                <option value="€">Euro (€)</option>
                <option value="CLP">Peso chileno (CLP)</option>
              </select>
            </div>
            <div className="form-row">
              <label>Tu nombre (para la división)</label>
              <input type="text" id="cfg-nombre" placeholder="Mi nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
          </div>
          <div className="config-section">
            <h3>Datos</h3>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" disabled={exportJson.isPending} onClick={() => exportJson.mutate()}>
                📤 Exportar datos
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => importRef.current?.click()}>
                📥 Importar datos
              </button>
              <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && importJson.mutate(e.target.files[0])} />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={clearData.isPending}
                onClick={() => {
                  if (window.confirm('¿Borrar todos los datos del usuario? Esta acción no se puede deshacer.')) clearData.mutate()
                }}
              >
                🗑 Limpiar todo
              </button>
            </div>
          </div>
          <button type="button" className="btn btn-primary" disabled={saveCfg.isPending} onClick={() => saveCfg.mutate()}>
            💾 Guardar configuración
          </button>
        </div>
      </div>
    </div>
  )
}
