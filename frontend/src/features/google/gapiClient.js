/**
 * Gmail/Calendar vía gapi.client + OAuth (Google Identity Services).
 * Evita gapi.auth2 (deprecado), que dispara errores en migration_mod.
 */

import { useGoogleStore } from './googleStore'

const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
]

const SCOPES =
  'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar'

let discoveryInited = false

function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Sin window'))
      return
    }
    if (window.google?.accounts?.oauth2?.initTokenClient) {
      resolve()
      return
    }
    const existing = document.querySelector('script[data-aura-gis="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Error cargando Google Identity Services')))
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.auraGis = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('No se pudo cargar accounts.google.com/gsi/client'))
    document.head.appendChild(script)
  })
}

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

/**
 * @param {string} clientId
 * @param {{ prompt?: string, hint?: string }} [opts]
 */
function requestAccessToken(clientId, opts = {}) {
  const { prompt = '', hint } = opts
  return new Promise((resolve, reject) => {
    const initCfg = {
      client_id: clientId,
      scope: SCOPES,
      callback: (resp) => {
        if (resp.error) {
          reject(new Error(resp.error_description || resp.error || 'OAuth cancelado'))
          return
        }
        if (!resp.access_token) {
          reject(new Error('No se recibió access_token'))
          return
        }
        resolve(resp.access_token)
      },
    }
    if (hint?.trim()) {
      initCfg.hint = hint.trim()
    }
    const tc = window.google.accounts.oauth2.initTokenClient(initCfg)
    tc.requestAccessToken({ prompt: prompt === undefined ? '' : prompt })
  })
}

/**
 * @param {{ apiKey?: string, clientId: string }} creds
 * @param {{ prompt?: string, hint?: string }} [tokenOpts] prompt: '' silencioso; 'select_account' abre selector de cuenta
 * @returns {Promise<void>}
 */
export async function initGapiClientAndSignIn(creds, tokenOpts = {}) {
  const { apiKey, clientId } = creds
  if (!clientId?.trim()) {
    throw new Error('Falta Client ID')
  }
  await loadGisScript()
  await loadGapiClientModule()
  if (!discoveryInited) {
    const initOpts = { discoveryDocs: DISCOVERY_DOCS }
    if (apiKey?.trim()) initOpts.apiKey = apiKey.trim()
    await window.gapi.client.init(initOpts)
    discoveryInited = true
  }
  const accessToken = await requestAccessToken(clientId.trim(), tokenOpts)
  window.gapi.client.setToken({ access_token: accessToken })
  useGoogleStore.getState().touchGoogleSession()
}

export function isSignedIn() {
  try {
    return Boolean(window.gapi?.client?.getToken?.()?.access_token)
  } catch {
    return false
  }
}

export function signOutGoogle() {
  try {
    const tok = window.gapi?.client?.getToken?.()
    if (tok?.access_token && typeof window.google?.accounts?.oauth2?.revoke === 'function') {
      window.google.accounts.oauth2.revoke(tok.access_token, () => {})
    }
    window.gapi?.client?.setToken?.('')
    useGoogleStore.getState().touchGoogleSession()
  } catch {
    /* ignore */
  }
}
