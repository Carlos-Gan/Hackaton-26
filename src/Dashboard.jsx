import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, increment, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, db, firebaseConfigured } from './firebase.js'

const companyId = import.meta.env.VITE_COMPANY_ID
const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
const workflow = ['Por validar pago', 'En preparación', 'Listo para entrega', 'Entregado']

function clean(value = '') {
  return value.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function stateOf(order) {
  const state = clean(order.estado || '')
  if (state.includes('entregad')) return workflow[3]
  if (state.includes('listo')) return workflow[2]
  if (state.includes('prepar') || state.includes('validado') || state.includes('confirmado')) return workflow[1]
  return workflow[0]
}

function timeOf(value) {
  if (!value) return 'Horario por confirmar'
  let date
  if (typeof value === 'string') {
    const localDateTime = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
    if (!localDateTime) return value
    date = new Date(Number(localDateTime[1]), Number(localDateTime[2]) - 1, Number(localDateTime[3]), Number(localDateTime[4]), Number(localDateTime[5]))
  } else {
    date = value.toDate?.() || new Date(value)
  }
  const time = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' }).format(date)
  const day = date.toDateString() === new Date().toDateString()
    ? 'Hoy'
    : new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(date)
  return `${day}, ${time}`
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function deliveryDayKey(order) {
  const value = order.entrega
  if (typeof value === 'string') {
    const datePart = value.match(/^(\d{4}-\d{2}-\d{2})/)
    if (datePart) return datePart[1]
    const base = order.creadoEn?.toDate?.() || new Date()
    if (clean(value).includes('manana')) base.setDate(base.getDate() + 1)
    return dateKey(base)
  }
  if (value?.toDate) return dateKey(value.toDate())
  return dateKey(order.creadoEn?.toDate?.() || new Date())
}

function deliveryClock(order) {
  if (typeof order.entrega === 'string') {
    const timePart = order.entrega.match(/T(\d{2}:\d{2})$/)
    if (timePart) return timePart[1]
  }
  return timeOf(order.entrega).split(',').at(-1).trim()
}

function clockMinutes(order) {
  const clock = deliveryClock(order)
  const twentyFourHour = clock.match(/^(\d{1,2}):(\d{2})$/)
  if (twentyFourHour) return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2])
  const twelveHour = clock.match(/(\d{1,2}):(\d{2})\s*(a|p)\.?\s*m/i)
  if (!twelveHour) return 0
  let hour = Number(twelveHour[1]) % 12
  if (twelveHour[3].toLowerCase() === 'p') hour += 12
  return hour * 60 + Number(twelveHour[2])
}

function orderItems(order) {
  return (order.productos || []).map((item) => { const custom = item.personalizacion; const details = custom ? [custom.ocasion, custom.tamano, custom.sabor, custom.relleno, custom.decoracion, custom.diseno && 'Diseño: ' + custom.diseno, custom.mensaje && 'Texto: ' + custom.mensaje].filter(Boolean).join(' / ') : ''; return `${item.cantidad || 1}x ${item.nombre || 'Producto'}${details ? ' (' + details + ')' : ''}` }).join(', ') || 'Sin detalle de productos'
}

function orderTotalText(order) {
  return clean(order.estado || '').includes('cotiz') ? 'Por cotizar' : `${money.format(Number(order.total) || 0)} MXN`
}

function orderFolio(order) {
  return String(order.folio || order.numeroPedido || order.id.slice(-6).toUpperCase())
}

function CakeMark() {
  return <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#087d60] text-white sm:size-14"><svg viewBox="0 0 32 32" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 18h22l-2 10H7L5 18Z"/><path d="M4 17c0-1.7 1.3-3 3-3h18c1.7 0 3 1.3 3 3v2H4v-2Z"/><path d="M10 13c-1-3 1-5 3-5 0 2 2 2 3 2 2 0 4 1 4 3"/></svg></span>
}

