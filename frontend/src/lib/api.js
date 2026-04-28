import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const baseURL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '')

export const api = axios.create({ baseURL })

let refreshPromise = null

async function refreshAccessToken() {
  const { refresh, clearAuth, setTokens } = useAuthStore.getState()
  if (!refresh) {
    clearAuth()
    throw new Error('Sin refresh token')
  }
  const { data } = await axios.post(`${baseURL}/auth/refresh/`, { refresh })
  setTokens(data.access, refresh)
  return data.access
}

api.interceptors.request.use((config) => {
  const { access } = useAuthStore.getState()
  if (access) {
    config.headers.Authorization = `Bearer ${access}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const original = error.config
    if (!original || original._authRetry) return Promise.reject(error)
    if (error.response?.status !== 401) return Promise.reject(error)
    if (original.url?.includes('/auth/refresh/') || original.url?.includes('/auth/login/')) {
      useAuthStore.getState().clearAuth()
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
      const { access } = useAuthStore.getState()
      original.headers.Authorization = `Bearer ${access}`
      return api(original)
    } catch {
      useAuthStore.getState().clearAuth()
      return Promise.reject(error)
    }
  },
)
