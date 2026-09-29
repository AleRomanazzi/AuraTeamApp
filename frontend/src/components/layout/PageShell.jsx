import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { initGapiClientAndSignIn } from '../../features/google/gapiClient'
import { useMe } from '../../hooks/useData'
import { api } from '../../lib/api'
import { QK } from '../../lib/queryKeys'
import { notify } from '../../lib/notify'
import ConfirmDialog from '../ui/ConfirmDialog'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

/** Conecta Google al entrar (si el usuario lo había conectado antes) sin pasar por Configuración. */
function useGoogleAutoConnect(me) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!me) return undefined
    const clientId = (me.google_client_id || '').trim()
    const recienLogueado = sessionStorage.getItem('aura_post_login_google') === '1'
    if (recienLogueado) sessionStorage.removeItem('aura_post_login_google')
    if (!clientId || (!me.google_connected && !recienLogueado)) return undefined
    let cancelado = false
    const hint = (me.google_login_hint || '').trim() || undefined
    ;(async () => {
      try {
        await initGapiClientAndSignIn(
          { apiKey: (me.google_api_key || '').trim(), clientId },
          { prompt: me.google_connected ? '' : 'select_account', hint },
        )
        if (cancelado) return
        if (!me.google_connected) {
          await api.put('me/config/', { google_connected: true })
          await qc.invalidateQueries({ queryKey: QK.me })
          notify('Cuenta de Google conectada')
        }
        await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'google-calendar' })
      } catch {
        /* Sin sesión de Google en el navegador: se puede conectar desde Configuración. */
      }
    })()
    return () => {
      cancelado = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo interesa reintentar cuando cambian los datos de Google
  }, [me?.id, me?.google_connected, me?.google_client_id])
}

export default function PageShell() {
  const meQ = useMe()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  useGoogleAutoConnect(meQ.data)

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    <>
      <div id="sidebar-overlay" className={sidebarOpen ? 'open' : ''} onClick={closeSidebar} role="presentation" aria-hidden="true" />
      <Sidebar sidebarOpen={sidebarOpen} onClose={closeSidebar} />
      <div id="main">
        <Topbar onToggleSidebar={toggleSidebar} />
        <main className="page active">
          {meQ.isPending ? (
            <div className="state-box">Cargando…</div>
          ) : meQ.isError ? (
            <div className="state-box state-box--error">
              No se pudo cargar tu sesión.
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => meQ.refetch()}>
                Reintentar
              </button>
            </div>
          ) : (
            <Suspense fallback={<div className="state-box">Cargando…</div>}>
              <Outlet />
            </Suspense>
          )}
        </main>
      </div>
      <ConfirmDialog />
    </>
  )
}
