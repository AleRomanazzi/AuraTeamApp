import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'

export default function ErrorPage() {
  const error = useRouteError()
  const noEncontrada = isRouteErrorResponse(error) && error.status === 404
  return (
    <div className="page active" style={{ maxWidth: 520, margin: '64px auto' }}>
      <div className="card">
        <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: 12 }}>{noEncontrada ? 'Página no encontrada' : 'Algo salió mal'}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
          {noEncontrada ? 'La dirección no existe.' : 'Hubo un error inesperado en esta pantalla. Podés volver al inicio o recargar.'}
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className="btn btn-primary" to="/">
            Ir al inicio
          </Link>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      </div>
    </div>
  )
}
