import { useEsAdmin } from '../hooks/useData'
import Dashboard from './Dashboard'
import MiPanel from './MiPanel'

export default function Inicio() {
  return useEsAdmin() ? <Dashboard /> : <MiPanel />
}