function OrderCard({ order, onStatus, onTicket }) {
  const stage = stateOf(order)
  const pending = stage === workflow[0]
  const invalid = clean(order.estado || '').includes('duplic') || clean(order.estado || '').includes('error')
  return (
    <article className={`rounded-2xl border bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,.03)] ${invalid ? 'border-rose-300' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between text-xs font-semibold text-slate-500"><span>#{orderFolio(order)}</span><span className="text-base leading-none text-slate-400">≡</span></div>
      <h4 className="mt-2 text-[15px] font-semibold text-slate-900">{order.cliente || 'Cliente'}</h4>
      <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-emerald-700"><span aria-hidden="true">◷</span>{timeOf(order.entrega)}</p>
      <p className="mt-2 min-h-9 text-xs leading-relaxed text-slate-600">{orderItems(order)}</p>
      <div className={`mt-2 rounded-lg px-2.5 py-2 text-[11px] font-medium ${invalid ? 'bg-rose-50 text-rose-700' : pending ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>
        {invalid ? 'Comprobante por revisar' : clean(order.estado || '').includes('cotiz') ? 'Pastel personalizado ? precio por confirmar' : pending ? '◷  Anticipo pendiente de validar' : `✓  ${order.estado || 'Pago validado'}${order.anticipo ? ` (${money.format(order.anticipo)})` : ''}`}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <strong className="text-sm font-bold text-slate-900">{orderTotalText(order)}</strong>
        <button onClick={() => onTicket(order)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">▤ Ver ticket</button>
      </div>
      {stage !== workflow[3] && <label className="mt-3 block"><span className="sr-only">Cambiar estado</span><select value={stage} onChange={(event) => onStatus(order, event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] text-slate-500 outline-none focus:border-emerald-600">{workflow.map((status) => <option key={status}>{status}</option>)}</select></label>}
    </article>
  )
}

function WeeklyPlanner({ orders }) {
  const [selectedDay, setSelectedDay] = useState(dateKey(new Date()))
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() + index)
    const key = dateKey(date)
    return {
      date,
      key,
      label: new Intl.DateTimeFormat('es-MX', { weekday: 'short' }).format(date).replace('.', ''),
      number: new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(date),
      count: orders.filter((order) => deliveryDayKey(order) === key).length,
    }
  })
  const selectedOrders = orders
    .filter((order) => deliveryDayKey(order) === selectedDay)
    .sort((a, b) => clockMinutes(a) - clockMinutes(b))
  const selectedLabel = days.find((day) => day.key === selectedDay)

  return <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-bold text-slate-900">Agenda semanal</h3><p className="mt-0.5 text-[10px] text-slate-500">Entregas de hoy y los próximos seis días</p></div><span className="text-[10px] font-medium text-slate-500">{selectedOrders.length} {selectedOrders.length === 1 ? 'pedido' : 'pedidos'} · {selectedLabel?.number}</span></div>
    <div className="mt-3 grid grid-cols-7 gap-1.5 sm:gap-2">{days.map((day, index) => <button key={day.key} onClick={() => setSelectedDay(day.key)} aria-pressed={selectedDay === day.key} className={`min-w-0 rounded-xl border px-1 py-2 text-center transition sm:px-2 ${selectedDay === day.key ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'}`}><span className={`block truncate text-[9px] font-semibold uppercase sm:text-[10px] ${selectedDay === day.key ? 'text-emerald-50' : 'text-slate-500'}`}>{index === 0 ? 'Hoy' : day.label}</span><span className="mt-0.5 block truncate text-[10px] font-bold sm:text-xs">{day.number}</span><span className={`mx-auto mt-1 grid size-4 place-items-center rounded-full text-[9px] font-bold sm:size-5 sm:text-[10px] ${selectedDay === day.key ? 'bg-white/20 text-white' : day.count ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'}`}>{day.count}</span></button>)}</div>
    <div className="mt-3 border-t border-slate-100 pt-3">
      {selectedOrders.length ? <div className="flex gap-2 overflow-x-auto pb-1">{selectedOrders.map((order) => <article key={order.id} className="min-w-[190px] max-w-[260px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-bold text-emerald-800">{deliveryClock(order)}</span><span className="text-[9px] font-semibold text-slate-400">#{orderFolio(order)}</span></div><p className="mt-1 truncate text-xs font-semibold text-slate-800">{order.cliente || 'Cliente'}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{orderItems(order)}</p></article>)}</div> : <p className="py-1 text-center text-[10px] text-slate-400">No hay entregas programadas para este día.</p>}
    </div>
  </section>
}

function StockItem({ product, canEdit, onChange, onEdit, forecast }) {
  const madeToOrder = product.modoVenta === 'bajoPedido'
  const stock = Number(product.stock) || 0
  const max = Number(product.stockMaximo) || Math.max(stock, 24)
  const percentage = Math.min((stock / max) * 100, 100)
  const alert = stock <= 2 ? { text: 'Stock critico', cls: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' } : stock <= 5 ? { text: 'Por agotarse', cls: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500' } : { text: 'Disponible', cls: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' }
  return <div className="border-t border-slate-100 py-4 first:border-0 first:pt-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-700">{product.nombre}</p><p className="mt-2 w-fit rounded-md px-2 py-1 text-[10px] font-medium"><span className={madeToOrder ? 'rounded-md bg-violet-50 px-2 py-1 text-violet-800' : alert.cls + ' rounded-md px-2 py-1'}>{madeToOrder ? 'Se prepara bajo pedido' : alert.text}</span></p>{madeToOrder && <p className="mt-1 text-[10px] text-slate-500">Anticipacion minima: {Number(product.anticipacionDias) || 2} dias</p>}{canEdit && <button onClick={() => onEdit(product)} className="mt-2 text-[10px] font-semibold text-emerald-800 hover:underline">Editar producto</button>}</div>{!madeToOrder && <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200"><button disabled={!canEdit || stock <= 0} onClick={() => onChange(product, -1)} aria-label={'Restar stock a ' + product.nombre} className="grid size-9 place-items-center text-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40">-</button><button disabled={!canEdit} onClick={() => onChange(product, 1)} aria-label={'Sumar stock a ' + product.nombre} className="grid size-9 place-items-center border-l border-slate-200 text-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40">+</button></div>}</div>{!madeToOrder && <><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={'h-full rounded-full ' + alert.bar} style={{ width: percentage + '%' }} /></div><p className="mt-1.5 text-[10px] text-slate-500">{stock} {product.unidad || 'pzas'} disponibles</p>{forecast && <p className={'mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed ' + forecast.tone}>{forecast.message}</p>}</>}</div>
}
function Login({ companyName }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  async function login(event) {
    event.preventDefault()
    setLoginError('')
    try { await signInWithEmailAndPassword(auth, email, password) }
    catch { setLoginError('No se pudo iniciar sesión. Revisa tu correo y contraseña.') }
  }
  return <main className="mx-auto w-full max-w-md px-5 py-12 sm:py-20"><p className="text-sm font-medium text-emerald-800">Panel de {companyName}</p><h1 className="mt-2 text-3xl font-bold text-slate-900">Inicia sesión</h1><p className="mt-2 text-sm text-slate-500">Acceso exclusivo al equipo del negocio.</p><form onSubmit={login} className="mt-7 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><label className="block text-sm font-medium text-slate-700">Correo<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label><label className="block text-sm font-medium text-slate-700">Contraseña<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>{loginError && <p role="alert" className="text-sm text-rose-700">{loginError}</p>}<button className="w-full rounded-lg bg-[#087d60] px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900">Entrar al dashboard</button></form></main>
}

function ProductDialog({ product, onClose, onSave, saving, error }) {
  const editing = Boolean(product)
  const [name, setName] = useState(product?.nombre || '')
  const [price, setPrice] = useState(product?.precio ?? '')
  const [stock, setStock] = useState(product?.stock ?? '')
  const [unit, setUnit] = useState(product?.unidad || 'pzas')
  const [mode, setMode] = useState(product?.modoVenta || 'inventario')
  const [leadDays, setLeadDays] = useState(product?.anticipacionDias || 2)
  const [formError, setFormError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (!name.trim() || Number(price) <= 0 || (mode === 'inventario' && !editing && Number(stock) < 0)) {
      setFormError('Escribe nombre, precio valido y existencias correctas.')
      return
    }
    setFormError('')
    const values = { nombre: name.trim(), precio: Number(price), modoVenta: mode, anticipacionDias: mode === 'bajoPedido' ? Math.max(1, Number(leadDays) || 2) : 0 }
    if (!editing) Object.assign(values, { stock: mode === 'bajoPedido' ? 0 : Number(stock), stockMaximo: Math.max(Number(stock) || 1, 1), unidad: unit, activo: true, creadoEn: serverTimestamp() })
    await onSave(values)
  }
  return <div role="presentation" onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-label={editing ? 'Editar producto' : 'Agregar producto'} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold text-slate-900">{editing ? 'Editar producto' : 'Nuevo producto'}</h2><p className="mt-1 text-sm text-slate-500">Configura el catalogo y su forma de venta.</p></div><button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600">?</button></div><form onSubmit={submit} className="mt-5 space-y-4"><label className="block text-sm font-medium text-slate-700">Nombre<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Pastel personalizado" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700">Precio base (MXN)<input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700">Modalidad<select value={mode} onChange={(event) => setMode(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="inventario">Producto con stock disponible</option><option value="bajoPedido">Preparar bajo pedido</option></select></label>{mode === 'bajoPedido' ? <label className="block text-sm font-medium text-slate-700">Anticipacion minima (dias)<input required type="number" min="1" max="60" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /><span className="mt-1 block text-xs font-normal text-slate-500">Los clientes podran elegir entrega a partir de ese plazo.</span></label> : <>{!editing && <label className="block text-sm font-medium text-slate-700">Existencias<input required type="number" min="0" step="1" value={stock} onChange={(event) => setStock(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>}<label className="block text-sm font-medium text-slate-700">Unidad<select value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="pzas">Piezas</option><option value="docenas">Docenas</option><option value="kg">Kilogramos</option><option value="litros">Litros</option></select></label></>}{(formError || error) && <p role="alert" className="text-sm text-rose-700">{formError || error}</p>}<button disabled={saving} className="w-full rounded-xl bg-[#087d60] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar producto'}</button></form></section></div>
}
export default function Dashboard({ companyName, activeTab, onTabChange, onOpenChat }) {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const stockValues = useRef(new Map())
  const [user, setUser] = useState(null)
  const [isMember, setIsMember] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [accessLoading, setAccessLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('today')
  const [targetDays, setTargetDays] = useState(14)
  const [ticket, setTicket] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!auth) { setAuthReady(true); return }
    return onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthReady(true) })
  }, [])

  useEffect(() => {
    if (!db || !user || !companyId) { setIsMember(false); setIsOwner(false); return }
    let active = true
    setAccessLoading(true)
    getDoc(doc(db, 'empresas', companyId, 'miembros', user.uid)).then((member) => {
      if (!active) return
      setIsMember(member.exists())
      setIsOwner(member.data()?.rol === 'owner')
      setAccessLoading(false)
    }).catch(() => {
      if (active) { setError('No se pudo verificar tu acceso en Firestore.'); setAccessLoading(false) }
    })
    return () => { active = false }
  }, [user])

  useEffect(() => {
    if (!db || !isMember || !companyId) return
    const base = ['empresas', companyId]
    const stopOrders = onSnapshot(query(collection(db, ...base, 'pedidos'), orderBy('creadoEn', 'desc')), (snapshot) => {
      setOrders(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
      setError('')
    }, () => setError('No se pudieron cargar los pedidos. Revisa las reglas de Firestore.'))
    const stopProducts = onSnapshot(collection(db, ...base, 'productos'), (snapshot) => {
      const nextProducts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
      nextProducts.forEach((item) => stockValues.current.set(item.id, Number(item.stock) || 0))
      setProducts(nextProducts)
    }, (firestoreError) => setError(`No se pudo cargar el inventario (${firestoreError.code || 'error'}). Revisa la regla de lectura de productos.`))
    return () => { stopOrders(); stopProducts() }
  }, [isMember])

  const now = new Date()
  const todayOrders = orders.filter((order) => {
    const date = order.creadoEn?.toDate?.()
    return date && date.toDateString() === now.toDateString()
  })
  const validatedRevenue = todayOrders.filter((order) => stateOf(order) !== workflow[0]).reduce((sum, order) => sum + (Number(order.total) || 0), 0)
  const lowStock = products.filter((product) => product.modoVenta !== 'bajoPedido' && Number(product.stock) <= 5)
  const forecastProducts = products.filter((product) => product.modoVenta !== 'bajoPedido')
  const forecastByProduct = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const sales = new Map()
    for (const order of orders) {
      const date = order.creadoEn?.toDate?.()
      if (!date || date.getTime() < cutoff || stateOf(order) === workflow[0] || clean(order.estado || '').includes('cancel')) continue
      for (const item of order.productos || []) {
        if (!item.productoId) continue
        const record = sales.get(item.productoId) || { units: 0, days: new Set(), weeklyUnits: [0, 0, 0, 0] }
        const quantity = Number(item.cantidad) || 0
        record.units += quantity
        record.days.add(date.toDateString())
        const weekIndex = Math.floor((Date.now() - date.getTime()) / (7 * 24 * 60 * 60 * 1000))
        if (weekIndex >= 0 && weekIndex < 4) record.weeklyUnits[3 - weekIndex] += quantity
        sales.set(item.productoId, record)
      }
    }
    return new Map(products.filter((product) => product.modoVenta !== 'bajoPedido').map((product) => {
      const record = sales.get(product.id)
      const units = record?.units || 0
      const salesDays = record?.days.size || 0
      const dailyRate = units / 30
      const stock = Number(product.stock) || 0
      const daysLeft = units && dailyRate ? Math.floor(stock / dailyRate) : null
      const weeklyUnits = record?.weeklyUnits || [0, 0, 0, 0]
      if (!units) return [product.id, { units30: 0, salesDays: 0, weeklyUnits, dailyRate: 0, daysLeft: null, restock: null, confidence: 'Sin datos', message: 'Sin ventas validadas en los últimos 30 días.', tone: 'bg-slate-50 text-slate-500' }]
      if (salesDays < 4) return [product.id, { units30: units, salesDays, weeklyUnits, dailyRate, daysLeft: null, restock: null, confidence: 'Datos iniciales', message: `Aún hay pocos datos: ${units} ${product.unidad || 'pzas'} vendidos en ${salesDays} días.`, tone: 'bg-slate-50 text-slate-600' }]
      const daysTarget = targetDays
      const restock = Math.max(0, Math.ceil(dailyRate * daysTarget - stock))
      const tone = daysLeft <= 7 ? 'bg-rose-50 text-rose-700' : daysLeft <= daysTarget ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'
      const coverage = daysLeft <= daysTarget ? ` · Reponer ${restock} para cubrir ${daysTarget} días.` : ''
      const confidence = salesDays >= 10 ? 'Estable' : 'Moderada'
      return [product.id, { units30: units, salesDays, weeklyUnits, dailyRate, daysLeft, restock, confidence, message: `Pronóstico: ~${daysLeft} días de stock al ritmo de ${dailyRate.toFixed(1)}/día${coverage}`, tone }]
    }))
  }, [orders, products, targetDays])
  const filteredOrders = useMemo(() => {
    const needle = clean(search).replace(/^#\s*/, '')
    const minDate = new Date()
    if (period === 'today') minDate.setHours(0, 0, 0, 0)
    if (period === 'week') minDate.setDate(minDate.getDate() - 7)
    return orders.filter((order) => {
      const searchText = clean(`${order.cliente || ''} ${order.id} ${order.id.slice(-6)} ${order.id.slice(-3)} ${order.folio || ''} ${order.numeroPedido || ''}`)
      const matchesSearch = !needle || searchText.includes(needle)
      if (!matchesSearch) return false
      if (needle) return true
      if (period === 'all') return true
      const date = order.creadoEn?.toDate?.()
      return date && date >= minDate
    })
  }, [orders, search, period])

  async function changeStatus(order, status) {
    try {
      await updateDoc(doc(db, 'empresas', companyId, 'pedidos', order.id), { estado: status })
      setToast('Estado del pedido actualizado')
      setTimeout(() => setToast(''), 2200)
    } catch { setError('No se pudo actualizar el pedido. Revisa las reglas de Firestore.') }
  }

  async function changeStock(product, delta) {
    const current = stockValues.current.get(product.id) ?? (Number(product.stock) || 0)
    const next = current + delta
    if (next < 0) return
    stockValues.current.set(product.id, next)
    setProducts((items) => items.map((item) => item.id === product.id ? { ...item, stock: next } : item))
    try {
      await updateDoc(doc(db, 'empresas', companyId, 'productos', product.id), { stock: increment(delta) })
      setToast('Inventario actualizado')
      setTimeout(() => setToast(''), 1800)
    } catch {
      const rolledBack = Math.max(0, (stockValues.current.get(product.id) ?? next) - delta)
      stockValues.current.set(product.id, rolledBack)
      setProducts((items) => items.map((item) => item.id === product.id ? { ...item, stock: rolledBack } : item))
      setError('No se pudo actualizar el stock. Verifica que tu miembro tenga rol owner.')
    }
  }

  async function saveProduct(productValues) {
    setCreating(true)
    setError('')
    if (editingProduct) {
      const product = editingProduct
      setProducts((items) => items.map((item) => item.id === product.id ? { ...item, ...productValues } : item))
      try {
        await updateDoc(doc(db, 'empresas', companyId, 'productos', product.id), productValues)
        setEditingProduct(null)
        setToast('Producto actualizado')
        setTimeout(() => setToast(''), 2200)
      } catch {
        setProducts((items) => items.map((item) => item.id === product.id ? product : item))
        setError('No se pudo actualizar el producto. Verifica que tu miembro tenga rol owner y que las reglas estén publicadas.')
      } finally { setCreating(false) }
      return
    }

    const productRef = doc(collection(db, 'empresas', companyId, 'productos'))
    const optimisticProduct = { id: productRef.id, ...productValues, creadoEn: new Date() }
    stockValues.current.set(productRef.id, Number(productValues.stock) || 0)
    setProducts((items) => [optimisticProduct, ...items])
    try {
      await setDoc(productRef, productValues)
      setCreateOpen(false)
      setToast('Producto agregado al inventario')
      setTimeout(() => setToast(''), 2200)
    } catch {
      stockValues.current.delete(productRef.id)
      setProducts((items) => items.filter((item) => item.id !== productRef.id))
      setError('No se pudo crear el producto. Verifica que tu miembro tenga rol owner y que las reglas estén publicadas.')
    } finally { setCreating(false) }
  }

  if (!firebaseConfigured || !companyId) return <main className="mx-auto max-w-2xl px-5 py-12"><h1 className="text-3xl font-bold">Configura Firebase</h1><p className="mt-3 text-sm text-slate-600">Completa Firebase y VITE_COMPANY_ID en .env.local.</p></main>
  if (!authReady) return <main className="px-6 py-16 text-sm text-slate-500">Verificando sesión…</main>
  if (!user) return <Login companyName={companyName} />
  if (accessLoading) return <main className="px-6 py-16 text-sm text-slate-500">Verificando acceso al negocio…</main>
  if (!isMember) return <main className="mx-auto max-w-2xl px-5 py-12"><h1 className="text-3xl font-bold">Acceso pendiente</h1><p className="mt-3 text-sm text-slate-600">Agrega un documento con este ID en <code>empresas/{companyId}/miembros</code>:</p><code className="mt-3 block break-all rounded-lg bg-slate-100 p-3 text-xs">{user.uid}</code><button onClick={() => signOut(auth)} className="mt-5 text-sm font-medium text-emerald-800">Cerrar sesión</button></main>

  const dateText = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now)
  const searched = filteredOrders
  const columns = workflow.map((status) => ({ status, orders: searched.filter((order) => stateOf(order) === status) }))

  return (
    <div className="min-h-[calc(100vh-76px)] bg-[#f5f8fb] text-slate-800">
      <header className="border-b border-slate-200 bg-white px-5 py-5 lg:px-8">
        <div className="mx-auto grid w-full max-w-[1800px] items-center gap-x-6 gap-y-5 lg:grid-cols-2 xl:grid-cols-[minmax(330px,1.1fr)_minmax(480px,1.5fr)_minmax(270px,1fr)]">
          <div className="flex min-w-0 items-center gap-4"><CakeMark /><div className="min-w-0"><h1 className="text-xl font-bold leading-tight tracking-tight text-slate-900 2xl:text-2xl">{companyName}</h1><span className="mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800"><i className="size-2 rounded-full bg-emerald-500" />Bot de WhatsApp Activo</span></div></div>
          <div className="grid min-w-0 grid-cols-3 divide-x divide-slate-200">
            <div className="min-w-0 px-2 sm:px-3"><p className="text-xs text-slate-500 sm:text-sm">Pedidos hoy</p><p className="mt-1 text-xl font-bold text-slate-900 xl:text-2xl 2xl:text-3xl">{todayOrders.length}</p></div>
            <div className="min-w-0 px-2 sm:px-3"><p className="text-xs text-slate-500 sm:text-sm">Ingresos validados</p><p className="mt-1 break-words text-lg font-bold leading-tight text-emerald-700 xl:text-2xl 2xl:text-3xl">{money.format(validatedRevenue)} MXN</p></div>
            <div className="min-w-0 px-2 sm:px-3"><p className="text-xs text-slate-500 sm:text-sm">Insumos bajos</p><p className="mt-1 text-xl font-bold text-amber-700 xl:text-2xl 2xl:text-3xl">{lowStock.length}</p></div>
          </div>
          <label className="relative min-w-0 lg:col-span-2 xl:col-span-1"><span className="sr-only">Buscar pedidos</span><svg viewBox="0 0 24 24" className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente o n.º de orden" className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-12 pr-4 text-sm outline-none placeholder:text-slate-500 focus:border-emerald-600" /></label>
        </div>
      </header>

      <nav className="border-b border-slate-200 bg-white px-5 lg:px-8"><div className="mx-auto flex max-w-[1800px] items-center gap-7 overflow-x-auto">
        {[['live', '▦', 'Operación en vivo'], ['history', '◷', 'Historial de pedidos'], ['inventory', '▤', 'Inventario'], ['forecast', '↗', 'Pronóstico']].map(([key, icon, label]) => <button key={key} onClick={() => onTabChange(key)} className={`relative flex h-14 shrink-0 items-center gap-3 text-sm font-semibold ${activeTab === key ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-800'}`}><span className="text-lg">{icon}</span>{label}{activeTab === key && <i className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-emerald-700" />}</button>)}
        <span className="ml-auto hidden shrink-0 items-center gap-2 py-4 text-sm text-slate-500 sm:flex">▦ <span className="capitalize">{dateText}</span></span>
        <button onClick={onOpenChat} className="ml-auto shrink-0 py-4 text-xs font-medium text-emerald-700 hover:text-emerald-900 sm:ml-0">Abrir chat</button>
        <button onClick={() => signOut(auth)} className="shrink-0 py-4 text-xs font-medium text-slate-500 hover:text-slate-900">Cerrar sesión</button>
      </div></nav>

      <main className="mx-auto max-w-[1800px] px-5 py-6 lg:px-8 lg:py-8">
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {activeTab === 'live' && <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="min-w-0">
            <WeeklyPlanner orders={orders} />
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><div className="flex flex-wrap items-center gap-4"><h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Tablero de Pedidos en Vivo</h2><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">● En vivo</span></div><p className="mt-2 text-sm text-slate-500">Cada pedido en su lugar. Todo bajo control.</p></div><label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-500">◷<select value={period} onChange={(event) => setPeriod(event.target.value)} className="bg-transparent outline-none"><option value="today">Todo el día</option><option value="week">Últimos 7 días</option><option value="all">Todo el historial</option></select></label></div>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">{columns.map(({ status, orders: columnOrders }) => <section key={status} className="min-w-0 rounded-2xl border border-slate-200 bg-[#eff4f9] p-2.5 sm:p-3"><header className="flex items-center justify-between px-1 py-2"><h3 className="flex items-center gap-2 text-xs font-semibold text-slate-700 sm:text-sm"><i className={`size-2 rounded-full ${status === workflow[0] ? 'bg-amber-500' : status === workflow[1] ? 'bg-blue-500' : status === workflow[2] ? 'bg-emerald-500' : 'bg-slate-400'}`} />{status}</h3><span className={`grid size-7 place-items-center rounded-lg text-xs font-semibold ${status === workflow[0] ? 'bg-amber-100 text-amber-800' : status === workflow[1] ? 'bg-blue-100 text-blue-800' : status === workflow[2] ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{columnOrders.length}</span></header><div className="space-y-2.5">{columnOrders.map((order) => <OrderCard key={order.id} order={order} onStatus={changeStatus} onTicket={setTicket} />)}{columnOrders.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-6 text-center text-xs text-slate-400">Sin pedidos</p>}</div></section>)}</div>
          </section>
          <InventoryPanel products={products} canEdit={isOwner} onChange={changeStock} forecastByProduct={forecastByProduct} onCreate={() => { setError(''); setCreateOpen(true) }} onEdit={(product) => { setError(''); setEditingProduct(product) }} />
        </div>}

        {activeTab === 'history' && <section><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-900">Historial de pedidos</h2><p className="mt-1 text-sm text-slate-500">Todos los pedidos de {companyName}.</p></div><span className="text-sm text-slate-500">{filteredOrders.length} resultados</span></div><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Orden</th><th className="px-5 py-3">Cliente</th><th className="px-5 py-3">Productos</th><th className="px-5 py-3">Entrega</th><th className="px-5 py-3">Total</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{filteredOrders.map((order) => <tr key={order.id}><td className="px-5 py-4 font-semibold">#{order.id.slice(-6).toUpperCase()}</td><td className="px-5 py-4">{order.cliente || 'Cliente'}</td><td className="max-w-xs truncate px-5 py-4 text-slate-500">{orderItems(order)}</td><td className="px-5 py-4">{timeOf(order.entrega)}</td><td className="px-5 py-4 font-semibold">{orderTotalText(order)}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{order.estado}</span></td><td className="px-5 py-4"><button onClick={() => setTicket(order)} className="text-xs font-semibold text-emerald-800">Ver ticket</button></td></tr>)}</tbody></table>{filteredOrders.length === 0 && <p className="p-12 text-center text-sm text-slate-500">No hay pedidos para mostrar.</p>}</div></div></section>}

        {activeTab === 'inventory' && <section><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-900">Inventario</h2><p className="mt-1 text-sm text-slate-500">Existencias y estimación según pedidos validados de los últimos 30 días.</p></div>{isOwner && <button onClick={() => { setError(''); setCreateOpen(true) }} className="rounded-xl bg-[#087d60] px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900">＋ Agregar producto</button>}</div><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{products.map((product) => <div key={product.id} className="rounded-2xl border border-slate-200 bg-white p-5"><StockItem product={product} canEdit={isOwner} onChange={changeStock} onEdit={setEditingProduct} forecast={forecastByProduct.get(product.id)} /><p className="mt-2 text-xs text-slate-500">{money.format(Number(product.precio) || 0)} por unidad</p></div>)}</div>{products.length === 0 && <p className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">Agrega productos a la subcolección productos de esta empresa.</p>}</section>}

        {activeTab === 'forecast' && <ForecastView products={forecastProducts} forecastByProduct={forecastByProduct} targetDays={targetDays} onTargetDaysChange={setTargetDays} />}
      </main>
      <footer className="mx-auto flex max-w-[1800px] items-center justify-between px-5 pb-5 text-xs text-slate-500 lg:px-8"><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-emerald-500" />Todos los cambios guardados</span><span className="hidden sm:block">Sincronización en tiempo real · {companyName}</span></footer>

      {toast && <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg">{toast}</div>}
      {activeTab === 'live' && <button onClick={() => setCreateOpen(true)} className="fixed bottom-6 right-6 z-30 rounded-full bg-[#087d60] px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-900 2xl:hidden">＋ Producto</button>}
      {(createOpen || editingProduct) && isOwner && <ProductDialog product={editingProduct} onClose={() => { setCreateOpen(false); setEditingProduct(null); setError('') }} onSave={saveProduct} saving={creating} error={error} />}
      {ticket && <div role="presentation" onClick={() => setTicket(null)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-label="Detalle del pedido" onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-emerald-700">{companyName}</p><h2 className="mt-1 text-xl font-bold">Pedido #{ticket.id.slice(-6).toUpperCase()}</h2></div><button onClick={() => setTicket(null)} className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600">×</button></div><div className="mt-5 space-y-3 text-sm"><p><span className="text-slate-500">Cliente:</span> {ticket.cliente || 'Pedido por chat'}</p><p><span className="text-slate-500">Entrega:</span> {timeOf(ticket.entrega)}</p><div className="border-y border-dashed border-slate-200 py-3"><p className="mb-2 text-slate-500">Productos</p><p>{orderItems(ticket)}</p></div><p className="flex justify-between text-base font-bold"><span>{clean(ticket.estado || '').includes('cotiz') ? 'Precio' : 'Total'}</span><span>{orderTotalText(ticket)}</span></p><p className="text-slate-500">Estado: {ticket.estado || 'Pendiente de pago'}</p></div><button onClick={() => setTicket(null)} className="mt-5 w-full rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white">Cerrar</button></section></div>}
    </div>
  )
}

function ForecastView({ products, forecastByProduct, targetDays, onTargetDaysChange }) {
  const [selectedProductId, setSelectedProductId] = useState('')
  const rows = products.map((product) => ({ product, forecast: forecastByProduct.get(product.id) }))
  const usable = rows.filter(({ forecast }) => forecast?.daysLeft !== null && forecast?.daysLeft !== undefined)
  const urgent = usable.filter(({ forecast }) => forecast.daysLeft <= 7)
  const replenishment = usable.filter(({ forecast }) => forecast.restock > 0).sort((a, b) => a.forecast.daysLeft - b.forecast.daysLeft)
  const insufficient = rows.filter(({ forecast }) => !forecast || forecast.daysLeft === null).length
  const sorted = [...rows].sort((a, b) => (a.forecast?.daysLeft ?? Infinity) - (b.forecast?.daysLeft ?? Infinity))
  const selectedProduct = products.find((product) => product.id === selectedProductId) || products[0]
  const selectedForecast = selectedProduct ? forecastByProduct.get(selectedProduct.id) : null
  const weeklySales = selectedForecast?.weeklyUnits || [0, 0, 0, 0]
  const maxWeeklySales = Math.max(...weeklySales, 1)

  useEffect(() => {
    if (!products.some((product) => product.id === selectedProductId) && products[0]) setSelectedProductId(products[0].id)
  }, [products, selectedProductId])

  return <section>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-emerald-800">Planeación de inventario</p><h2 className="mt-1 text-2xl font-bold text-slate-900 sm:text-3xl">Pronóstico de productos</h2><p className="mt-2 text-sm text-slate-500">Proyección basada en pedidos con pago validado durante los últimos 30 días.</p></div><label className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-4 py-3"><span className="flex items-center justify-between gap-3 text-xs font-medium text-slate-600"><span>Cobertura objetivo al reponer</span><strong className="text-sm text-emerald-800">{targetDays} días</strong></span><input type="range" min="7" max="30" value={targetDays} onChange={(event) => onTargetDaysChange(Number(event.target.value))} className="mt-2 w-full accent-emerald-700" /></label></div>

    <div className="mt-6 grid gap-3 sm:grid-cols-3">
      <MetricCard label="Productos en riesgo" value={urgent.length} tone="text-rose-700" />
      <MetricCard label="Reposiciones sugeridas" value={replenishment.length} tone="text-amber-700" />
      <MetricCard label="Necesitan más historial" value={insufficient} tone="text-slate-500" />
    </div>

    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Ventas por semana</h3><p className="mt-1 text-xs text-slate-500">Tendencia reciente del producto seleccionado</p></div><select value={selectedProduct?.id || ''} onChange={(event) => setSelectedProductId(event.target.value)} className="max-w-52 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-emerald-600">{products.map((product) => <option key={product.id} value={product.id}>{product.nombre}</option>)}</select></div>
        {selectedProduct ? <div role="img" aria-label={`Ventas semanales de ${selectedProduct.nombre}`} className="mt-5 grid h-44 grid-cols-4 items-end gap-3 border-b border-slate-100 px-2 sm:gap-6">{weeklySales.map((amount, index) => <div key={index} className="flex h-full flex-col items-center justify-end gap-2"><span className="text-[10px] font-semibold text-slate-500">{amount || ''}</span><div className="flex h-32 w-full items-end justify-center rounded-t-lg bg-slate-50"><div className={`w-3/5 min-w-5 rounded-t-md transition-all ${index === 3 ? 'bg-emerald-600' : 'bg-emerald-300'}`} style={{ height: `${amount ? Math.max(8, (amount / maxWeeklySales) * 100) : 3}%` }} /></div><span className="whitespace-nowrap text-[9px] text-slate-500">{['Hace 3 sem.', 'Hace 2 sem.', 'Semana pasada', 'Esta semana'][index]}</span></div>)}</div> : <p className="mt-6 rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">Agrega productos para comparar sus ventas.</p>}
        <div className="mt-4 flex items-center justify-between text-[10px] text-slate-400"><span>Unidades vendidas</span><span>Pedidos con pago validado</span></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div><h3 className="font-semibold text-slate-900">Recomendaciones de reposición</h3><p className="mt-1 text-xs text-slate-500">Productos que no alcanzan tu cobertura objetivo</p></div><div className="mt-4 space-y-3">{replenishment.slice(0, 5).map(({ product, forecast }) => <article key={product.id} className="rounded-xl border border-amber-100 bg-amber-50/60 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold text-slate-800">{product.nombre}</p><p className="mt-1 text-[10px] text-slate-500">Quedan {Number(product.stock) || 0} · ~{forecast.daysLeft} días</p></div><span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900">+{forecast.restock} {product.unidad || 'pzas'}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full ${forecast.daysLeft <= 7 ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, (forecast.daysLeft / targetDays) * 100)}%` }} /></div></article>)}{!replenishment.length && <div className="rounded-xl bg-emerald-50 p-4 text-xs leading-relaxed text-emerald-800">Todo el inventario con historial suficiente cubre la meta de {targetDays} días.</div>}{insufficient > 0 && <p className="text-[10px] leading-relaxed text-slate-400">{insufficient} producto(s) aún requieren más ventas validadas para estimar su demanda.</p>}</div></section>
    </div>

    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-slate-900">Cobertura estimada por producto</h3><p className="mt-1 text-xs text-slate-500">La barra se llena al alcanzar tu objetivo de {targetDays} días.</p></div><div className="flex gap-3 text-[10px] text-slate-500"><span><i className="mr-1 inline-block size-2 rounded-full bg-rose-500" />Urgente</span><span><i className="mr-1 inline-block size-2 rounded-full bg-amber-500" />Reponer</span><span><i className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />Suficiente</span></div></div><div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">{sorted.map(({ product, forecast }) => { const valid = forecast?.daysLeft !== null && forecast?.daysLeft !== undefined; const fill = valid ? Math.min(100, (forecast.daysLeft / targetDays) * 100) : 0; const bar = !valid ? 'bg-slate-300' : forecast.daysLeft <= 7 ? 'bg-rose-500' : forecast.daysLeft <= targetDays ? 'bg-amber-500' : 'bg-emerald-500'; return <div key={product.id}><div className="mb-1.5 flex items-center justify-between gap-3"><span className="truncate text-xs font-medium text-slate-700">{product.nombre}</span><span className="shrink-0 text-[10px] text-slate-500">{valid ? `~${forecast.daysLeft} días` : forecast?.confidence || 'Sin datos'}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${fill}%` }} /></div></div> })}{!products.length && <p className="text-sm text-slate-500">No hay productos para pronosticar.</p>}</div></section>

    <p className="mt-3 text-xs leading-relaxed text-slate-500">El ritmo diario es el promedio de unidades vendidas en 30 días. Solo se cuentan pedidos con pago validado; se requieren ventas en al menos cuatro días distintos para proyectar cobertura.</p>
  </section>
}

function MetricCard({ label, value, tone }) {
  return <article className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><p className="text-xs font-medium text-slate-500">{label}</p><p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p></article>
}

function InventoryPanel({ products, canEdit, onChange, onCreate, onEdit, forecastByProduct }) {
  const alerts = products.filter((product) => product.modoVenta !== 'bajoPedido' && Number(product.stock) <= 5).length
  return <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:p-6 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:overscroll-contain"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Inventario en Vivo</h2><p className="mt-1.5 text-xs text-slate-500">Stock y pronóstico por ventas validadas (30 días).</p><button disabled={!canEdit} onClick={onCreate} className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:hidden">＋ Agregar producto</button></div><span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${alerts ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>⚠ {alerts} alertas</span></div><div className="mt-5 border-t border-slate-200 pt-4">{products.slice(0, 8).map((product) => <StockItem key={product.id} product={product} canEdit={canEdit} onChange={onChange} onEdit={onEdit} forecast={forecastByProduct.get(product.id)} />)}{products.length === 0 && <p className="py-8 text-center text-xs text-slate-500">Aún no hay productos en el inventario.</p>}</div>{!canEdit && products.length > 0 && <p className="mt-2 text-[10px] text-slate-400">Solicita el rol owner para ajustar existencias.</p>}</aside>
}
