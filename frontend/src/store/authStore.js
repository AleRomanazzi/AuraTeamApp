import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
  persist(
    (set) => ({
      access: null,
      refresh: null,
      setTokens: (access, refresh) => set({ access, refresh }),
      clearAuth: () => set({ access: null, refresh: null }),
    }),
    { name: 'aura-auth' },
  ),
)
