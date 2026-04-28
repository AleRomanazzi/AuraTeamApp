/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { initGapiClientAndSignIn } from '../features/google/gapiClient'
import { api } from '../lib/api'
import {
  calClienteFromApi,
  calEventoFromApi,
  mapTxFromApi,
  meToConfig,
  personaFromApi,
  servicioFromApi,
  tareaFromApi,
} from '../lib/mappers'
import { QK } from '../lib/queryKeys'

const Phase1Context = createContext(null)

function usePersonalWithTareas() {
  const personalQ = useQuery({
    queryKey: QK.personal,
    queryFn: () => api.get('personal/').then((r) => r.data),
  })

  const assignedQueries = useQueries({
    queries: (personalQ.data ?? []).map((p) => ({
      queryKey: QK.personalTareas(p.id),
      queryFn: () => api.get(`personal/${p.id}/tareas/`).then((r) => r.data),
      enabled: Boolean(personalQ.data?.length),
    })),
  })

  const personal = useMemo(() => {
    const raw = personalQ.data ?? []
    return raw.map((p, idx) => {
      const assigned = assignedQueries[idx]?.data ?? []
      return { ...personaFromApi(p), tareas: assigned.map((t) => t.id) }
    })
  }, [personalQ.data, assignedQueries])

  const isLoading =
    personalQ.isPending ||
    (personalQ.data?.length > 0 && assignedQueries.some((q) => q.isPending))

  return { personal, isLoading }
}

export function Phase1Provider({ children }) {
  const qc = useQueryClient()

  const meQ = useQuery({
    queryKey: QK.me,
    queryFn: () => api.get('auth/me/').then((r) => r.data),
  })

  const transaccionesQ = useQuery({
    queryKey: QK.transacciones,
    queryFn: () => api.get('transacciones/').then((r) => r.data),
  })

  const serviciosQ = useQuery({
    queryKey: QK.servicios,
    queryFn: () => api.get('servicios/').then((r) => r.data),
  })

  const tareasQ = useQuery({
    queryKey: QK.tareas,
    queryFn: () => api.get('tareas/').then((r) => r.data),
  })

  const { personal, isLoading: personalLoading } = usePersonalWithTareas()

  const calClientesQ = useQuery({
    queryKey: QK.calClientes,
    queryFn: () => api.get('cal-clientes/').then((r) => r.data),
  })

  const calEventosQ = useQuery({
    queryKey: QK.calEventos,
    queryFn: () => api.get('cal-eventos/').then((r) => r.data),
  })

  const state = useMemo(() => {
    const me = meQ.data
    const txs = [...(transaccionesQ.data ?? []).map(mapTxFromApi)].sort((a, b) =>
      a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : Number(b.id) - Number(a.id),
    )

    return {
      transacciones: txs,
      servicios: (serviciosQ.data ?? []).map(servicioFromApi),
      emails: [],
      events: [],
      personal,
      tareas: (tareasQ.data ?? []).map(tareaFromApi),
      calClientes: (calClientesQ.data ?? []).map(calClienteFromApi),
      calEventos: (calEventosQ.data ?? []).map(calEventoFromApi),
      config: meToConfig(me),
      googleConnected: Boolean(me?.google_connected),
      gmailPreview: [],
    }
  }, [
    meQ.data,
    transaccionesQ.data,
    serviciosQ.data,
    tareasQ.data,
    personal,
    calClientesQ.data,
    calEventosQ.data,
  ])

  const isBootstrapping =
    meQ.isPending ||
    transaccionesQ.isPending ||
    serviciosQ.isPending ||
    tareasQ.isPending ||
    personalLoading ||
    calClientesQ.isPending ||
    calEventosQ.isPending

  /** Si el servidor indica Google conectado, intentamos renovar el token en el navegador (sin pasar por Config). */
  useEffect(() => {
    if (!meQ.isSuccess || typeof window === 'undefined') return
    const me = meQ.data
    if (!me?.google_connected || !me.google_client_id?.trim()) return
    let cancelled = false
    ;(async () => {
      try {
        const hint = (me.google_login_hint || '').trim()
        await initGapiClientAndSignIn(
          {
            apiKey: (me.google_api_key || '').trim(),
            clientId: me.google_client_id.trim(),
          },
          hint ? { prompt: '', hint } : { prompt: '' },
        )
        if (!cancelled) {
          await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'google-calendar' })
        }
      } catch {
        /* Sin cookie de Google o consentimiento: el usuario usa “Conectar Google” en Configuración */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo campos Google de me, no todo meQ.data
  }, [
    meQ.isSuccess,
    meQ.data?.google_connected,
    meQ.data?.google_client_id,
    meQ.data?.google_api_key,
    meQ.data?.google_login_hint,
    qc,
  ])

  const refetchAll = useCallback(
    () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: QK.me }),
        qc.invalidateQueries({ queryKey: QK.transacciones }),
        qc.invalidateQueries({ queryKey: QK.servicios }),
        qc.invalidateQueries({ queryKey: QK.tareas }),
        qc.invalidateQueries({ queryKey: QK.personal }),
        qc.invalidateQueries({ queryKey: QK.calClientes }),
        qc.invalidateQueries({ queryKey: QK.calEventos }),
        qc.invalidateQueries({ queryKey: QK.stats }),
        qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'google-calendar' }),
      ]),
    [qc],
  )

  const value = useMemo(
    () => ({
      state,
      isBootstrapping,
      refetchAll,
      queryClient: qc,
    }),
    [state, isBootstrapping, refetchAll, qc],
  )

  return <Phase1Context.Provider value={value}>{children}</Phase1Context.Provider>
}

export function usePhase1() {
  const ctx = useContext(Phase1Context)
  if (!ctx) throw new Error('usePhase1 debe usarse dentro de Phase1Provider')
  return ctx
}
