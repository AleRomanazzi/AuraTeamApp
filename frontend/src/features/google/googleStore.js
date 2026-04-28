import { create } from 'zustand'

/** Estado de UI cargada desde Google (Gmail / Calendar); no persiste en localStorage. */
export const useGoogleStore = create((set) => ({
  inboxPreview: [],
  gapiReady: false,
  /** Se incrementa al obtener o limpiar token OAuth para forzar re-render (isSignedIn() no es reactivo). */
  tokenVersion: 0,
  setGapiReady: (v) => set({ gapiReady: Boolean(v) }),
  setInboxPreview: (emails) => set({ inboxPreview: Array.isArray(emails) ? emails : [] }),
  touchGoogleSession: () => set((s) => ({ tokenVersion: s.tokenVersion + 1 })),
  reset: () => set({ inboxPreview: [], gapiReady: false, tokenVersion: 0 }),
}))
