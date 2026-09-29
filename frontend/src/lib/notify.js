import toast from 'react-hot-toast'
import { apiErrorMessage } from './errors'

export const notify = (msg, type = 'success') => {
  if (type === 'error') return toast.error(msg)
  if (type === 'loading') return toast.loading(msg)
  return toast.success(msg)
}

export const notifyError = (error, fallback) => toast.error(apiErrorMessage(error, fallback))
