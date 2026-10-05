import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import EventoForm from '../components/calendario/EventoForm'
import CalendarioCliente from '../components/tareas/CalendarioCliente'
import ClienteBloque from '../components/tareas/ClienteBloque'
import PlanMesModal from '../components/tareas/PlanMesModal'
import RecurrentesModal from '../components/tareas/RecurrentesModal'
import TableroTareas from '../components/tareas/TableroTareas'
import TareaSheet from '../components/tareas/TareaSheet'
import PageHeader from '../components/ui/PageHeader'
import QueryState from '../components/ui/QueryState'
import { seguirSincronizando, useSyncCalendario } from '../features/google/useSyncCalendario'
import { puede, useClientes, useMe, usePersonas } from '../hooks/useData'
import { api, getList } from '../lib/api'
import { GESTION_INTERNA } from '../lib/constants'
import { diaDe, lunesDe, sumarDias, todayISO } from '../lib/format'
import { notify, notifyError } from '../lib/notify'
import { QK, TAREAS, invalidar } from '../lib/queryKeys'

const FILTROS = [
  { value: 'todas', label: 'Todas' },
  { value: 'mias', label: 'Mis tareas' },
  { value: 'vencidas', label: 'Vencidas' },
  { value: 'semana', label: 'Esta semana' },
]
const SALIDA_MS = 1700
const INTERNA = { id: null, nombre: GESTION_INTERNA, color: 'var(--gold)' }
const ORDEN_PRIORIDAD = { alta: 0, media: 1, baja: 2 }

const ordenar = (a, b) =>
  Number(b.vencida) - Number(a.vencida) ||
  String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999')) ||
  ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad]

