import { signOutGoogle } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { useAuthStore } from '../store/authStore'
import { logoutServidor } from './api'

/** Cierra la sesión por completo: invalida el refresh en el servidor, corta Google y vacía la caché. */
export async function cerrarSesion(queryClient) {
  await logoutServidor()
  signOutGoogle()
  useGoogleStore.getState().reset()
  queryClient.clear()
  try {
    sessionStorage.removeItem('aura_post_login_google')
  } catch {
    /* ignore */
  }
  useAuthStore.getState().clearAuth()
}
