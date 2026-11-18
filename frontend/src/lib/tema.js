import { useState } from 'react'

const CLAVE = 'aura-tema'
const COLOR_BARRA = { dark: '#0b0b0c', light: '#fafaf9' }

/** Tema guardado en este navegador; por defecto, oscuro. */
export function temaGuardado() {
  try {
    return localStorage.getItem(CLAVE) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function aplicarTema(tema) {
  const raiz = document.documentElement
  if (tema === 'light') raiz.dataset.theme = 'light'
  else delete raiz.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_BARRA[tema] ?? COLOR_BARRA.dark)
}

export function useTema() {
  const [tema, setTema] = useState(temaGuardado)
  const alternar = () => {
    const nuevo = tema === 'light' ? 'dark' : 'light'
    aplicarTema(nuevo)
    try {
      localStorage.setItem(CLAVE, nuevo)
    } catch {
      // Sin almacenamiento (modo privado): el cambio dura hasta recargar.
    }
    setTema(nuevo)
  }
  return [tema, alternar]
}
