import { create } from 'zustand'

export const useModalStore = create((set) => ({
  editTransaccionId: null,
  adjuntoTransaccionId: null,
  editPersonaId: null,
  setEditTransaccionId: (id) => set({ editTransaccionId: id }),
  setAdjuntoTransaccionId: (id) => set({ adjuntoTransaccionId: id }),
  setEditPersonaId: (id) => set({ editPersonaId: id }),
  clearTransaccionModal: () => set({ editTransaccionId: null }),
  clearAdjuntoModal: () => set({ adjuntoTransaccionId: null }),
  clearPersonaModal: () => set({ editPersonaId: null }),
}))
