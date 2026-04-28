/** Origen del backend para prefijar URLs `/media/...` devueltas por la API. */
export function getMediaOrigin() {
  const api = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api'
  return api.replace(/\/?api\/?$/i, '') || 'http://127.0.0.1:8000'
}
