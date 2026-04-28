import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useModal } from '../context/ModalContext'
import { usePhase1 } from '../context/Phase1Context'
import { api } from '../lib/api'
import { useModalStore } from '../store/modalStore'
import { notify } from '../lib/notify'

export default function Personal() {
  const { state } = usePhase1()
  const { openModal } = useModal()
  const qc = useQueryClient()
  const setEditPersonaId = useModalStore((s) => s.setEditPersonaId)
  const clearPersonaModal = useModalStore((s) => s.clearPersonaModal)

  const delPersona = useMutation({
    mutationFn: (id) => api.delete(`personal/${id}/`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['personal'] })
      notify('Persona eliminada')
    },
    onError: () => notify('No se pudo eliminar'),
  })

  const openNueva = () => {
    clearPersonaModal()
    openModal('modal-personal')
  }

  const openEdit = (id) => {
    setEditPersonaId(id)
    openModal('modal-personal')
  }

  return (
    <div className="page active" id="page-personal">
      <div className="section-header">
        <div>
          <h2>Equipo</h2>
          <p>Gestión de personal y contactos</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={openNueva}>
          + Agregar persona
        </button>
      </div>
      <div className="staff-grid" id="staff-grid">
        {state.personal.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: '13px', padding: '40px 0', textAlign: 'center' }}>
            No hay personas en el equipo. Agrega una con el botón +
          </div>
        ) : (
          state.personal.map((p) => {
            const tareasAsig = (p.tareas || []).map((tid) => state.tareas.find((t) => t.id === tid)).filter(Boolean)
            const contactBtns = []
            if (p.tel) {
              contactBtns.push(
                <a key="wa" className="contact-link" href={`https://wa.me/${p.tel.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
                  💬 WhatsApp
                </a>,
              )
            }
            if (p.email) {
              contactBtns.push(
                <a key="em" className="contact-link" href={`mailto:${p.email}`}>
                  ✉️ Email
                </a>,
              )
            }
            if (p.ig) {
              contactBtns.push(
                <a key="ig" className="contact-link" href={`https://instagram.com/${p.ig.replace('@', '')}`} target="_blank" rel="noreferrer">
                  📸 Instagram
                </a>,
              )
            }
            if (p.telegram) {
              contactBtns.push(
                <a key="tg" className="contact-link" href={`https://t.me/${p.telegram.replace('@', '')}`} target="_blank" rel="noreferrer">
                  ✈️ Telegram
                </a>,
              )
            }
            if (p.otro) {
              contactBtns.push(
                <span key="ot" className="contact-link">
                  🔗 {p.otro}
                </span>,
              )
            }
            return (
              <div key={p.id} className="staff-card">
                <div className="staff-actions">
                  <button type="button" className="btn btn-warning btn-xs" onClick={() => openEdit(p.id)}>
                    ✏️
                  </button>
                  <button type="button" className="btn btn-danger btn-xs" onClick={() => delPersona.mutate(p.id)} disabled={delPersona.isPending}>
                    🗑
                  </button>
                </div>
                <div className="staff-avatar" style={{ background: `${p.color}22`, color: p.color }}>
                  {p.nombre.charAt(0).toUpperCase()}
                </div>
                <div className="staff-name">{p.nombre}</div>
                <div className="staff-role">{p.puesto || 'Sin rol definido'}</div>
                {p.notas ? <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '8px' }}>{p.notas}</div> : null}
                <div style={{ marginBottom: '8px' }}>
                  {tareasAsig.length ? tareasAsig.map((t) => <span key={t.id} className="task-chip">{`✓ ${t.nombre}`}</span>) : <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Sin tareas asignadas</span>}
                </div>
                <div className="staff-contacts">{contactBtns.length ? contactBtns : <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Sin contactos</span>}</div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
