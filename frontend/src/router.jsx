/* eslint-disable react-refresh/only-export-components -- módulo de configuración de rutas, no de componentes */
import { lazy } from 'react'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import RequireAdmin from './components/auth/RequireAdmin'
import RequireAuth from './components/auth/RequireAuth'
import PageShell from './components/layout/PageShell'
import ErrorPage from './pages/ErrorPage'
import Inicio from './pages/Inicio'
import Login from './pages/Login'

const Calendario = lazy(() => import('./pages/Calendario'))
const ClienteDetalle = lazy(() => import('./pages/ClienteDetalle'))
const ClienteReporte = lazy(() => import('./pages/ClienteReporte'))
const Clientes = lazy(() => import('./pages/Clientes'))
const Cobros = lazy(() => import('./pages/Cobros'))
const Config = lazy(() => import('./pages/Config'))
const Equipo = lazy(() => import('./pages/Equipo'))
const Estadisticas = lazy(() => import('./pages/Estadisticas'))
const Gmail = lazy(() => import('./pages/Gmail'))
const Movimientos = lazy(() => import('./pages/Movimientos'))
const PagosEquipo = lazy(() => import('./pages/PagosEquipo'))
const Recibo = lazy(() => import('./pages/Recibo'))
const Suscripciones = lazy(() => import('./pages/Suscripciones'))
const Tareas = lazy(() => import('./pages/Tareas'))

const admin = (el) => <RequireAdmin>{el}</RequireAdmin>
const conPermiso = (permiso, el) => <RequireAdmin permiso={permiso}>{el}</RequireAdmin>

const redirecciones = {
  ingresos: '/movimientos',
  servicios: '/suscripciones',
  personal: '/equipo',
  perfiles: '/tareas',
  calendar: '/calendario',
}

const router = createBrowserRouter([
  { path: '/login', element: <Login />, errorElement: <ErrorPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <PageShell />
      </RequireAuth>
    ),
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Inicio /> },
      { path: 'tareas', element: <Tareas /> },
      { path: 'calendario', element: <Calendario /> },
      { path: 'config', element: <Config /> },
      { path: 'pagos-equipo/:id/recibo', element: <Recibo /> },
      { path: 'clientes', element: conPermiso('clientes', <Clientes />) },
      { path: 'clientes/:id', element: conPermiso('clientes', <ClienteDetalle />) },
      { path: 'clientes/:id/reporte', element: admin(<ClienteReporte />) },
      { path: 'cobros', element: admin(<Cobros />) },
      { path: 'movimientos', element: admin(<Movimientos />) },
      { path: 'suscripciones', element: admin(<Suscripciones />) },
      { path: 'equipo', element: admin(<Equipo />) },
      { path: 'pagos-equipo', element: admin(<PagosEquipo />) },
      { path: 'gmail', element: admin(<Gmail />) },
      { path: 'estadisticas', element: conPermiso('estadisticas', <Estadisticas />) },
      ...Object.entries(redirecciones).map(([path, to]) => ({ path, element: <Navigate to={to} replace /> })),
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default router
