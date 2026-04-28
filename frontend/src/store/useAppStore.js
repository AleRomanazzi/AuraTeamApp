import { create } from 'zustand'

const useAppStore = create(() => ({
  transacciones: [],
  servicios: [],
  personal: [],
  tareas: [],
  calClientes: [],
  calEventos: [],
}))

export default useAppStore
