import { useQuery } from '@tanstack/react-query'
import { api, getList } from '../lib/api'
import { QK } from '../lib/queryKeys'

export function useMe() {
  return useQuery({ queryKey: QK.me, queryFn: () => api.get('auth/me/').then((r) => r.data), staleTime: 60_000 })
}

export function useEsAdmin() {
  const { data } = useMe()
  return Boolean(data?.es_admin)
}

export function useCategorias() {
  return useQuery({ queryKey: QK.categorias, queryFn: () => getList('categorias/'), staleTime: 5 * 60_000 })
}

export function useClientes(opts = {}) {
  return useQuery({ queryKey: QK.clientes, queryFn: () => getList('clientes/'), staleTime: 30_000, ...opts })
}

export function usePersonas(opts = {}) {
  return useQuery({ queryKey: QK.personal, queryFn: () => getList('personal/'), staleTime: 30_000, ...opts })
}
