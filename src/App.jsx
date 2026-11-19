import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase.js'
import Chat from './Chat.jsx'
import Dashboard from './Dashboard.jsx'

const companyId = import.meta.env.VITE_COMPANY_ID

function readRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/chat'
  if (path === '/chat') return { page: 'chat', tab: 'live' }
  if (path === '/dashboard') return { page: 'dashboard', tab: 'live' }
  const dashboardTab = path.match(/^\/dashboard\/(live|history|inventory|forecast)$/)
  if (dashboardTab) return { page: 'dashboard', tab: dashboardTab[1] }
  return { page: 'chat', tab: 'live' }
}

export default function App() {
  const [route, setRoute] = useState(readRoute)
  const [companyName, setCompanyName] = useState('Pastelería')

  function navigate(path) {
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setRoute(readRoute())
  }

  useEffect(() => {
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
    if (currentPath === '/dashboard') window.history.replaceState({}, '', '/dashboard/live')
    else if (currentPath !== '/chat' && !/^\/dashboard\/(live|history|inventory|forecast)$/.test(currentPath)) {
      window.history.replaceState({}, '', '/chat')
      setRoute({ page: 'chat', tab: 'live' })
    }
    const onPopState = () => setRoute(readRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!db || !companyId) return
    return onSnapshot(doc(db, 'empresas', companyId), (snapshot) => {
      if (snapshot.exists()) setCompanyName(snapshot.data().nombre || 'Pastelería')
    })
  }, [])

  return (
    <div className="min-h-screen bg-[#f7f8f6] text-slate-800">
      {route.page === 'chat'
        ? <main className="grid min-h-dvh place-items-center p-0 sm:p-8"><div className="h-dvh w-full overflow-hidden bg-white sm:h-[844px] sm:max-h-[calc(100vh-64px)] sm:w-[390px] sm:rounded-[30px] sm:shadow-[0_24px_80px_rgba(31,41,35,.16)]"><Chat onOpenDashboard={() => navigate('/dashboard/live')} /></div></main>
        : <Dashboard companyName={companyName} activeTab={route.tab} onTabChange={(tab) => navigate(`/dashboard/${tab}`)} onOpenChat={() => navigate('/chat')} />}
    </div>
  )
}
