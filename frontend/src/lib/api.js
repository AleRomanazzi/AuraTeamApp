import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const baseURL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '')

export const api = axios.create({ baseURL, timeout: 60_000 })

let refreshPromise = null

async function refreshAccessToken() {
  const { refresh, clearAuth, setTokens } = useAuthStore.getState()
  if (!refresh) {
    clearAuth()
    throw new Error('Sin refresh token')
  }
  const { data } = await axios.post(`${baseURL}/auth/refresh/`, { refresh })
  // El backend rota el refresh token: el viejo queda invalidado.
  setTokens(data.access, data.refresh || refresh)
  return data.access
}

api.interceptors.request.use((config) => {
  const { access } = useAuthStore.getState()
  if (access) config.headers.Authorization = `Bearer ${access}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (!original || original._authRetry || error.response?.status !== 401) return Promise.reject(error)
    if (original.url?.includes('auth/refresh/') || original.url?.includes('auth/login/')) {
      if (original.url?.includes('auth/refresh/')) useAuthStore.getState().clearAuth()
      return Promise.reject(error)
    }
    original._authRetry = true
    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null
        })
      }
      await refreshPromise
      original.headers.Authorization = `Bearer ${useAuthStore.getState().access}`
      return api(original)
    } catch {
      useAuthStore.getState().clearAuth()
      return Promise.reject(error)
    }
  },
)

/** Lista sin paginar (el backend pagina solo si se pasa ?page). */
export const getList = (url, params) => api.get(url, { params }).then((r) => r.data)

export async function logoutServidor() {
  const { refresh } = useAuthStore.getState()
  if (!refresh) return
  try {
    await api.post('auth/logout/', { refresh })
  } catch {
    /* el token puede estar vencido: igual se cierra la sesión local */
  }
}

/** Descarga un archivo protegido (CSV, adjunto) usando el token de la sesión. */
export async function descargarArchivo(url, nombre, params) {
  const r = await api.get(url, { params, responseType: 'blob' })
  const dispo = r.headers['content-disposition'] || ''
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(dispo)
  const filename = nombre || (m ? decodeURIComponent(m[1]) : 'archivo')
  const href = URL.createObjectURL(r.data)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/** Abre un archivo protegido en una pestaña nueva (PDF/imagen). */
export async function abrirArchivo(url) {
  const ventana = window.open('', '_blank')
  const r = await api.get(url, { responseType: 'blob', params: { inline: 1 } })
  const href = URL.createObjectURL(r.data)
  if (ventana) ventana.location.href = href
  else window.location.assign(href)
  setTimeout(() => URL.revokeObjectURL(href), 60_000)
}
