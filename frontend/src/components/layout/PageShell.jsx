import { Suspense, useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { conectarGoogle } from '../../features/google/gapiClient'
import { useMe } from '../../hooks/useData'
import { QK } from '../../lib/queryKeys'
import ConfirmDialog from '../ui/ConfirmDialog'
import BuscadorGlobal from './BuscadorGlobal'
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
  const [buscando, setBuscando] = useState(false)
  useGoogleAutoConnect(meQ.data)

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscando((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  useEffect(() => {
    if (!sidebarOpen) return undefined
    const onKey = (e) => e.key === 'Escape' && setSidebarOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  return (
    <>
      <div id="sidebar-overlay" className={sidebarOpen ? 'open' : ''} onClick={closeSidebar} role="presentation" aria-hidden="true" />
      <Sidebar sidebarOpen={sidebarOpen} onClose={closeSidebar} />
      <div id="main">
        <Topbar onToggleSidebar={toggleSidebar} onBuscar={() => setBuscando(true)} />
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
      {buscando && meQ.data ? <BuscadorGlobal abierto onCerrar={() => setBuscando(false)} /> : null}
      <ConfirmDialog />
    </>
  )
}
