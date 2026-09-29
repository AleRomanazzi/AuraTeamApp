import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import './styles/tokens.css'
import './styles/html-app.css'
import './styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (intentos, error) => {
        const status = error?.response?.status
        if (status && status >= 400 && status < 500) return false
        return intentos < 1
      },
    },
    mutations: { retry: false },
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="top-right" toastOptions={{ style: { background: 'var(--surface, #1a1a24)', color: 'var(--text, #fff)', border: '1px solid var(--border, #333)' } }} />
    </QueryClientProvider>
  </StrictMode>,
)
