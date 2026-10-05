import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { QK } from '../../lib/queryKeys'

const ICONOS = {
  tarea_asignada: '📌',
  tarea_estado: '👀',
  tarea_hecha: '✅',
  deadline_manana: '⏰',
  deadline_hoy: '⏰',
  tarea_vencida: '⚠️',
  servicio: '💳',
  aporte: '💸',
  cliente: '🤝',
  sistema: '🔔',
}

function hace(fecha) {
  const min = Math.round((Date.now() - new Date(fecha).getTime()) / 60_000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

/** Campana de notificaciones del topbar: contador de no leídas y panel con las últimas. */
export default function Campana() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [abierta, setAbierta] = useState(false)
  const caja = useRef(null)
  const q = useQuery({
    queryKey: QK.notificaciones,
    queryFn: () => api.get('notificaciones/').then((r) => r.data),
    refetchInterval: 60_000,
  })
  const actualizar = (data) => qc.setQueryData(QK.notificaciones, (prev) => (prev ? { ...prev, ...data } : prev))
  const leer = useMutation({
    mutationFn: (id) => api.post(`notificaciones/${id}/leer/`).then((r) => r.data),
    onSuccess: (data, id) => {
      qc.setQueryData(QK.notificaciones, (prev) =>
        prev ? { ...prev, ...data, resultados: prev.resultados.map((n) => (n.id === id ? { ...n, leida: true } : n)) } : prev,
      )
    },
  })
  const leerTodas = useMutation({
    mutationFn: () => api.post('notificaciones/leer-todas/').then((r) => r.data),
    onSuccess: (data) => {
      actualizar(data)
      qc.invalidateQueries({ queryKey: QK.notificaciones })
    },
  })

  useEffect(() => {
    if (!abierta) return undefined
    const fuera = (e) => caja.current && !caja.current.contains(e.target) && setAbierta(false)
    const esc = (e) => e.key === 'Escape' && setAbierta(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', esc)
    }
  }, [abierta])

  const noLeidas = q.data?.no_leidas ?? 0
  const lista = q.data?.resultados ?? []

  const abrir = (n) => {
    if (!n.leida) leer.mutate(n.id)
    setAbierta(false)
    if (n.url) navigate(n.url)
  }

  return (
    <div className="campana" ref={caja}>
      <button
        type="button"
        className="campana-btn"
        aria-label={noLeidas ? `Notificaciones: ${noLeidas} sin leer` : 'Notificaciones'}
        aria-expanded={abierta}
        onClick={() => {
          if (!abierta) q.refetch()
          setAbierta((v) => !v)
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {noLeidas ? <span className="campana-contador">{noLeidas > 99 ? '99+' : noLeidas}</span> : null}
      </button>
      {abierta ? (
        <div className="campana-panel" role="dialog" aria-label="Notificaciones">
          <div className="campana-cabecera">
            <strong>Notificaciones</strong>
            {noLeidas ? (
              <button type="button" className="btn btn-secondary btn-xs" disabled={leerTodas.isPending} onClick={() => leerTodas.mutate()}>
                Marcar todas como leídas
              </button>
            ) : null}
          </div>
          {lista.length === 0 ? (
            <div className="empty">{q.isLoading ? 'Cargando…' : 'No tenés notificaciones.'}</div>
          ) : (
            <ul className="campana-lista">
              {lista.map((n) => (
                <li key={n.id}>
                  <button type="button" className={`campana-item${n.leida ? '' : ' no-leida'}`} onClick={() => abrir(n)}>
                    <span className="campana-icono" aria-hidden="true">
                      {ICONOS[n.tipo] ?? '🔔'}
                    </span>
                    <span className="campana-texto">
                      <span className="campana-titulo">{n.titulo}</span>
                      {n.cuerpo ? <span className="campana-cuerpo">{n.cuerpo}</span> : null}
                      <span className="campana-fecha">{hace(n.creada)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
