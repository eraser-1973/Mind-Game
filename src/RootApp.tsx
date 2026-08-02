import App from './App'
import { AdminApp } from './admin/AdminApp'

export function RootApp({
  pathname = typeof window === 'undefined' ? '/' : window.location.pathname,
}: {
  pathname?: string
}) {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return <AdminApp />
  }
  return <App />
}
