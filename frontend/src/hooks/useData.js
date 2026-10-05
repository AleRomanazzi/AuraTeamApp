import { useQuery } from '@tanstack/react-query'
import { api, getList } from '../lib/api'
import { ETIQUETAS } from '../lib/constants'
import { QK } from '../lib/queryKeys'

export function useMe() {
  return useQuery({ queryKey: QK.me, queryFn: () => api.get('auth/me/').then((r) => r.data), staleTime: 60_000 })
}

export function useEsAdmin() {
  const { data } = useMe()
  return Boolean(data?.es_admin)
}

export function puede(me, permiso) {
  return Boolean(me?.es_admin || me?.permisos?.includes(permiso))
}

export function usePuede(permiso) {
  const { data } = useMe()
  return puede(data, permiso)
}

/** Etiquetas de eventos y tareas (las base más los calendarios de Google de la agencia), como opciones de select. */
export function useEtiquetas() {
  const esAdmin = useEsAdmin()
  const { data } = useQuery({
    queryKey: QK.etiquetas,
    queryFn: () => api.get('calendario/etiquetas/').then((r) => r.data.map((e) => ({ value: e.valor, label: e.nombre, privada: e.privada }))),
    staleTime: 5 * 60_000,
  })
  return data ?? ETIQUETAS.filter((e) => esAdmin || !e.soloAdmin)
}

/** Opciones para un select de etiqueta: incluye la actual aunque ya no se ofrezca (oculta o privada). */
export function opcionesEtiqueta(etiquetas, actual) {
  return !actual || etiquetas.some((e) => e.value === actual) ? etiquetas : [...etiquetas, { value: actual, label: actual.charAt(0).toUpperCase() + actual.slice(1) }]
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
