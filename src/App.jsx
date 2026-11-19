import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from './firebase.js'
import Chat from './Chat.jsx'
import Dashboard from './Dashboard.jsx'

const companyId = import.meta.env.VITE_COMPANY_ID

function Brand({ companyName }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-2xl bg-[#087d60] text-white shadow-sm" aria-hidden="true">
        <svg viewBox="0 0 32 32" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 18h22l-2 10H7L5 18Z"/><path d="M4 17c0-1.7 1.3-3 3-3h18c1.7 0 3 1.3 3 3v2H4v-2Z"/><path d="M10 13c-1-3 1-5 3-5 0 2 2 2 3 2 2 0 4 1 4 3"/></svg>
      </div>
      <div><p className="font-semibold leading-tight text-stone-900">{companyName}</p><p className="mt-0.5 text-xs text-stone-500">Pastelería artesanal</p></div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('chat')
  const [companyName, setCompanyName] = useState('Pastelería')

  useEffect(() => {
    if (!db || !companyId) return
    return onSnapshot(doc(db, 'empresas', companyId), (snapshot) => {
      if (snapshot.exists()) setCompanyName(snapshot.data().nombre || 'Pastelería')
    })
  }, [])

  return (
    <div className="min-h-screen bg-[#f7f8f6] text-slate-800">
      {page === 'chat' && <header className="flex min-h-[76px] items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8">
        <Brand companyName={companyName} />
        <nav className="flex items-center gap-1 rounded-xl bg-slate-100 p-1" aria-label="Navegación principal">
          <button onClick={() => setPage('chat')} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${page === 'chat' ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Chat</button>
          <button onClick={() => setPage('dashboard')} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${page === 'dashboard' ? 'bg-white text-emerald-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>Dashboard</button>
        </nav>
      </header>}
      {page === 'chat'
        ? <main className="grid min-h-[calc(100vh-76px)] place-items-center p-0 sm:p-8"><div className="h-[calc(100vh-76px)] w-full overflow-hidden bg-white sm:h-[844px] sm:max-h-[calc(100vh-140px)] sm:w-[390px] sm:rounded-[30px] sm:shadow-[0_24px_80px_rgba(31,41,35,.16)]"><Chat /></div></main>
        : <Dashboard companyName={companyName} onOpenChat={() => setPage('chat')} />}
    </div>
  )
}
