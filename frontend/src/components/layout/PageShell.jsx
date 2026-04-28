import { useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { usePhase1 } from '../../context/Phase1Context'
import { initGapiClientAndSignIn } from '../../features/google/gapiClient'
import { api } from '../../lib/api'
import { QK } from '../../lib/queryKeys'
import { notify } from '../../lib/notify'
import AppModals from '../modals/AppModals'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

export default function PageShell() {
  const { isBootstrapping, state } = usePhase1()
  const qc = useQueryClient()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (isBootstrapping || typeof window === 'undefined') return
    if (sessionStorage.getItem('aura_post_login_google') !== '1') return
    sessionStorage.removeItem('aura_post_login_google')

    const cid = state.config.clientId?.trim()
    if (!cid) {
      notify('Google OAuth: falta Client ID en el servidor (variable AURA_GOOGLE_CLIENT_ID).')
      return
    }

    const hint = state.config.googleLoginHint?.trim()
    ;(async () => {
      try {
        await initGapiClientAndSignIn(
          { apiKey: state.config.apiKey?.trim() || '', clientId: cid },
          { prompt: 'select_account', hint: hint || undefined },
        )
        await api.put('me/config/', { google_connected: true })
        await qc.invalidateQueries({ queryKey: QK.me })
        await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'google-calendar' })
        notify('Cuenta Google conectada')
      } catch (e) {
        notify(e?.message || 'No se pudo conectar Google. Podés reintentar desde Configuración.')
      }
    })()
  }, [isBootstrapping, state.config.clientId, state.config.apiKey, state.config.googleLoginHint, qc])

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    <>
      <div
        id="sidebar-overlay"
        className={sidebarOpen ? 'open' : ''}
        onClick={closeSidebar}
        onKeyDown={(e) => e.key === 'Escape' && closeSidebar()}
        role="presentation"
        aria-hidden="true"
      />
      <Sidebar sidebarOpen={sidebarOpen} onClose={closeSidebar} />
      <div id="main" style={{ position: 'relative' }}>
        {isBootstrapping ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 50,
              background: 'rgba(12,15,20,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text)',
              fontSize: 15,
            }}
          >
            Cargando datos…
          </div>
        ) : null}
        <Topbar onToggleSidebar={toggleSidebar} />
        <Outlet context={{ closeSidebar }} />
      </div>
      <AppModals />
    </>
  )
}