export default function Tareas() {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const esAdmin = Boolean(me?.es_admin)
  const { data: clientes = [] } = useClientes()
  const { data: personas = [] } = usePersonas()
  const [vista, setVista] = useState('clientes')
  const [filtro, setFiltro] = useState('todas')
  const [busqueda, setBusqueda] = useState('')
  const [tareaElegida, setTareaAbierta] = useState(null)
  const [params, setParams] = useSearchParams()
  const [calendario, setCalendario] = useState(null)
  const [evento, setEvento] = useState(null)
  const [recurrentes, setRecurrentes] = useState(false)
  const [plan, setPlan] = useState(null)

  const hoy = todayISO()
  const lunes = lunesDe(hoy)
  const proximas = useMemo(() => Array.from({ length: 28 }, (_, i) => sumarDias(lunes, i)), [lunes])
  const semana = proximas.slice(0, 7)

  const q = useQuery({ queryKey: QK.tareas({}), queryFn: () => getList('tareas/') })
  const mios = useQuery({ queryKey: ['clientes', 'mios'], queryFn: () => getList('clientes/', { mios: 1 }), enabled: Boolean(me) && !esAdmin })
  const rango = { desde: proximas[0], hasta: `${proximas[27]}T23:59:59` }
  const eventos = useQuery({ queryKey: QK.calEventos(rango), queryFn: () => getList('cal-eventos/', rango) })
  // Respaldo del webhook: trae lo editado en Notion al abrir la pantalla (el servidor lo limita a una vez por minuto).
  useQuery({
    queryKey: ['notion', 'incremental'],
    queryFn: async () => {
      const { data } = await api.post('notion/sincronizar/')
      if (data.creadas || data.actualizadas || data.borradas) invalidar(qc, ['tareas', 'dashboard', 'mi-panel'])
      return data
    },
    staleTime: 60_000,
    refetchInterval: seguirSincronizando,
    retry: false,
  })
  useSyncCalendario()

  // ?tarea=ID (links de notificaciones) abre esa tarea.
  const idUrl = Number(params.get('tarea')) || null
  const deUrl = idUrl ? (q.data ?? []).find((t) => t.id === idUrl) : null
  const tareaAbierta = tareaElegida ?? (deUrl ? { tarea: deUrl } : null)
  const cerrarTarea = () => {
    setTareaAbierta(null)
    if (idUrl) setParams({}, { replace: true })
  }

  const cambiarEstado = useMutation({
    mutationFn: ({ id, estado }) => api.patch(`tareas/${id}/`, { estado }),
    onSuccess: (_, { estado }) => {
      invalidar(qc, TAREAS)
      if (estado === 'hecha') notify('Tarea hecha')
    },
    onError: (e) => notifyError(e),
  })

  // Las recién tildadas se ven hechas y se pliegan antes de salir de la lista.
  const [tildadas, setTildadas] = useState(() => new Set())
  const destildar = (id) =>
    setTildadas((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    })
  const deshacer = async (t) => {
    destildar(t.id)
    try {
      await api.patch(`tareas/${t.id}/`, { estado: t.estado })
      invalidar(qc, TAREAS)
    } catch (e) {
      notifyError(e)
    }
  }
  const marcarHecha = async (t) => {
    setTildadas((s) => new Set(s).add(t.id))
    try {
      await api.patch(`tareas/${t.id}/`, { estado: 'hecha' })
    } catch (e) {
      destildar(t.id)
      notifyError(e)
      return
    }
    toast.success(
      (aviso) => (
        <span className="toast-accion">
          Hecha: {t.titulo}
          <button
            type="button"
            onClick={() => {
              toast.dismiss(aviso.id)
              deshacer(t)
            }}
          >
            Deshacer
          </button>
        </span>
      ),
      { duration: 6000 },
    )
    setTimeout(() => {
      invalidar(qc, TAREAS)
      destildar(t.id)
    }, SALIDA_MS)
  }

  const personasPorId = useMemo(() => Object.fromEntries(personas.map((p) => [p.id, p])), [personas])

  const filtradas = useMemo(() => {
    const s = busqueda.trim().toLowerCase()
    return (q.data ?? []).filter((t) => {
      if (s && !`${t.titulo} ${t.descripcion} ${t.cliente_nombre ?? GESTION_INTERNA}`.toLowerCase().includes(s)) return false
      if (filtro === 'mias') return Boolean(me?.persona) && t.asignados.includes(me.persona)
      if (filtro === 'vencidas') return t.vencida
      if (filtro === 'semana') return Boolean(t.fecha_limite) && t.fecha_limite >= semana[0] && t.fecha_limite <= semana[6]
      return true
    })
  }, [q.data, busqueda, filtro, me, semana])

  const bloques = useMemo(() => {
    const abiertas = filtradas.filter((t) => t.estado !== 'hecha')
    const base = esAdmin ? clientes.filter((c) => c.estado === 'activo') : (mios.data ?? [])
    const lista = new Map(base.map((c) => [c.id, { id: c.id, nombre: c.nombre, color: c.color }]))
    for (const t of abiertas) {
      const mia = Boolean(me?.persona) && t.asignados.includes(me.persona)
      if (t.cliente && !lista.has(t.cliente) && (esAdmin || mia)) lista.set(t.cliente, { id: t.cliente, nombre: t.cliente_nombre, color: t.cliente_color })
    }
    const marcas = {}
    const marcar = (clave, dia, it) => {
      const porDia = (marcas[clave] = marcas[clave] || {})
      ;(porDia[dia] = porDia[dia] || []).push(it)
    }
    for (const e of eventos.data ?? []) marcar(e.cliente ?? 'interno', diaDe(e.inicio), { key: `e${e.id}`, tipo: 'evento', color: e.color })
    for (const t of abiertas) if (t.fecha_limite) marcar(t.cliente ?? 'interno', t.fecha_limite, { key: `t${t.id}`, tipo: 'tarea', color: t.cliente_color || 'var(--gold)' })

    const filtrando = filtro !== 'todas' || busqueda.trim()
    return [INTERNA, ...[...lista.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))]
      .map((c) => ({
        cliente: c,
        tareas: abiertas.filter((t) => (t.cliente ?? null) === c.id).sort(ordenar),
        marcas: marcas[c.id ?? 'interno'] ?? {},
      }))
      .filter((b) => !filtrando || b.tareas.length)
  }, [filtradas, esAdmin, clientes, mios.data, me, eventos.data, filtro, busqueda])

  const misClientes = new Set((mios.data ?? []).map((c) => c.id))
  const puedePlan = (c) => esAdmin || (puede(me, 'plan_tareas') && (c.id === null || misClientes.has(c.id)))

  const irA = (id) => document.getElementById(`bloque-${id ?? 'interno'}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const tareasDeCalendario = calendario ? (q.data ?? []).filter((t) => t.estado !== 'hecha' && (t.cliente ?? null) === calendario.cliente.id) : []

  return (
    <>
      <PageHeader titulo="Tareas" subtitulo={esAdmin ? 'Gestión interna y tareas y agenda de cada cliente' : 'Gestión interna (la editan todos) y tus clientes, donde editás las tuyas.'}>
        <div className="seg" role="tablist" aria-label="Vista">
          <button type="button" role="tab" aria-selected={vista === 'clientes'} className={vista === 'clientes' ? 'active' : ''} onClick={() => setVista('clientes')}>
            Por cliente
          </button>
          <button type="button" role="tab" aria-selected={vista === 'tablero'} className={vista === 'tablero' ? 'active' : ''} onClick={() => setVista('tablero')}>
            Tablero
          </button>
        </div>
        {esAdmin ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRecurrentes(true)}>
            ↻ Recurrentes
          </button>
        ) : null}
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setTareaAbierta({})}>
          + Nueva tarea
        </button>
      </PageHeader>

      <div className="filters tc-filtros">
        <input type="search" placeholder="Buscar tarea o cliente…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar tareas" />
        <div className="chip-select tc-chips" role="radiogroup" aria-label="Filtro">
          {FILTROS.map((f) => (
            <button key={f.value} type="button" role="radio" aria-checked={filtro === f.value} className={`chip${filtro === f.value ? ' active' : ''}`} onClick={() => setFiltro(f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <QueryState query={q}>
        {() =>
          vista === 'tablero' ? (
            <TableroTareas tareas={filtradas} onAbrir={(t) => setTareaAbierta({ tarea: t })} onCambiarEstado={(t, estado) => cambiarEstado.mutate({ id: t.id, estado })} />
          ) : (
            <>
              {bloques.length > 1 ? (
                <nav className="tc-saltos" aria-label="Ir a cliente">
                  {bloques.map((b) => (
                    <button key={b.cliente.id ?? 'interno'} type="button" className="tc-salto" onClick={() => irA(b.cliente.id)}>
                      <span className="cat-dot" style={{ background: b.cliente.color || 'var(--text-dim)' }} />
                      {b.cliente.nombre}
                      {b.tareas.length ? <span className="tc-salto-n">{b.tareas.length}</span> : null}
                    </button>
                  ))}
                </nav>
              ) : null}
              {bloques.length === 0 ? (
                <div className="state-box">{!esAdmin && mios.data?.length === 0 ? 'Todavía no tenés clientes asignados.' : 'No hay tareas con ese filtro.'}</div>
              ) : null}
              <div className="tc-lista">
                {bloques.map((b) => (
                  <ClienteBloque
                    key={b.cliente.id ?? 'interno'}
                    cliente={b.cliente}
                    tareas={b.tareas}
                    marcasPorDia={b.marcas}
                    semana={semana}
                    proximas={proximas}
                    hoy={hoy}
                    personas={personasPorId}
                    onAbrirTarea={(t) => setTareaAbierta({ tarea: t })}
                    onNuevaTarea={(c) => setTareaAbierta({ cliente: c.id ? c : null })}
                    onAbrirDia={(c, dia) => setCalendario({ cliente: c, dia })}
                    tildadas={tildadas}
                    onMarcarHecha={marcarHecha}
                    onPlan={puedePlan(b.cliente) ? (c) => setPlan(c) : null}
                  />
                ))}
              </div>
            </>
          )
        }
      </QueryState>

      {recurrentes ? (
        <RecurrentesModal onClose={() => setRecurrentes(false)} />
      ) : plan ? (
        <PlanMesModal cliente={plan} tareas={(q.data ?? []).filter((t) => t.cliente === plan.id)} onClose={() => setPlan(null)} />
      ) : evento ? (
        <EventoForm inicial={evento.inicial} dia={evento.dia} cliente={evento.cliente?.id ? evento.cliente : null} onClose={() => setEvento(null)} />
      ) : tareaAbierta ? (
        <TareaSheet tarea={tareaAbierta.tarea} cliente={tareaAbierta.cliente} onClose={cerrarTarea} />
      ) : calendario ? (
        <CalendarioCliente
          key={`${calendario.cliente.id ?? 'interno'}-${calendario.dia}`}
          cliente={calendario.cliente}
          diaInicial={calendario.dia}
          tareas={tareasDeCalendario}
          onClose={() => setCalendario(null)}
          onNuevoEvento={(dia) => {
            setCalendario((c) => ({ ...c, dia }))
            setEvento({ dia, cliente: calendario.cliente })
          }}
          onAbrirEvento={(e) => {
            setCalendario((c) => ({ ...c, dia: diaDe(e.inicio) }))
            setEvento({ inicial: e, dia: diaDe(e.inicio), cliente: calendario.cliente })
          }}
          onAbrirTarea={(t) => {
            setCalendario((c) => ({ ...c, dia: t.fecha_limite }))
            setTareaAbierta({ tarea: t })
          }}
        />
      ) : null}
    </>
  )
}
