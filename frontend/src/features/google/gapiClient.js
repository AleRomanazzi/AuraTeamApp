/**
 * Gmail/Calendar vía gapi.client. La cuenta de Google de la agencia queda conectada en el servidor
 * (refresh token), que entrega access tokens de corta duración: acá solo se piden y se renuevan.
 */

import { api } from '../../lib/api'
import { useGoogleStore } from './googleStore'

const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
]

const MARGEN_RENOVACION_MS = 5 * 60 * 1000

let discoveryInited = false
let renovacion = null
let enCurso = null

function loadGapiClientModule() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sin window'))
      return
    }
    const onClientReady = () => {
      try {
        window.gapi.load('client', () => resolve(window.gapi))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    if (window.gapi?.load) {
      onClientReady()
      return
    }
    const existing = document.querySelector('script[data-aura-gapi="1"]')
    if (existing) {
      existing.addEventListener('load', onClientReady)
      existing.addEventListener('error', () => reject(new Error('Error cargando gapi')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://apis.google.com/js/api.js'
    script.async = true
    script.dataset.auraGapi = '1'
    script.onload = onClientReady
    script.onerror = () => reject(new Error('No se pudo cargar Google API'))
    document.head.appendChild(script)
  })
}

function programarRenovacion(expiresIn) {
  clearTimeout(renovacion)
  const ms = Math.max(expiresIn * 1000 - MARGEN_RENOVACION_MS, 30 * 1000)
  renovacion = setTimeout(() => {
    conectarGoogle().catch(() => signOutGoogle())
  }, ms)
}

async function _conectar() {
  await loadGapiClientModule()
  if (!discoveryInited) {
    await window.gapi.client.init({ discoveryDocs: DISCOVERY_DOCS })
    discoveryInited = true
  }
  const { data } = await api.get('auth/google/token/')
  window.gapi.client.setToken({ access_token: data.access_token })
  programarRenovacion(data.expires_in)
  useGoogleStore.getState().touchGoogleSession()
}

/** Pide al servidor un access token de la cuenta de la agencia y lo deja cargado en gapi. */
export function conectarGoogle() {
  if (!enCurso) {
    enCurso = _conectar().finally(() => {
      enCurso = null
    })
  }
  return enCurso
}

export function isSignedIn() {
  try {
    return Boolean(window.gapi?.client?.getToken?.()?.access_token)
  } catch {
    return false
  }
}

/** Solo limpia el token de este navegador: la conexión de la agencia sigue viva en el servidor. */
export function signOutGoogle() {
  clearTimeout(renovacion)
  renovacion = null
  try {
    window.gapi?.client?.setToken?.(null)
  } catch {
    /* ignore */
  }
  useGoogleStore.getState().touchGoogleSession()
}
