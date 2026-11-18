import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { puede, useClientes, useMe, usePersonas } from '../../hooks/useData'
import { getList } from '../../lib/api'
import { GESTION_INTERNA } from '../../lib/constants'
import { QK } from '../../lib/queryKeys'

const PAGINAS = [
  { label: 'Inicio', to: '/', admin: true },
  { label: 'Mi panel', to: '/mi-panel' },
  { label: 'Tareas', to: '/tareas' },
  { label: 'Calendario', to: '/calendario' },
  { label: 'Clientes', to: '/clientes', permiso: 'clientes' },
  { label: 'Cobros', to: '/cobros', admin: true },
  { label: 'Movimientos', to: '/movimientos', admin: true },
  { label: 'Suscripciones', to: '/suscripciones', admin: true },
  { label: 'Equipo hoy', to: '/equipo-hoy', admin: true },
  { label: 'Personas del equipo', to: '/equipo', admin: true },
  { label: 'Pagos al equipo', to: '/pagos-equipo', admin: true },
  { label: 'Gmail', to: '/gmail', admin: true },
  { label: 'Estadísticas', to: '/estadisticas', permiso: 'estadisticas' },
  { label: 'Configuración', to: '/config' },
]
const POR_GRUPO = 6

const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Abre con Cmd+K / Ctrl+K: salta a un cliente, una tarea, una persona o una sección. */
export default function BuscadorGlobal({ abierto, onCerrar }) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const esAdmin = Boolean(me?.es_admin)
  const [texto, setTexto] = useState('')
  const [activo, setActivo] = useState(0)
  const inputRef = useRef(null)
  const { data: clientes = [] } = useClientes({ enabled: abierto })
  const { data: personas = [] } = usePersonas({ enabled: abierto && esAdmin })
  const tareas = useQuery({ queryKey: QK.tareas({}), queryFn: () => getList('tareas/'), enabled: abierto, staleTime: 30_000 })

  useEffect(() => {
    if (!abierto) return undefined
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [abierto])

  const resultados = useMemo(() => {
    const q = normalizar(texto.trim())
    const coincide = (...campos) => !q || campos.some((c) => normalizar(c).includes(q))
    const paginas = PAGINAS.filter((p) => (p.admin ? esAdmin : !p.permiso || puede(me, p.permiso)) && coincide(p.label)).map((p) => ({
      key: `p${p.to}`,
      grupo: 'Secciones',
      titulo: p.label,
      to: p.to,
    }))
    if (!q) return paginas
    const verFicha = puede(me, 'clientes')
    const cl = clientes
      .filter((c) => coincide(c.nombre, c.razon_social, c.rubro))
      .slice(0, POR_GRUPO)
      .map((c) => ({
        key: `c${c.id}`,
        grupo: 'Clientes',
        titulo: c.nombre,
        sub: c.estado !== 'activo' ? c.estado : c.rubro,
        color: c.color,
        to: verFicha ? `/clientes/${c.id}` : `/tareas?cliente=${c.id}`,
      }))
    const ta = (tareas.data ?? [])
      .filter((t) => coincide(t.titulo, t.cliente_nombre))
      .sort((a, b) => Number(a.estado === 'hecha') - Number(b.estado === 'hecha'))
      .slice(0, POR_GRUPO)
      .map((t) => ({
        key: `t${t.id}`,
        grupo: 'Tareas',
        titulo: t.titulo,
        sub: `${t.cliente_nombre || GESTION_INTERNA}${t.estado === 'hecha' ? ' · hecha' : ''}`,
        color: t.cliente_color || 'var(--gold)',
        to: `/tareas?tarea=${t.id}`,
      }))
    const pe = personas
      .filter((p) => coincide(p.nombre, p.rol))
      .slice(0, POR_GRUPO)
      .map((p) => ({ key: `e${p.id}`, grupo: 'Equipo', titulo: p.nombre, sub: p.rol, color: p.color, to: '/equipo' }))
    return [...cl, ...ta, ...pe, ...paginas]
  }, [texto, clientes, tareas.data, personas, me, esAdmin])

  if (!abierto) return null

  const elegido = Math.min(activo, Math.max(resultados.length - 1, 0))
  const ir = (r) => {
    if (!r) return
    navigate(r.to)
    onCerrar()
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActivo((i) => Math.min(i + 1, resultados.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      ir(resultados[elegido])
    } else if (e.key === 'Escape') {
      onCerrar()
    }
  }

  return createPortal(
    <div className="buscador-overlay" onClick={onCerrar} role="presentation">
      <div className="buscador" role="dialog" aria-modal="true" aria-label="Buscar en el panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="buscador-input"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            setActivo(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Buscar clientes, tareas, personas o secciones…"
          aria-label="Buscar"
          aria-controls="buscador-resultados"
          aria-activedescendant={resultados[elegido] ? `br-${resultados[elegido].key}` : undefined}
        />
        <ul className="buscador-lista" id="buscador-resultados" role="listbox">
          {texto.trim() && tareas.isLoading ? <li className="buscador-vacio">Cargando tareas…</li> : null}
          {!resultados.length ? <li className="buscador-vacio">Sin resultados.</li> : null}
          {resultados.map((r, i) => {
            const titulo = i === 0 || resultados[i - 1].grupo !== r.grupo ? r.grupo : null
            return (
              <li key={r.key} role="presentation">
                {titulo ? <div className="buscador-grupo">{titulo}</div> : null}
                <button
                  type="button"
                  id={`br-${r.key}`}
                  role="option"
                  aria-selected={i === elegido}
                  className={`buscador-item${i === elegido ? ' activo' : ''}`}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => ir(r)}
                >
                  {r.color ? <span className="cat-dot" style={{ background: r.color }} /> : null}
                  <span className="buscador-titulo">{r.titulo}</span>
                  {r.sub ? <span className="buscador-sub">{r.sub}</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
        <div className="buscador-pie">↑↓ para moverte · Enter para abrir · Esc para cerrar</div>
      </div>
    </div>,
    document.body,
  )
}
