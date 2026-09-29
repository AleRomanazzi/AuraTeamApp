import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { isSignedIn } from '../features/google/gapiClient'
import { getMessageFull, listInboxMessages, sendMessage } from '../features/google/gmailApi'
import { useGoogleStore } from '../features/google/googleStore'
import { useClientes } from '../hooks/useData'
import { COLORES } from '../lib/constants'
import { formatFechaHora, parseFrom } from '../lib/format'
import { notify } from '../lib/notify'

const errorGoogle = (e, fallback) => e?.result?.error?.message || e?.message || fallback

function Redactar({ inicial, onClose }) {
  const { data: clientes = [] } = useClientes()
  const [f, setF] = useState({ to: inicial?.to ?? '', subject: inicial?.subject ?? '', body: inicial?.body ?? '' })
  const conEmail = clientes.filter((c) => c.email)
  const enviar = useMutation({
    mutationFn: () => sendMessage(f),
    onSuccess: () => {
      notify('Correo enviado')
      onClose()
    },
    onError: (e) => notify(errorGoogle(e, 'No se pudo enviar'), 'error'),
  })
  return (
    <Modal
      title="Redactar correo"
      onClose={onClose}
      size="lg"
      onSubmit={() => enviar.mutate()}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={enviar.isPending}>
            {enviar.isPending ? 'Enviando…' : 'Enviar'}
          </button>
        </>
      }
    >
      {conEmail.length ? (
        <Field label="Enviar a un cliente">
          <select value="" onChange={(e) => e.target.value && setF((s) => ({ ...s, to: e.target.value }))}>
            <option value="">Elegir…</option>
            {conEmail.map((c) => (
              <option key={c.id} value={c.email}>
                {c.nombre} — {c.email}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      <Field label="Para">
        <input type="email" multiple value={f.to} onChange={(e) => setF((s) => ({ ...s, to: e.target.value }))} required />
      </Field>
      <Field label="Asunto">
        <input value={f.subject} onChange={(e) => setF((s) => ({ ...s, subject: e.target.value }))} required maxLength={200} />
      </Field>
      <Field label="Mensaje">
        <textarea rows={10} value={f.body} onChange={(e) => setF((s) => ({ ...s, body: e.target.value }))} required />
      </Field>
    </Modal>
  )
}

export default function Gmail() {
  const tokenVersion = useGoogleStore((s) => s.tokenVersion)
  const conectado = isSignedIn()
  const [busqueda, setBusqueda] = useState('')
  const [seleccionado, setSeleccionado] = useState(null)
  const [redactando, setRedactando] = useState(null)

  const bandeja = useQuery({ queryKey: ['gmail', 'inbox', tokenVersion], queryFn: () => listInboxMessages(30, 20), enabled: conectado, staleTime: 60_000 })
  const detalle = useQuery({ queryKey: ['gmail', 'msg', seleccionado?.id], queryFn: () => getMessageFull(seleccionado.id), enabled: conectado && Boolean(seleccionado) })

  const filtrados = useMemo(() => {
    const s = busqueda.trim().toLowerCase()
    return (bandeja.data ?? []).filter((e) => !s || `${e.subject} ${e.snippet} ${e.from}`.toLowerCase().includes(s))
  }, [bandeja.data, busqueda])

  const responder = () => {
    const d = detalle.data
    if (!d) return
    const email = /<([^>]+)>/.exec(d.from)?.[1] || d.from
    setRedactando({ to: email, subject: d.subject.startsWith('Re:') ? d.subject : `Re: ${d.subject}`, body: `\n\n— El ${d.date}, ${parseFrom(d.from)} escribió:\n${d.body.split('\n').map((l) => `> ${l}`).join('\n')}` })
  }

  return (
    <>
      <PageHeader titulo="Gmail" subtitulo="Bandeja de la cuenta de la agencia">
        <button type="button" className="btn btn-secondary btn-sm" disabled={!conectado || bandeja.isFetching} onClick={() => bandeja.refetch()}>
          {bandeja.isFetching ? 'Actualizando…' : '↻ Actualizar'}
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!conectado} onClick={() => setRedactando({})}>
          ✉ Redactar
        </button>
      </PageHeader>
      {!conectado ? (
        <div className="info-box">
          Google no está conectado. Andá a <Link to="/config">Configuración</Link> y tocá <strong>Conectar Google</strong>.
        </div>
      ) : null}
      <div className="grid-2">
        <div className="card">
          <input type="search" placeholder="Buscar en correos…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar correos" style={{ width: '100%', marginBottom: 12 }} />
          {bandeja.isError ? (
            <div className="state-box state-box--error">{errorGoogle(bandeja.error, 'No se pudo cargar Gmail')}</div>
          ) : bandeja.isLoading ? (
            <div className="state-box">Cargando…</div>
          ) : filtrados.length === 0 ? (
            <div className="empty">{conectado ? 'No hay correos.' : 'Conectá Google para ver los correos.'}</div>
          ) : (
            filtrados.map((e, i) => {
              const color = COLORES[i % COLORES.length]
              return (
                <button key={e.id} type="button" className={`gmail-item${e.unread ? ' unread' : ''}${seleccionado?.id === e.id ? ' active' : ''}`} onClick={() => setSeleccionado(e)}>
                  <div className="gmail-avatar" style={{ background: `${color}22`, color }}>
                    {parseFrom(e.from).charAt(0).toUpperCase()}
                  </div>
                  <div className="gmail-body">
                    <div className="gmail-row">
                      <span className="gmail-from">{parseFrom(e.from)}</span>
                      <span className="small muted">{formatFechaHora(e.date)}</span>
                    </div>
                    <div className="gmail-subject">{e.subject || '(Sin asunto)'}</div>
                    <div className="gmail-preview">{e.snippet}</div>
                  </div>
                </button>
              )
            })
          )}
        </div>
        <div className="card">
          {!seleccionado ? (
            <div className="empty">Elegí un correo para leerlo.</div>
          ) : detalle.isLoading ? (
            <div className="state-box">Cargando…</div>
          ) : detalle.isError ? (
            <div className="state-box state-box--error">{errorGoogle(detalle.error, 'No se pudo cargar el correo')}</div>
          ) : detalle.data ? (
            <div className="email-detail">
              <h3>{detalle.data.subject}</h3>
              <div className="small muted">De: {detalle.data.from}</div>
              <div className="small muted">Fecha: {detalle.data.date}</div>
              <div className="email-body">{detalle.data.body}</div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={responder}>
                ↩ Responder
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {redactando ? <Redactar inicial={redactando} onClose={() => setRedactando(null)} /> : null}
    </>
  )
}
