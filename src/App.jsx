import { useEffect, useState } from 'react'
import { collection, doc, onSnapshot } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from './firebase.js'
import Chat from './Chat.jsx'
import Dashboard from './Dashboard.jsx'

const defaultCompanyId = import.meta.env.VITE_COMPANY_ID
// The public chat should open on the bakery by default; a `?tienda=` URL still overrides it.
const defaultChatCompanyId = 'pasteleria-dulce'

function readRoute() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/chat'
  if (path === '/chat') return { page: 'chat', tab: 'live' }
  if (path === '/dashboard') return { page: 'dashboard', tab: 'select' }
  if (path === '/dashboard/live') return { page: 'dashboard', tab: 'live' }
  const dashboardTab = path.match(/^\/dashboard\/(history|inventory|forecast|combos)$/)
  if (dashboardTab) return { page: 'dashboard', tab: dashboardTab[1] }
  return { page: 'chat', tab: 'live' }
}

function readCompanyId(route) {
  const selected = new URLSearchParams(window.location.search).get('tienda')
  if (selected) return selected
  if (route.page === 'chat') return defaultChatCompanyId
  return route.tab !== 'select' ? defaultCompanyId : ''
}

function StorePortal({ companies, onSelect }) {
  return <main className="mx-auto min-h-dvh w-full max-w-4xl px-5 py-12 sm:py-20"><p className="text-sm font-semibold text-emerald-800">Panel de administración</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Elige una tienda</h1><p className="mt-2 text-sm text-slate-500">Cada tienda usa sus propios productos, pedidos y acceso.</p><div className="mt-7 grid gap-4 sm:grid-cols-2">{companies.map((company) => <button key={company.id} onClick={() => onSelect(company.id)} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"><span className="grid size-12 shrink-0 place-items-center rounded-xl text-xl text-white" style={{ backgroundColor: company.colorPrimario || '#087d60' }}>{/pizzer/i.test(`${company.id} ${company.tipoNegocio || ''} ${company.nombre || ''}`) ? '🍕' : '🧁'}</span><span className="min-w-0"><strong className="block truncate text-base text-slate-900">{company.nombre || company.id}</strong><small className="mt-1 block text-xs text-slate-500">Iniciar sesión en esta tienda</small></span><span className="ml-auto text-slate-400">›</span></button>)}</div>{companies.length === 0 && <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">No hay tiendas configuradas.</p>}</main>
}

export default function App() {
  const [route, setRoute] = useState(readRoute)
  const [companyId, setCompanyId] = useState(() => readCompanyId(readRoute()))
  const [companyName, setCompanyName] = useState('Tienda')
  const [companies, setCompanies] = useState([])

  function href(path, storeId = companyId) {
    return `${path}${storeId ? `?tienda=${encodeURIComponent(storeId)}` : ''}`
  }

  function navigate(path, storeId = companyId) {
    window.history.pushState({}, '', href(path, storeId))
    const nextRoute = readRoute()
    setRoute(nextRoute)
    setCompanyId(storeId || readCompanyId(nextRoute))
  }

  async function openGeneralPortal() {
    if (auth?.currentUser) await signOut(auth)
    navigate('/dashboard', '')
  }

  async function openStoreDashboard(storeId) {
    if (auth?.currentUser) await signOut(auth)
    navigate('/dashboard/live', storeId)
  }

  useEffect(() => {
    const syncFromUrl = () => {
      const nextRoute = readRoute()
      setRoute(nextRoute)
      setCompanyId(readCompanyId(nextRoute))
    }
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/chat'
    if (currentPath === '/dashboard/live' && !new URLSearchParams(window.location.search).has('tienda') && defaultCompanyId) {
      window.history.replaceState({}, '', href('/dashboard/live', defaultCompanyId))
    } else if (currentPath !== '/chat' && currentPath !== '/dashboard' && !/^\/dashboard\/(live|history|inventory|forecast|combos)$/.test(currentPath)) {
      window.history.replaceState({}, '', href('/chat', defaultCompanyId))
      syncFromUrl()
    }
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  useEffect(() => {
    if (!db) return
    return onSnapshot(collection(db, 'empresas'), (snapshot) => {
      setCompanies(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter((company) => company.activa !== false))
    })
  }, [])

  useEffect(() => {
    if (!db || !companyId) { setCompanyName('Tienda'); return }
    return onSnapshot(doc(db, 'empresas', companyId), (snapshot) => {
      if (snapshot.exists()) setCompanyName(snapshot.data().nombre || 'Tienda')
    })
  }, [companyId])

  return (
    <div className="min-h-screen bg-[#f7f8f6] text-slate-800">
      {route.page === 'chat'
        ? <main className="grid min-h-dvh place-items-center p-0 sm:p-8"><div className="h-dvh w-full overflow-hidden bg-white sm:h-[844px] sm:max-h-[calc(100vh-64px)] sm:w-[390px] sm:rounded-[30px] sm:shadow-[0_24px_80px_rgba(31,41,35,.16)]"><Chat companyId={companyId} stores={companies} onSelectStore={(storeId) => navigate('/chat', storeId)} onOpenDashboard={openGeneralPortal} /></div></main>
        : route.tab === 'select'
          ? <StorePortal companies={companies} onSelect={openStoreDashboard} />
          : <Dashboard companyId={companyId} companyName={companyName} activeTab={route.tab} onTabChange={(tab) => navigate(`/dashboard/${tab}`)} onOpenChat={() => navigate('/chat', defaultChatCompanyId)} onChooseStore={openGeneralPortal} />}
    </div>
  )
}
