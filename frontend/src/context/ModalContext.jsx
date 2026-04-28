/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const ModalContext = createContext(null)

export function ModalProvider({ children }) {
  const [openModals, setOpenModals] = useState({})
  const [eventoTipo, setEventoTipo] = useState('unico')
  const [eventoPreset, setEventoPreset] = useState(null)

  const openModal = useCallback((id) => {
    setOpenModals((o) => ({ ...o, [id]: true }))
  }, [])

  const openModalEvento = useCallback((tipo, preset = null) => {
    setEventoTipo(tipo === 'cliente' ? 'cliente' : 'unico')
    setEventoPreset(preset && typeof preset === 'object' ? preset : null)
    setOpenModals((o) => ({ ...o, 'modal-evento': true }))
  }, [])

  const closeModal = useCallback((id) => {
    setOpenModals((o) => ({ ...o, [id]: false }))
    if (id === 'modal-evento') setEventoPreset(null)
  }, [])

  const value = useMemo(
    () => ({ openModals, openModal, openModalEvento, closeModal, eventoTipo, eventoPreset }),
    [openModals, openModal, openModalEvento, closeModal, eventoTipo, eventoPreset],
  )
  return <ModalContext.Provider value={value}>{children}</ModalContext.Provider>
}

export function useModal() {
  const ctx = useContext(ModalContext)
  if (!ctx) throw new Error('useModal debe usarse dentro de ModalProvider')
  return ctx
}
