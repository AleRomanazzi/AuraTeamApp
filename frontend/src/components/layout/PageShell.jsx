import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { conectarGoogle } from '../../features/google/gapiClient'
import { useMe } from '../../hooks/useData'
import { QK } from '../../lib/queryKeys'
import ConfirmDialog from '../ui/ConfirmDialog'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

/** Carga el token de la cuenta de Google de la agencia (conectada en el servidor) sin intervención del usuario. */
function useGoogleAutoConnect(me) {
  const qc = useQueryClient()
  const activo = Boolean(me?.es_admin && me?.google_conectado)
  useEffect(() => {
    if (!activo) return undefined
    let cancelado = false
    conectarGoogle()
      .then(() => {
        if (!cancelado) qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'google-calendar' })
      })
      .catch((e) => {
        if (e?.response?.status === 409) qc.invalidateQueries({ queryKey: QK.me })
      })
    return () => {
      cancelado = true
    }
  }, [activo, qc])
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
