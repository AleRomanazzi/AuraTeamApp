import { Navigate } from 'react-router-dom'
import { puede, useMe } from '../../hooks/useData'

export default function RequireAdmin({ permiso, children }) {
  const { data: me, isPending } = useMe()
  if (isPending) return <div className="state-box">Cargando…</div>
  if (!(permiso ? puede(me, permiso) : me?.es_admin)) return <Navigate to="/" replace />
  return children
}
