import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import './styles/tokens.css'
import './styles/html-app.css'
import './styles/globals.css'
import { aplicarTema, temaGuardado } from './lib/tema'

aplicarTema(temaGuardado())

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (intentos, error) => {
        const status = error?.response?.status
        if (status && status >= 400 && status < 500) return false
        // El servidor de Render se duerme: las primeras llamadas se rechazan hasta que despierta.
        if (!error?.response) return intentos < 3
        return intentos < 1
      },
      retryDelay: (intento) => [2000, 5000, 10000][intento] ?? 10000,
    },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="top-center"
        toastOptions={{
          style: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: '8px', fontSize: '14px', maxWidth: 'min(460px, 92vw)' },
          success: { iconTheme: { primary: 'var(--success)', secondary: 'var(--on-color)' } },
          error: { iconTheme: { primary: 'var(--accent3)', secondary: 'var(--on-color)' } },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
)
