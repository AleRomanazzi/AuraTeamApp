export const tokenKey = 'aura_token'

export const getToken = () => localStorage.getItem(tokenKey)
export const setToken = (token) => localStorage.setItem(tokenKey, token)
export const clearToken = () => localStorage.removeItem(tokenKey)
