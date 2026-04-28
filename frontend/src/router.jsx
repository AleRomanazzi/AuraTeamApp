import { Navigate, createBrowserRouter } from 'react-router-dom'
import RequireAuth from './components/auth/RequireAuth'
import { ModalProvider } from './context/ModalContext'
import { Phase1Provider } from './context/Phase1Context'
import PageShell from './components/layout/PageShell'
import Calendar from './pages/Calendar'
import Config from './pages/Config'
import Dashboard from './pages/Dashboard'
import Estadisticas from './pages/Estadisticas'
import Gmail from './pages/Gmail'
import Ingresos from './pages/Ingresos'
import Login from './pages/Login'
import Perfiles from './pages/Perfiles'
import Personal from './pages/Personal'
import Register from './pages/Register'
import Servicios from './pages/Servicios'

const protectedLayout = (
  <RequireAuth>
    <Phase1Provider>
      <ModalProvider>
        <PageShell />
      </ModalProvider>
    </Phase1Provider>
  </RequireAuth>
)

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    path: '/',
    element: protectedLayout,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'ingresos', element: <Ingresos /> },
      { path: 'servicios', element: <Servicios /> },
      { path: 'personal', element: <Personal /> },
      { path: 'perfiles', element: <Perfiles /> },
      { path: 'gmail', element: <Gmail /> },
      { path: 'calendar', element: <Calendar /> },
      { path: 'estadisticas', element: <Estadisticas /> },
      { path: 'config', element: <Config /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default router
