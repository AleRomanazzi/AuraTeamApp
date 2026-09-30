import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { invalidar } from '../../lib/queryKeys'

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
    // El servidor sube las tareas de a tandas: mientras queden, se vuelve a pedir pasado el límite de una por minuto.
    refetchInterval: (query) => (query.state.data?.pendientes ? 65_000 : false),
    retry: false,
  })
}
