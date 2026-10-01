import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { invalidar } from '../../lib/queryKeys'

/** Mientras queden envíos (o el servidor la haya salteado por el límite de una por minuto), se vuelve a pedir. */
export const seguirSincronizando = (query) => {
  const d = query.state.data
  return d?.pendientes || (d?.omitida && !d.detail) ? 65_000 : false
}

/** Trae lo cargado directo en Google Calendar al abrir la pantalla (el servidor lo limita a una vez por minuto). */
export function useSyncCalendario() {
  const qc = useQueryClient()
  useQuery({
    queryKey: ['cal-google', 'incremental'],
    queryFn: async () => {
      const { data } = await api.post('calendario/google/sincronizar/')
      if (data.creados || data.actualizados || data.borrados) invalidar(qc, ['cal-eventos', 'mi-panel'])
      return data
    },
    staleTime: 60_000,
    refetchInterval: seguirSincronizando,
    retry: false,
  })
}
