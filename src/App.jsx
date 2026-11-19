import { useEffect, useState } from 'react'
import { collection, doc, getDoc, onSnapshot, orderBy, query } from 'firebase/firestore'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, db, firebaseConfigured } from './firebase.js'
import Chat from './Chat.jsx'

const money = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
})
const companyId = import.meta.env.VITE_COMPANY_ID

function Brand({ companyName }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-2xl bg-[#075e54] text-lg text-white shadow-sm">✿</div>
      <div>
        <p className="font-semibold leading-tight text-stone-900">{companyName}</p>
        <p className="mt-0.5 text-xs text-stone-500">Repostería artesanal</p>
      </div>
    </div>
  )
}

function Dashboard({ companyName }) {
  const [orders, setOrders] = useState([])
  const [connectionError, setConnectionError] = useState('')
  const [user, setUser] = useState(null)
  const [isStaff, setIsStaff] = useState(false)
  const [checkingUser, setCheckingUser] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')

  useEffect(() => {
    if (!auth) { setCheckingUser(false); return }
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser)
      setIsStaff(false)
      if (!currentUser) setCheckingUser(false)
    })
  }, [])

  useEffect(() => {
    if (!db || !user || !companyId) return
    let active = true
    getDoc(doc(db, 'empresas', companyId, 'miembros', user.uid)).then((staffDoc) => {
      if (active) { setIsStaff(staffDoc.exists()); setCheckingUser(false) }
    }).catch(() => {
      if (active) { setConnectionError('No se pudo verificar el acceso del negocio.'); setCheckingUser(false) }
    })
    return () => { active = false }
  }, [user])

  useEffect(() => {
    if (!db || !isStaff || !companyId) return
    const ordersQuery = query(collection(db, 'empresas', companyId, 'pedidos'), orderBy('creadoEn', 'desc'))
    return onSnapshot(ordersQuery, (snapshot) => {
      setOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
      setConnectionError('')
    }, () => setConnectionError('No se pudieron cargar pedidos. Revisa la configuración y reglas de Firestore.'))
  }, [isStaff])

  async function login(event) {
    event.preventDefault()
    setLoginError('')
    try { await signInWithEmailAndPassword(auth, email, password) }
    catch { setLoginError('No se pudo iniciar sesión. Revisa tu correo y contraseña.') }
  }

  if (!firebaseConfigured) return <main className="mx-auto w-full max-w-2xl px-5 py-12"><h1 className="font-display text-3xl font-semibold">Configura Firebase</h1><p className="mt-3 text-sm text-stone-600">Completa las variables de <code>.env.local</code> para abrir el dashboard.</p></main>
  if (checkingUser) return <main className="mx-auto w-full max-w-2xl px-5 py-16 text-sm text-stone-500">Verificando acceso…</main>
  if (!user) return <main className="mx-auto w-full max-w-md px-5 py-12 sm:py-20">
    <p className="text-sm font-medium text-emerald-800">Panel del negocio</p><h1 className="mt-2 font-display text-3xl font-semibold text-stone-900">Inicia sesión</h1><p className="mt-2 text-sm text-stone-500">Acceso exclusivo al equipo de Repostería La Esquina.</p>
    <form onSubmit={login} className="mt-7 space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"><label className="block text-sm font-medium text-stone-700">Correo<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label><label className="block text-sm font-medium text-stone-700">Contraseña<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-stone-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>{loginError && <p role="alert" className="text-sm text-rose-700">{loginError}</p>}<button className="w-full rounded-lg bg-[#075e54] px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900">Entrar al dashboard</button></form>
    <p className="mt-4 text-xs leading-relaxed text-stone-500">Primero crea una cuenta del negocio en Firebase Authentication y autorízala agregando un documento <code>empresas/{companyId}/miembros/{'{UID}'}</code> en Firestore.</p>
  </main>
  if (!isStaff) return <main className="mx-auto w-full max-w-2xl px-5 py-12"><h1 className="font-display text-3xl font-semibold">Acceso pendiente</h1><p className="mt-3 text-sm text-stone-600">Agrega este UID a <code>empresas/{companyId}/miembros</code> para autorizar el dashboard:</p><code className="mt-3 block break-all rounded-lg bg-stone-100 p-3 text-xs">{user.uid}</code><button onClick={() => signOut(auth)} className="mt-5 text-sm font-medium text-emerald-800">Cerrar sesión</button></main>

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-800">Panel de {companyName}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">Pedidos</h1>
          <p className="mt-2 text-sm text-stone-500">Consulta en tiempo real las órdenes que llegan por el chat.</p>
        </div>
        <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
          <span className="mr-3">● Firebase conectado</span><button onClick={() => signOut(auth)} className="underline">Cerrar sesión</button>
        </span>
      </div>

      {!firebaseConfigured && (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <h2 className="font-semibold">Configura Firebase para cargar pedidos</h2>
          <p className="mt-1.5 leading-relaxed text-amber-900">Crea el archivo <code className="rounded bg-white/70 px-1.5 py-0.5">.env.local</code> en la raíz del proyecto con los valores de configuración de tu app web Firebase. Usa las variables documentadas en <code className="rounded bg-white/70 px-1.5 py-0.5">.env.example</code>.</p>
        </section>
      )}

      {connectionError && <p role="alert" className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-800">{connectionError}</p>}

      <section className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
          <div><h2 className="font-semibold text-stone-900">Órdenes recientes</h2><p className="mt-1 text-xs text-stone-500">{orders.length} pedidos registrados</p></div>
          <span className="rounded-lg bg-stone-50 px-2.5 py-1.5 text-xs text-stone-500">Tiempo real</span>
        </div>
        {!firebaseConfigured || orders.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-xl text-emerald-800">⌁</div>
            <p className="mt-4 text-sm font-medium text-stone-800">{firebaseConfigured ? 'Todavía no hay pedidos' : 'Aquí aparecerán tus pedidos'}</p>
            <p className="mt-1 text-xs text-stone-500">Los pedidos nuevos se mostrarán automáticamente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-5 py-3 font-medium">Pedido</th><th className="px-5 py-3 font-medium">Cliente</th><th className="px-5 py-3 font-medium">Entrega</th><th className="px-5 py-3 font-medium">Total</th><th className="px-5 py-3 font-medium">Estado</th></tr></thead><tbody className="divide-y divide-stone-100">{orders.map((order) => <tr key={order.id}><td className="whitespace-nowrap px-5 py-4 font-semibold text-stone-900">#{order.id.slice(-6).toUpperCase()}</td><td className="px-5 py-4 text-stone-700">{order.cliente || 'Cliente'}</td><td className="whitespace-nowrap px-5 py-4 text-stone-600">{order.entrega || 'Por definir'}</td><td className="whitespace-nowrap px-5 py-4 font-medium text-stone-800">{money.format(order.total || 0)}</td><td className="px-5 py-4"><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">{order.estado || 'Pendiente'}</span></td></tr>)}</tbody></table></div>
        )}
      </section>
    </main>
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
    <div className="min-h-screen bg-[#f7f8f6] text-stone-800">
      <header className="flex min-h-[76px] items-center justify-between border-b border-stone-200 bg-white px-5 sm:px-8">
        <Brand companyName={companyName} />
        <nav className="flex items-center gap-1 rounded-xl bg-stone-100 p-1" aria-label="Navegación principal">
          <button onClick={() => setPage('chat')} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${page === 'chat' ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}>Chat</button>
          <button onClick={() => setPage('dashboard')} className={`rounded-lg px-4 py-2 text-sm font-medium transition ${page === 'dashboard' ? 'bg-white text-emerald-900 shadow-sm' : 'text-stone-500 hover:text-stone-800'}`}>Dashboard</button>
        </nav>
      </header>
      {page === 'chat' ? <main className="grid min-h-[calc(100vh-76px)] place-items-center p-0 sm:p-8"><div className="h-[calc(100vh-76px)] w-full overflow-hidden bg-white sm:h-[844px] sm:max-h-[calc(100vh-140px)] sm:w-[390px] sm:rounded-[30px] sm:shadow-[0_24px_80px_rgba(31,41,35,.16)]"><Chat /></div></main> : <Dashboard companyName={companyName} />}
    </div>
  )
}
