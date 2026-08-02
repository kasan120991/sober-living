import { toast } from 'vue-sonner'

/**
 * Toasts, replacing Nuxt UI's useToast().
 *
 * Kept behind a composable rather than importing `toast` in twenty files, so
 * swapping the toast library again is one edit. The shape mirrors how it was
 * already called: a title, and a colour that maps to a severity.
 */
export function useNotify() {
  return {
    success: (title, description) => toast.success(title, { description }),
    error: (title, description) => toast.error(title, { description }),
    warning: (title, description) => toast.warning(title, { description }),
    info: (title, description) => toast(title, { description }),
  }
}
