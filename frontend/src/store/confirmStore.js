import { create } from 'zustand'

export const useConfirmStore = create((set) => ({
  pedido: null,
  abrir: (pedido) => set({ pedido }),
  cerrar: () => set({ pedido: null }),
}))

/**
 * Diálogo de confirmación que devuelve una promesa.
 * @param {{ titulo?: string, mensaje: string, confirmar?: string, peligro?: boolean, escribir?: string }} opts
 * `escribir` obliga a tipear un texto exacto (p. ej. "BORRAR") antes de confirmar.
 */
export function confirmar(opts) {
  return new Promise((resolve) => {
    useConfirmStore.getState().abrir({ ...opts, resolve })
  })
}
