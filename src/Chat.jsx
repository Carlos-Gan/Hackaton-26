import { useEffect, useMemo, useState } from 'react'
import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db, firebaseConfigured } from './firebase.js'

const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
const companyId = import.meta.env.VITE_COMPANY_ID

function ProductArt({ kind }) {
  return <div className={`grid h-24 place-items-center overflow-hidden rounded-t-xl ${kind === 'cookies' ? 'bg-[#f2dfbf]' : 'bg-[#f0ddc7]'}`}>
    <span className="text-[52px] drop-shadow-sm" aria-hidden="true">{kind === 'cookies' ? '🍪' : '🍰'}</span>
  </div>
}

export default function Chat() {
  const [products, setProducts] = useState([])
  const [companyName, setCompanyName] = useState('Pastelería')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cart, setCart] = useState({})
  const [deliveryTime, setDeliveryTime] = useState('Hoy, 4:00 PM')
  const [sending, setSending] = useState(false)
  const [success, setSuccess] = useState('')

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
  const total = chosen.reduce((sum, item) => sum + (Number(item.price) || 0) * cart[item.id], 0)
  const canOrder = chosen.length > 0 && chosen.every((item) => cart[item.id] <= (Number(item.stock) || 0))

  const add = (item) => {
    setSuccess('')
    setCart((current) => ({ ...current, [item.id]: Math.min((current[item.id] || 0) + 1, Number(item.stock) || 0) }))
  }

  const changeQty = (item, delta) => setCart((current) => {
    const next = Math.min(Math.max((current[item.id] || 0) + delta, 0), Number(item.stock) || 0)
    return { ...current, [item.id]: next }
  })

  async function submitOrder() {
    if (!db || !canOrder || sending) return
    setSending(true)
    setError('')
    try {
      const orderRef = doc(collection(db, 'empresas', companyId, 'pedidos'))
      const reservedTotal = await runTransaction(db, async (transaction) => {
        const currentItems = []
        for (const item of chosen) {
          const productRef = doc(db, 'empresas', companyId, 'productos', item.id)
          const productSnapshot = await transaction.get(productRef)
          const productData = productSnapshot.data()
          const available = Number(productData?.stock) || 0
          if (!productSnapshot.exists() || productData?.activo !== true || cart[item.id] > available) {
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
          })
        }

        const productsForOrder = currentItems.map(({ id, name, price, quantity }) => ({ productoId: id, nombre: name, precio: price, cantidad: quantity }))
        const currentTotal = productsForOrder.reduce((sum, item) => sum + item.precio * item.cantidad, 0)
        const quantities = Object.fromEntries(currentItems.map((item) => [item.id, item.quantity]))

        for (const item of currentItems) {
          transaction.update(item.ref, { stock: item.stock - item.quantity, ultimaReserva: orderRef.id })
        }
        transaction.set(orderRef, {
          cliente: 'Pedido por chat',
          productos: productsForOrder,
          cantidadesPorProducto: quantities,
          reservaId: orderRef.id,
          total: currentTotal,
          entrega: deliveryTime,
          estado: 'Pendiente de pago',
          creadoEn: serverTimestamp(),
        })
        return currentTotal
      })
      setSuccess(`¡Pedido guardado! Se reservó el stock y tu folio es #${orderRef.id.slice(-6).toUpperCase()} por ${currency.format(reservedTotal)} MXN.`)
      setCart({})
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
      <div className="flex h-[68px] shrink-0 items-center gap-3 bg-[#075e54] px-4 text-white">
        <div className="grid size-10 place-items-center rounded-full bg-[#e8bd82] text-xl">🧁</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{companyName}</p><p className="mt-0.5 text-[11px] text-emerald-100">En línea · Asistente de pedidos</p></div>
        <span className="size-2 rounded-full bg-emerald-300" aria-label="En línea" />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-4">
        <p className="mx-auto w-fit rounded-full bg-white/80 px-3 py-1 text-[10px] font-medium text-stone-500">HOY</p>
        <div className="max-w-[94%] rounded-2xl rounded-tl-sm bg-white p-3 shadow-sm">
          <p className="text-xs leading-relaxed text-stone-700">¡Hola! Bienvenido a <strong>Repostería La Esquina.</strong> Elige lo que deseas ordenar hoy:</p>
          {(!firebaseConfigured || !companyId) && <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-900">Configura Firebase y el ID de empresa en <code>.env.local</code> para cargar el catálogo.</p>}
          {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2.5 text-[11px] text-rose-800">{error}</p>}
          {loading && <p className="mt-3 text-[11px] text-stone-400">Consultando productos…</p>}
          {!loading && firebaseConfigured && !error && products.length === 0 && <p className="mt-3 rounded-lg bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-500">Aún no hay productos activos en Firestore. Agrega documentos en la colección <code>products</code> para mostrarlos aquí.</p>}
          {products.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2">
            {products.map((item) => {
              const kind = /galleta|cookie/i.test(item.name || '') ? 'cookies' : 'cake'
              const stock = Number(item.stock) || 0
              return <article key={item.id} className="overflow-hidden rounded-xl border border-stone-100 bg-white">
                <ProductArt kind={kind} />
                <div className="p-2">
                  <div className="flex min-h-8 items-start justify-between gap-1"><p className="text-[10px] font-semibold leading-tight text-stone-800">{item.name}</p><span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${stock ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-500'}`}>{stock ? `Quedan ${stock}` : 'Agotado'}</span></div>
                  <div className="mt-2 flex items-center justify-between gap-1"><strong className="text-xs text-stone-900">{currency.format(Number(item.price) || 0)}</strong><button disabled={!stock} onClick={() => add(item)} className="rounded-md bg-emerald-50 px-2 py-1 text-[9px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40">+ Agregar</button></div>
                  {cart[item.id] > 0 && <div className="mt-2 flex items-center justify-between rounded-lg bg-stone-50 px-2 py-1"><button onClick={() => changeQty(item, -1)} className="grid size-5 place-items-center rounded bg-white text-sm text-stone-700">−</button><span className="text-[10px] font-semibold">{cart[item.id]} en tu pedido</span><button onClick={() => add(item)} disabled={cart[item.id] >= stock} className="grid size-5 place-items-center rounded bg-white text-sm text-stone-700 disabled:opacity-40">+</button></div>}
                </div>
              </article>
            })}
          </div>}
        </div>

        {chosen.length > 0 && <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-[#dcf8c6] p-3 shadow-sm">
          <p className="text-[11px] font-medium text-stone-800">Quiero {chosen.map((item) => `${cart[item.id]} ${item.name}`).join(' y ')}.</p>
          <label className="mt-3 block text-[10px] font-medium text-stone-600">¿Cuándo lo necesitas?</label>
          <input value={deliveryTime} onChange={(event) => setDeliveryTime(event.target.value)} className="mt-1 w-full rounded-lg border border-emerald-100 bg-white/80 px-2.5 py-2 text-[11px] text-stone-800 outline-none focus:border-emerald-500" />
          <div className="mt-2 flex items-center justify-between text-[11px]"><span className="text-stone-600">Total</span><strong>{currency.format(total)} MXN</strong></div>
          {chosen.some((item) => cart[item.id] > (Number(item.stock) || 0)) && <p className="mt-2 text-[10px] text-rose-700">La cantidad supera el stock disponible. Ajusta tu pedido.</p>}
          <button onClick={submitOrder} disabled={!canOrder || sending} className="mt-3 w-full rounded-lg bg-[#087d67] px-3 py-2.5 text-[11px] font-semibold text-white hover:bg-[#066b58] disabled:cursor-not-allowed disabled:opacity-50">{sending ? 'Guardando pedido…' : 'Confirmar pedido'}</button>
        </div>}

        {error && chosen.length > 0 && <p role="alert" className="ml-auto max-w-[92%] rounded-xl bg-rose-50 p-3 text-[11px] text-rose-800">{error}</p>}
        {success && <div className="max-w-[94%] rounded-2xl rounded-tl-sm bg-white p-3 text-[11px] leading-relaxed text-stone-700 shadow-sm"><span className="mr-2 text-emerald-700">✓</span>{success}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-stone-200/70 bg-[#f8f8f6] px-3 py-3">
        <button type="button" onClick={() => setError('Para subir comprobantes activaremos Firebase Storage después de confirmar la base de datos.')} aria-label="Adjuntar comprobante" className="grid size-10 shrink-0 place-items-center rounded-full text-stone-500 hover:bg-stone-100"><svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="m20.2 11.4-8.1 8.2a5 5 0 0 1-7.1-7.1l8.5-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.4a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg></button>
        <div className="flex h-10 min-w-0 flex-1 items-center rounded-full border border-stone-200 bg-white px-4 text-[11px] text-stone-400">Escribe un mensaje…</div>
        <button type="button" aria-label="Enviar" onClick={() => chosen.length ? submitOrder() : setError('Agrega al menos un producto para continuar.')} className="grid size-10 shrink-0 place-items-center rounded-full bg-[#087d67] text-white shadow-sm"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m21 3-7.2 18-3.8-7-7-3.8L21 3Z" /><path d="M10 14 21 3" /></svg></button>
      </div>
    </section>
  )
}
