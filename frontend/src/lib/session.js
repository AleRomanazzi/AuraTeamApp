import { signOutGoogle } from '../features/google/gapiClient'
import { useGoogleStore } from '../features/google/googleStore'
import { useAuthStore } from '../store/authStore'
import { logoutServidor } from './api'

/** Cierra la sesión: invalida el refresh en el servidor, olvida el token de Google de este navegador y vacía la caché. */
export async function cerrarSesion(queryClient) {
  await logoutServidor()
  signOutGoogle()
  useGoogleStore.getState().reset()
  queryClient.clear()
  useAuthStore.getState().clearAuth()
}
