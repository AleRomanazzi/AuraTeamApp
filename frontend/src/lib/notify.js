import toast from 'react-hot-toast'

export const notify = (msg, type = 'success') => {
  if (type === 'error') return toast.error(msg)
  if (type === 'loading') return toast.loading(msg)
  return toast.success(msg)
}
