import { Navigate } from 'react-router-dom'
import { useMe } from '../../hooks/useData'

export default function RequireAdmin({ children }) {
  const { data: me, isPending } = useMe()
  if (isPending) return <div className="state-box">Cargando…</div>
  if (!me?.es_admin) return <Navigate to="/" replace />
  return children
}
