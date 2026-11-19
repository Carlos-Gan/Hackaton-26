import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db, firebaseConfigured } from './firebase.js'

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
const companyId = import.meta.env.VITE_COMPANY_ID
const cakeBasePrices = { 'Chico (6 porciones)': 450, 'Mediano (12 porciones)': 700, 'Grande (20 porciones)': 950, 'Extra grande (30 porciones)': 1300 }
const cakeFlavorExtras = { 'Red velvet': 50, 'Especial': 100 }
const cakeFillingExtras = { 'Sin relleno': 0, 'Fruta o mermelada': 50, 'Cajeta o dulce de leche': 50, 'Ganache de chocolate': 80, 'Queso crema': 80 }
const cakeDecorationExtras = { 'Sencilla': 0, 'Tematica': 150, 'Elaborada': 300 }
const localDateValue = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function ProductArt({ kind }) {
  return <div className={`grid h-24 place-items-center overflow-hidden rounded-t-xl ${kind === 'cookies' ? 'bg-[#f2dfbf]' : 'bg-[#f0ddc7]'}`}>
    <span className="text-[52px] drop-shadow-sm" aria-hidden="true">{kind === 'cookies' ? '🍪' : '🍰'}</span>
  </div>
}

export default function Chat({ onOpenDashboard }) {
  const [products, setProducts] = useState([])
  const [companyName, setCompanyName] = useState('Pastelería')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cart, setCart] = useState({})
  const [orderMode, setOrderMode] = useState('choose')
  const [customCake, setCustomCake] = useState({ ocasion: '', tamano: '', sabor: '', relleno: 'Sin relleno', decoracion: 'Sencilla', diseno: '', mensaje: '' })
  const [customizations, setCustomizations] = useState({})
  const [customerName, setCustomerName] = useState('')
  const [deliveryDate, setDeliveryDate] = useState(localDateValue())
  const [deliveryTime, setDeliveryTime] = useState('16:00')
  const [sending, setSending] = useState(false)
  const [success, setSuccess] = useState('')
  const [storeMenuOpen, setStoreMenuOpen] = useState(false)

  useEffect(() => {
    if (!db || !companyId) { setLoading(false); return }
    const stopCompany = onSnapshot(doc(db, 'empresas', companyId), (snapshot) => {
      if (snapshot.exists()) setCompanyName(snapshot.data().nombre || 'Pastelería')
    })
    const productsQuery = query(collection(db, 'empresas', companyId, 'productos'), where('activo', '==', true))
    const stopProducts = onSnapshot(productsQuery, (snapshot) => {
      setProducts(snapshot.docs.map((item) => {
        const data = item.data()
        return { id: item.id, ...data, name: data.nombre, price: data.precio, stock: data.stock }
      }))
      setError('')
      setLoading(false)
    }, () => {
      setError('No pudimos consultar el catálogo. Revisa las reglas de Firestore.')
      setLoading(false)
    })
    return () => { stopCompany(); stopProducts() }
  }, [])

  const chosen = useMemo(() => products.filter((item) => cart[item.id] > 0), [products, cart])
  const isCustomOrder = orderMode === 'custom'
  const total = chosen.reduce((sum, item) => sum + (Number(item.price) || 0) * cart[item.id], 0)
  const canOrder = chosen.length > 0 && chosen.every((item) => item.modoVenta === 'bajoPedido' || cart[item.id] <= (Number(item.stock) || 0))
  const canSubmit = isCustomOrder || canOrder
  const customCakeTotal = customCake.tamano ? (cakeBasePrices[customCake.tamano] || 0)
    + (cakeFlavorExtras[customCake.sabor] || 0)
    + (cakeFillingExtras[customCake.relleno] || 0)
    + (cakeDecorationExtras[customCake.decoracion] || 0) : 0
  const minLeadDays = isCustomOrder ? 3 : chosen.reduce((days, item) => item.modoVenta === 'bajoPedido' ? Math.max(days, Number(item.anticipacionDias) || 2) : days, 0)
  const earliestDeliveryDate = localDateValue(new Date(Date.now() + minLeadDays * 24 * 60 * 60 * 1000))
  useEffect(() => { if (deliveryDate < earliestDeliveryDate) setDeliveryDate(earliestDeliveryDate) }, [earliestDeliveryDate])

  const add = (item) => {
    setSuccess('')
    setCart((current) => ({ ...current, [item.id]: item.modoVenta === 'bajoPedido' ? (current[item.id] || 0) + 1 : Math.min((current[item.id] || 0) + 1, Number(item.stock) || 0) }))
  }

  const changeQty = (item, delta) => setCart((current) => {
    const next = Math.max((current[item.id] || 0) + delta, 0)
    return { ...current, [item.id]: item.modoVenta === 'bajoPedido' ? next : Math.min(next, Number(item.stock) || 0) }
  })

  async function submitOrder() {
    if (!db || !canSubmit || sending) return
    if (!customerName.trim()) {
      setError('Escribe el nombre para registrar el pedido.')
      return
    }
    if (!deliveryDate || deliveryDate < earliestDeliveryDate || !deliveryTime) {
      setError('Elige una fecha y una hora válidas para la entrega.')
      return
    }
    for (const item of chosen.filter((product) => product.modoVenta === 'bajoPedido')) {
      const details = customizations[item.id] || {}
      if (!details.ocasion || !details.tamano || !details.sabor) {
        setError(`Completa ocasión, tamaño y sabor para ${item.name}.`)
        return
      }
    }
    if (isCustomOrder && (!customCake.ocasion || !customCake.tamano || !customCake.sabor || !customCake.diseno.trim())) {
      setError('Completa ocasión, tamaño, sabor y describe cómo quieres el diseño del pastel.')
      return
    }
    setSending(true)
    setError('')
    try {
      const orderRef = doc(collection(db, 'empresas', companyId, 'pedidos'))
      if (isCustomOrder) {
        await setDoc(orderRef, {
          cliente: customerName.trim(),
          productos: [{ productoId: 'personalizado', nombre: 'Pastel personalizado', precio: customCakeTotal, cantidad: 1, modalidad: 'personalizado', personalizacion: { ...customCake, cotizacion: { base: cakeBasePrices[customCake.tamano], extraSabor: cakeFlavorExtras[customCake.sabor] || 0, extraRelleno: cakeFillingExtras[customCake.relleno] || 0, extraDecoracion: cakeDecorationExtras[customCake.decoracion] || 0, total: customCakeTotal } } }],
          cantidadesPorProducto: { personalizado: 1 },
          reservaId: orderRef.id,
          total: customCakeTotal,
          entrega: `${deliveryDate}T${deliveryTime}`,
          estado: 'Pendiente de pago',
          creadoEn: serverTimestamp(),
        })
        setSuccess(`Cotizacion automatica guardada: ${currency.format(customCakeTotal)} MXN. Folio #${orderRef.id.slice(-6).toUpperCase()}.`)
        setOrderMode('choose')
        setCustomCake({ ocasion: '', tamano: '', sabor: '', relleno: 'Sin relleno', decoracion: 'Sencilla', diseno: '', mensaje: '' })
        setCustomerName('')
        return
      }
      const reservedTotal = await runTransaction(db, async (transaction) => {
        const currentItems = []
        for (const item of chosen) {
          const productRef = doc(db, 'empresas', companyId, 'productos', item.id)
          const productSnapshot = await transaction.get(productRef)
          const productData = productSnapshot.data()
          const available = Number(productData?.stock) || 0
          const madeToOrder = productData?.modoVenta === 'bajoPedido'
          if (!productSnapshot.exists() || productData?.activo !== true || (!madeToOrder && cart[item.id] > available)) {
            const stockError = new Error('STOCK_INSUFFICIENT')
            stockError.productName = item.name
            stockError.available = available
            throw stockError
          }
          currentItems.push({
            ref: productRef,
            id: item.id,
            name: productData.nombre,
            price: Number(productData.precio) || 0,
            quantity: cart[item.id],
            stock: available,
            madeToOrder,
          })
        }

        const productsForOrder = currentItems.map(({ id, name, price, quantity, madeToOrder }) => ({ productoId: id, nombre: name, precio: price, cantidad: quantity, ...(madeToOrder ? { modalidad: 'bajoPedido', personalizacion: customizations[id] || {} } : {}) }))
        const currentTotal = productsForOrder.reduce((sum, item) => sum + item.precio * item.cantidad, 0)
        const stockItems = currentItems.filter((item) => !item.madeToOrder)
        const quantities = Object.fromEntries(currentItems.map((item) => [item.id, item.quantity]))

        for (const item of stockItems) {
          transaction.update(item.ref, { stock: item.stock - item.quantity, ultimaReserva: orderRef.id })
        }
        transaction.set(orderRef, {
          cliente: customerName.trim(),
          productos: productsForOrder,
          cantidadesPorProducto: quantities,
          reservaId: orderRef.id,
          total: currentTotal,
          entrega: `${deliveryDate}T${deliveryTime}`,
          estado: 'Pendiente de pago',
          creadoEn: serverTimestamp(),
        })
        return currentTotal
      })
      setSuccess(`¡Pedido guardado! Se reservó el stock y tu folio es #${orderRef.id.slice(-6).toUpperCase()} por ${currency.format(reservedTotal)} MXN.`)
      setCart({})
      setCustomizations({})
      setCustomerName('')
      setOrderMode('choose')
    } catch (orderError) {
      if (orderError.message === 'STOCK_INSUFFICIENT') {
        setError(`Stock insuficiente de ${orderError.productName}. Quedan ${orderError.available}; no se guardó el pedido.`)
      } else {
      setError('No se pudo guardar el pedido. Revisa la conexión y las reglas de Firestore.')
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#efeae2]">
      <div className="relative z-20 flex h-[68px] shrink-0 items-center gap-3 bg-[#075e54] px-4 text-white">
        <div className="grid size-10 place-items-center rounded-full bg-[#e8bd82] text-xl">🧁</div>
        <div className="relative min-w-0 flex-1"><button aria-expanded={storeMenuOpen} onClick={() => setStoreMenuOpen((open) => !open)} className="flex max-w-full items-center gap-1 text-left"><p className="truncate text-sm font-semibold">{companyName}</p><svg viewBox="0 0 20 20" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m5 7.5 5 5 5-5" /></svg></button><p className="mt-0.5 text-[11px] text-emerald-100">En línea · Asistente de pedidos</p>{storeMenuOpen && <div className="absolute left-0 top-12 z-50 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-800 shadow-xl"><div className="px-3 py-2 text-[9px] font-semibold uppercase tracking-wide text-slate-400">Tienda actual</div><div className="px-3 pb-2 text-xs font-semibold text-emerald-800">{companyName} <span aria-hidden="true">✓</span></div><button disabled className="w-full cursor-not-allowed px-3 py-2 text-left text-xs text-slate-400">Otra tienda · Próximamente</button><div className="my-1 border-t border-slate-100" /><button onClick={() => { setStoreMenuOpen(false); onOpenDashboard?.() }} className="w-full px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">Panel del negocio</button></div>}</div>
        <span className="size-2 rounded-full bg-emerald-300" aria-label="En línea" />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-4">
        <p className="mx-auto w-fit rounded-full bg-white/80 px-3 py-1 text-[10px] font-medium text-stone-500">HOY</p>
        <div className="max-w-[94%] rounded-2xl rounded-tl-sm bg-white p-3 shadow-sm">
          <p className="text-xs leading-relaxed text-stone-700">¡Hola! Bienvenido a <strong>Repostería La Esquina.</strong> Elige lo que deseas ordenar hoy:</p>
          {(!firebaseConfigured || !companyId) && <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-900">Configura Firebase y el ID de empresa en <code>.env.local</code> para cargar el catálogo.</p>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-[11px] text-rose-800">{error}</p>}
          {loading && <p className="mt-3 text-[11px] text-stone-400">Consultando productos…</p>}
          {orderMode === 'catalog' && !loading && firebaseConfigured && !error && products.length === 0 && <p className="mt-3 rounded-lg bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-500">Aún no hay productos activos en Firestore. Agrega documentos en la colección <code>products</code> para mostrarlos aquí.</p>}
          {orderMode === 'choose' && <div className="mt-3 grid gap-2"><p className="text-[11px] font-medium text-stone-600">Que te gustaria hacer?</p><button onClick={() => setOrderMode('catalog')} className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-3 text-left hover:border-emerald-300"><span><strong className="block text-[11px] text-stone-800">Elegir del catalogo</strong><small className="mt-0.5 block text-[9px] text-stone-500">Productos y precios disponibles</small></span><span className="text-emerald-700">›</span></button><button onClick={() => setOrderMode('custom')} className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-left hover:border-amber-400"><span><strong className="block text-[11px] text-stone-800">Encargar un pastel personalizado</strong><small className="mt-0.5 block text-[9px] text-stone-500">Para cumpleanos, aniversarios y mas</small></span><span className="text-amber-800">›</span></button></div>}
          {orderMode === 'catalog' && <div><button onClick={() => { setOrderMode('choose'); setCart({}) }} className="mt-3 text-[10px] font-semibold text-emerald-800">← Volver a opciones</button>{products.length === 0 && !loading && <p className="mt-2 rounded-lg bg-stone-50 p-3 text-[11px] text-stone-500">No hay productos activos en el catalogo todavia.</p>}</div>}
          {orderMode === 'catalog' && products.length > 0 && <div className="mt-2 grid grid-cols-2 gap-2">
            {products.map((item) => {
              const kind = /galleta|cookie/i.test(item.name || '') ? 'cookies' : 'cake'
              const stock = Number(item.stock) || 0
              const madeToOrder = item.modoVenta === 'bajoPedido'
              return <article key={item.id} className="overflow-hidden rounded-xl border border-stone-100 bg-white">
                <ProductArt kind={kind} />
                <div className="p-2">
                  <div className="flex min-h-8 items-start justify-between gap-1"><p className="text-[10px] font-semibold leading-tight text-stone-800">{item.name}</p><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${madeToOrder || stock ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-500'}`}>{madeToOrder ? 'Bajo pedido' : stock ? `Quedan ${stock}` : 'Agotado'}</span></div>
                  <div className="mt-2 flex items-center justify-between gap-1"><strong className="text-xs text-stone-900">{currency.format(Number(item.price) || 0)}</strong><button disabled={!madeToOrder && !stock} onClick={() => add(item)} className="rounded-md bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">+ Agregar</button></div>
                  {madeToOrder && <p className="mt-1 text-[8px] text-stone-500">Se prepara en {Number(item.anticipacionDias) || 2} días o más</p>}
                  {cart[item.id] > 0 && <div className="mt-2 flex items-center justify-between rounded-lg bg-stone-50 px-2 py-1"><button onClick={() => changeQty(item, -1)} className="grid size-5 place-items-center rounded bg-white text-sm text-stone-700">−</button><span className="text-[10px] font-semibold">{cart[item.id]} en tu pedido</span><button onClick={() => add(item)} disabled={!madeToOrder && cart[item.id] >= stock} className="grid size-5 place-items-center rounded bg-white text-sm text-stone-700 disabled:opacity-40">+</button></div>}
                </div>
              </article>
            })}
          </div>}
        </div>

        {isCustomOrder && <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] p-3 shadow-sm"><button onClick={() => setOrderMode('choose')} className="mb-2 text-[10px] font-semibold text-emerald-900">← Cambiar tipo de pedido</button><p className="text-[11px] font-semibold text-stone-800">Quiero encargar un pastel personalizado.</p><div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[9px] text-stone-600">Ocasion<select value={customCake.ocasion} onChange={(event) => setCustomCake((value) => ({ ...value, ocasion: event.target.value }))} className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-2 py-2 text-[10px]"><option value="">Elige ocasion</option><option>Cumpleanos</option><option>Aniversario</option><option>Bautizo</option><option>Boda</option><option>Graduacion</option><option>Otro</option></select></label><label className="text-[9px] text-stone-600">Tamano<select value={customCake.tamano} onChange={(event) => setCustomCake((value) => ({ ...value, tamano: event.target.value }))} className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-2 py-2 text-[10px]"><option value="">Elige tamano</option><option value="Chico (6 porciones)">Chico (6 porciones) - $450</option><option value="Mediano (12 porciones)">Mediano (12 porciones) - $700</option><option value="Grande (20 porciones)">Grande (20 porciones) - $950</option><option value="Extra grande (30 porciones)">Extra grande (30 porciones) - $1,300</option></select></label><label className="text-[9px] text-stone-600">Sabor<select value={customCake.sabor} onChange={(event) => setCustomCake((value) => ({ ...value, sabor: event.target.value }))} className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-2 py-2 text-[10px]"><option value="">Elige sabor</option><option>Chocolate</option><option>Vainilla</option><option value="Red velvet">Red velvet (+$50)</option><option>Fresa</option><option value="Especial">Sabor especial (+$100)</option></select></label><label className="text-[9px] text-stone-600">Relleno<select value={customCake.relleno} onChange={(event) => setCustomCake((value) => ({ ...value, relleno: event.target.value }))} className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-2 py-2 text-[10px]"><option>Sin relleno</option><option value="Fruta o mermelada">Fruta o mermelada (+$50)</option><option value="Cajeta o dulce de leche">Cajeta o dulce de leche (+$50)</option><option value="Ganache de chocolate">Ganache de chocolate (+$80)</option><option value="Queso crema">Queso crema (+$80)</option></select></label></div><label className="mt-2 block text-[9px] text-stone-600">Nivel de decoracion<select value={customCake.decoracion} onChange={(event) => setCustomCake((value) => ({ ...value, decoracion: event.target.value }))} className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-2 py-2 text-[10px]"><option>Sencilla</option><option value="Tematica">Tematica (+$150)</option><option value="Elaborada">Elaborada (+$300)</option></select></label><label className="mt-2 block text-[9px] text-stone-600">Describe el diseno que tienes en mente<textarea required value={customCake.diseno} onChange={(event) => setCustomCake((value) => ({ ...value, diseno: event.target.value }))} maxLength={500} rows={3} placeholder="Colores, tematica, decoracion, referencia..." className="mt-1 w-full resize-y rounded-lg border border-emerald-100 bg-white px-2.5 py-2 text-[10px]" /></label><label className="mt-2 block text-[9px] text-stone-600">Texto para escribir en el pastel (opcional)<input value={customCake.mensaje} onChange={(event) => setCustomCake((value) => ({ ...value, mensaje: event.target.value }))} maxLength={80} placeholder="Feliz cumpleanos!" className="mt-1 w-full rounded-lg border border-emerald-100 bg-white px-2.5 py-2 text-[10px]" /></label><p className="mt-2 rounded-lg bg-white/70 p-2 text-[9px] text-stone-600">Precio calculado: base por tamano + sabor + relleno + decoracion. La cotizacion se calcula al seleccionar las opciones e incluye 3 dias de anticipacion.</p></div>}
        {(chosen.length > 0 || isCustomOrder) && <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] p-3 shadow-sm">
          <p className="text-[11px] font-medium text-stone-800">{isCustomOrder ? 'Solicitud de pastel personalizado.' : `Quiero ${chosen.map((item) => `${cart[item.id]} ${item.name}`).join(' y ')}.`}</p>
          <label className="mt-3 block text-[10px] font-medium text-stone-600">¿A nombre de quién registramos el pedido?</label>
          <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Nombre del cliente" maxLength={80} className="mt-1 w-full rounded-lg border border-emerald-100 bg-white/80 px-2.5 py-2 text-[11px] text-stone-800 outline-none focus:border-emerald-500" />
          <p className="mt-3 text-[10px] font-medium text-stone-600">¿Cuándo lo necesitas?</p>
          {chosen.filter((item) => item.modoVenta === 'bajoPedido').map((item) => <fieldset key={item.id} className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5"><legend className="px-1 text-[10px] font-semibold text-amber-900">Personaliza: {item.name}</legend><div className="grid grid-cols-2 gap-2"><label className="text-[9px] text-stone-600">Ocasón<select required value={customizations[item.id]?.ocasion || ''} onChange={(event) => setCustomizations((state) => ({ ...state, [item.id]: { ...state[item.id], ocasion: event.target.value } }))} className="mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-[10px]"><option value="">Elige una</option><option>Cumpleaños</option><option>Aniversario</option><option>Bautizo</option><option>Boda</option><option>Graduación</option><option>Otro</option></select></label><label className="text-[9px] text-stone-600">Tamaño<select required value={customizations[item.id]?.tamano || ''} onChange={(event) => setCustomizations((state) => ({ ...state, [item.id]: { ...state[item.id], tamano: event.target.value } }))} className="mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-[10px]"><option value="">Elige uno</option><option>Chico (6 porciones)</option><option>Mediano (12 porciones)</option><option>Grande (20 porciones)</option><option>Personalizado</option></select></label><label className="text-[9px] text-stone-600">Sabor<select required value={customizations[item.id]?.sabor || ''} onChange={(event) => setCustomizations((state) => ({ ...state, [item.id]: { ...state[item.id], sabor: event.target.value } }))} className="mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-[10px]"><option value="">Elige uno</option><option>Chocolate</option><option>Vainilla</option><option>Red velvet</option><option>Fresa</option><option>Otro</option></select></label><label className="text-[9px] text-stone-600">Relleno (opcional)<input maxLength={60} value={customizations[item.id]?.relleno || ''} onChange={(event) => setCustomizations((state) => ({ ...state, [item.id]: { ...state[item.id], relleno: event.target.value } }))} placeholder="Fresas, cajeta" className="mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-[10px]" /></label><label className="col-span-2 text-[9px] text-stone-600">Texto en el pastel (opcional)<input maxLength={60} value={customizations[item.id]?.mensaje || ''} onChange={(event) => setCustomizations((state) => ({ ...state, [item.id]: { ...state[item.id], mensaje: event.target.value } }))} placeholder="¡Feliz cumpleaños, Ana!" className="mt-1 w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-[10px]" /></label></div></fieldset>)}
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <label className="block min-w-0"><span className="mb-1 flex items-center gap-1 text-[9px] text-stone-500"><svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="2.5" y="4" width="15" height="13" rx="2"/><path d="M6 2.5v3M14 2.5v3M2.5 8h15"/></svg>{minLeadDays ? `Fecha (mín. ${minLeadDays} días)` : 'Fecha'}</span><input aria-label="Fecha de entrega" type="date" min={earliestDeliveryDate} value={deliveryDate < earliestDeliveryDate ? earliestDeliveryDate : deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} required className="h-9 w-full min-w-0 rounded-lg border border-emerald-100 bg-white/80 px-2 text-[10px] text-stone-800 outline-none focus:border-emerald-500" /></label>
            <label className="block min-w-0"><span className="mb-1 flex items-center gap-1 text-[9px] text-stone-500"><svg viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10" cy="10" r="7.2"/><path d="M10 5.8v4.5l3 1.8" strokeLinecap="round"/></svg>Hora</span><input aria-label="Hora de entrega" type="time" value={deliveryTime} onChange={(event) => setDeliveryTime(event.target.value)} required className="h-9 w-full min-w-0 rounded-lg border border-emerald-100 bg-white/80 px-2 text-[10px] text-stone-800 outline-none focus:border-emerald-500" /></label>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px]"><span className="text-stone-600">{isCustomOrder ? 'Precio' : 'Total'}</span><strong>{isCustomOrder ? (customCake.tamano ? `${currency.format(customCakeTotal)} MXN` : 'Selecciona tamano') : `${currency.format(total)} MXN`}</strong></div>
          {chosen.some((item) => item.modoVenta !== 'bajoPedido' && cart[item.id] > (Number(item.stock) || 0)) && <p className="mt-2 text-[10px] text-rose-700">La cantidad supera el stock disponible. Ajusta tu pedido.</p>}
          <button onClick={submitOrder} disabled={!canSubmit || !customerName.trim() || sending || (isCustomOrder && (!customCake.ocasion || !customCake.tamano || !customCake.sabor || !customCake.diseno.trim()))} className="mt-3 w-full rounded-lg bg-[#087d67] px-3 py-2.5 text-[11px] font-semibold text-white hover:bg-[#066b58] disabled:cursor-not-allowed disabled:opacity-50">{sending ? 'Guardando pedido…' : 'Confirmar pedido'}</button>
        </div>}

        {error && chosen.length > 0 && <p role="alert" className="ml-auto max-w-[92%] rounded-xl bg-rose-50 p-3 text-[11px] text-rose-800">{error}</p>}
        {success && <div className="max-w-[94%] rounded-2xl rounded-tl-sm bg-white p-3 text-[11px] leading-relaxed text-stone-700 shadow-sm"><span className="mr-2 text-emerald-700">✓</span>{success}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-stone-200/70 bg-[#f8f8f6] px-3 py-3">
        <button type="button" onClick={() => setError('Para subir comprobantes activaremos Firebase Storage después de confirmar la base de datos.')} aria-label="Adjuntar comprobante" className="grid size-10 shrink-0 place-items-center rounded-full text-stone-500 hover:bg-stone-100"><svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="m20.2 11.4-8.1 8.2a5 5 0 0 1-7.1-7.1l8.5-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg></button>
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-stone-200 bg-white px-4 text-[11px] text-stone-400">Escribe un mensaje…</div>
        <button type="button" aria-label="Enviar" onClick={() => chosen.length || isCustomOrder ? submitOrder() : setError('Selecciona una opcion para continuar.')} className="grid size-10 shrink-0 place-items-center rounded-full bg-[#087d67] text-white shadow-sm"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21 3-7.2 18-3.8-7-7-3.8L21 3Z" /><path d="M10 14 21 3" /></svg></button>
      </div>
    </section>
  )
}
