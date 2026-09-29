import { apiErrorMessage } from '../../lib/errors'

/** Muestra carga / error / vacío de una consulta de react-query y, si hay datos, los hijos. */
export default function QueryState({ query, vacio, esVacio, children }) {
  if (query.isPending) return <div className="state-box">Cargando…</div>
  if (query.isError) {
    return (
      <div className="state-box state-box--error">
        <div>{apiErrorMessage(query.error, 'No se pudieron cargar los datos.')}</div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => query.refetch()}>
          Reintentar
        </button>
      </div>
    )
  }
  const data = query.data
  const estaVacio = esVacio ? esVacio(data) : Array.isArray(data) && data.length === 0
  if (estaVacio && vacio) return <div className="state-box">{vacio}</div>
  return typeof children === 'function' ? children(data) : children
}
