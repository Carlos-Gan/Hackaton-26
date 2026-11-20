import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, increment, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth, db, firebaseConfigured } from './firebase.js'

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
const workflow = ['Por validar pago', 'En preparación', 'Listo para entrega', 'Entregado']
const defaultStoreColor = '#087d60'

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
}

function printCashClose(report, companyName) {
  const printWindow = window.open('', '_blank')
  if (!printWindow) return false
  const orderRows = report.deliveredOrders.length
    ? report.deliveredOrders.map((order) => `<tr><td>#${escapeHtml(order.folio)}</td><td>${escapeHtml(order.hora)}</td><td>${escapeHtml(order.cliente)}</td><td>${escapeHtml(order.productos)}</td><td>${escapeHtml(order.metodoPago)}</td><td>${escapeHtml(money.format(order.total))}</td></tr>`).join('')
    : '<tr><td colspan="6">No hay pedidos entregados hoy.</td></tr>'
  const paymentsRows = report.paymentBreakdown.length
    ? report.paymentBreakdown.map((item) => `<tr><td>${escapeHtml(item.metodo)}</td><td>${item.cantidad}</td><td>${escapeHtml(money.format(item.total))}</td></tr>`).join('')
    : '<tr><td colspan="3">No hay método de pago registrado.</td></tr>'
  const upcomingRows = [...report.pendingToday, ...report.pendingTomorrow, ...report.cancelledUpcoming].map((order) => `<tr><td>${escapeHtml(order.fechaLabel)}</td><td>#${escapeHtml(order.folio)}</td><td>${escapeHtml(order.cliente)}</td><td>${escapeHtml(order.productos)}</td><td>${escapeHtml(order.estado)}</td><td>${escapeHtml(money.format(order.total))}</td><td>${escapeHtml(money.format(order.anticipo))}</td><td>${order.porCobrar === null ? '—' : escapeHtml(money.format(order.porCobrar))}</td></tr>`).join('')
  const replenishmentRows = report.replenishment.length
    ? report.replenishment.map((item) => `<tr><td>${escapeHtml(item.nombre)}</td><td>${item.stockActual} ${escapeHtml(item.unidad)}</td><td>${item.pedidosManana} ${escapeHtml(item.unidad)}</td><td>${item.disponibleTrasPedidos} ${escapeHtml(item.unidad)}</td><td>${item.minimo} ${escapeHtml(item.unidad)}</td><td>Reponer ${item.reponer} ${escapeHtml(item.unidad)}</td></tr>`).join('')
    : '<tr><td colspan="6">No hay productos bajo mínimo, considerando los pedidos activos de mañana.</td></tr>'
  const topProduct = report.topProduct
    ? `${escapeHtml(report.topProduct.nombre)} · ${report.topProduct.cantidad} unidades`
    : 'Sin productos vendidos en pedidos entregados.'
  printWindow.document.open()
  printWindow.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Corte de caja - ${escapeHtml(companyName)}</title><style>body{font:13px Arial,sans-serif;color:#172033;margin:32px;max-width:1000px}h1{margin:0 0 6px;font-size:25px}.muted{color:#64748b}.summary{display:flex;gap:12px;margin:20px 0}.card{flex:1;padding:14px;border:1px solid #dbe3ec;border-radius:10px}.label{font-size:11px;color:#64748b}.value{display:block;margin-top:7px;font-weight:bold;font-size:20px}h2{font-size:16px;margin:22px 0 8px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{text-align:left;border-bottom:1px solid #dbe3ec;padding:7px 6px;vertical-align:top}th{background:#f1f5f9}.note{margin-top:18px;padding:11px;background:#f8fafc;border-radius:8px;color:#475569;font-size:11px}@media print{@page{size:landscape;margin:12mm}body{margin:0}tr{break-inside:avoid}h2{break-after:avoid}}</style></head><body><h1>Corte de caja del día</h1><div class="muted">${escapeHtml(companyName)} · ${escapeHtml(report.dateLabel)} · Folio ${escapeHtml(report.folio)}</div><div class="muted">Responsable: ${escapeHtml(report.responsable)} · Cierre generado: ${escapeHtml(report.closedAt)}</div><div class="summary"><div class="card"><span class="label">Venta de pedidos entregados</span><strong class="value">${escapeHtml(money.format(report.total))} MXN</strong></div><div class="card"><span class="label">Ticket promedio</span><strong class="value">${escapeHtml(money.format(report.ticketAverage))} MXN</strong></div><div class="card"><span class="label">Pedidos · unidades</span><strong class="value">${report.orderCount} · ${report.unitsSold}</strong></div></div><p>Comparación: ayer ${escapeHtml(money.format(report.yesterdayTotal))} · últimos 7 días previos ${escapeHtml(money.format(report.previousWeekTotal))}</p><h2>Producto estrella</h2><p>${topProduct}</p><h2>Desglose por método de pago registrado</h2><table><thead><tr><th>Método</th><th>Pedidos</th><th>Total</th></tr></thead><tbody>${paymentsRows}</tbody></table><h2>Detalle de pedidos entregados</h2><table><thead><tr><th>Folio</th><th>Hora de registro</th><th>Cliente</th><th>Productos</th><th>Método registrado</th><th>Importe</th></tr></thead><tbody>${orderRows}</tbody></table><h2>Pedidos por cobrar o entregar hoy y mañana</h2><table><thead><tr><th>Entrega</th><th>Folio</th><th>Cliente</th><th>Productos</th><th>Estado</th><th>Total</th><th>Anticipo registrado</th><th>Saldo estimado</th></tr></thead><tbody>${upcomingRows || '<tr><td colspan="8">No hay pedidos activos o cancelados para hoy y mañana.</td></tr>'}</tbody></table><h2>Reposición considerando mañana</h2><table><thead><tr><th>Producto</th><th>Stock</th><th>Pedido mañana</th><th>Disponible ajustado</th><th>Mínimo</th><th>Surtir</th></tr></thead><tbody>${replenishmentRows}</tbody></table><p class="note">No se registran métodos de pago para la mayoría de los pedidos; efectivo contado, fondo inicial, gastos/retiros, propinas, fecha de cobro de anticipos/abonos, descuentos, devoluciones, mermas e impuestos tampoco están disponibles. Las ventas en mostrador solo descuentan stock y no se guardan como transacciones, por eso no entran al corte. Los pedidos creados por el chat ya descuentan inventario al reservar; para no contarlos dos veces, solo se restan pedidos sin reserva identificada. La reposición usa productos de inventario, no consumo de ingredientes por receta.</p></body></html>`)
  printWindow.document.close()
  printWindow.focus()
  window.setTimeout(() => printWindow.print(), 300)
  return true
}

function storeThemeVars(color) {
  return {
    '--store-color': color,
    '--color-emerald-50': `color-mix(in srgb, ${color} 6%, white)`,
    '--color-emerald-100': `color-mix(in srgb, ${color} 12%, white)`,
    '--color-emerald-200': `color-mix(in srgb, ${color} 22%, white)`,
    '--color-emerald-300': `color-mix(in srgb, ${color} 38%, white)`,
    '--color-emerald-400': `color-mix(in srgb, ${color} 65%, white)`,
    '--color-emerald-500': color,
    '--color-emerald-600': color,
    '--color-emerald-700': color,
    '--color-emerald-800': `color-mix(in srgb, ${color} 86%, black)`,
    '--color-emerald-900': `color-mix(in srgb, ${color} 72%, black)`,
  }
}

function clean(value = '') {
  return value.toLocaleLowerCase('es-MX').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function paymentMethodOf(order) {
  return order.metodoPago || order.formaPago || order.paymentMethod || order.tipoPago || 'No registrado'
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
  return <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-white sm:size-14"><svg viewBox="0 0 32 32" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 18h22l-2 10H7L5 18Z"/><path d="M4 17c0-1.7 1.3-3 3-3h18c1.7 0 3 1.3 3 3v2H4v-2Z"/><path d="M10 13c-1-3 1-5 3-5 0 2 2 2 3 2 2 0 4 1 4 3"/></svg></span>
}

function NavIcon({ name, className = 'size-4' }) {
  const common = { viewBox: '0 0 24 24', className, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (name === 'live') return <svg {...common}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>
  if (name === 'history') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
  if (name === 'inventory') return <svg {...common}><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/><path d="M8 20v-4h8v4"/></svg>
  if (name === 'forecast') return <svg {...common}><path d="M3 17 9 11l4 4 8-9"/><path d="M15 6h6v6"/></svg>
  if (name === 'calendar') return <svg {...common}><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M7.5 3v4M16.5 3v4M3.5 9h17"/></svg>
  return null
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

function StockItem({ product, canEdit, onChange, onEdit, onCounterSale, forecast }) {
  const madeToOrder = product.modoVenta === 'bajoPedido'
  const stock = Number(product.stock) || 0
  const minimumStock = Number(product.stockMinimo) || 5
  const max = Number(product.stockMaximo) || Math.max(stock, 24)
  const percentage = Math.min((stock / max) * 100, 100)
  const alert = stock <= Math.min(2, minimumStock) ? { text: 'Stock critico', cls: 'bg-rose-50 text-rose-700', bar: 'bg-rose-500' } : stock <= minimumStock ? { text: 'Por agotarse', cls: 'bg-amber-50 text-amber-800', bar: 'bg-amber-500' } : { text: 'Disponible', cls: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' }
  return <div className="border-t border-slate-100 py-4 first:border-0 first:pt-0">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-700">{product.nombre}</p>
        <p className="mt-2 w-fit rounded-md px-2 py-1 text-[10px] font-medium"><span className={madeToOrder ? 'rounded-md bg-violet-50 px-2 py-1 text-violet-800' : alert.cls + ' rounded-md px-2 py-1'}>{madeToOrder ? 'Se prepara bajo pedido' : alert.text}</span></p>
        {madeToOrder && <p className="mt-1 text-[10px] text-slate-500">Anticipacion minima: {Number(product.anticipacionDias) || 2} dias</p>}
        {canEdit && <button onClick={() => onEdit(product)} className="mt-2 text-[10px] font-semibold text-emerald-800 hover:underline">Editar producto</button>}
      </div>
      {!madeToOrder && <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-200"><button disabled={!canEdit || stock <= 0} onClick={() => onChange(product, -1)} aria-label={'Restar stock a ' + product.nombre} className="grid size-9 place-items-center text-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40">-</button><button disabled={!canEdit} onClick={() => onChange(product, 1)} aria-label={'Sumar stock a ' + product.nombre} className="grid size-9 place-items-center border-l border-slate-200 text-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40">+</button></div>}
    </div>
    {!madeToOrder && <>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={'h-full rounded-full ' + alert.bar} style={{ width: percentage + '%' }} /></div>
      <p className="mt-1.5 text-[10px] text-slate-500">{stock} {product.unidad || 'pzas'} disponibles</p>
      {canEdit && <button disabled={stock <= 0} onClick={() => onCounterSale(product)} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M7 6V4h10v2M3 11h18M8 15h3"/><circle cx="17" cy="15" r="1" fill="currentColor" stroke="none"/></svg>
        {stock > 0 ? 'Registrar venta en mostrador' : 'Sin existencias para vender'}
      </button>}
      {forecast && <p className={'mt-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed ' + forecast.tone}>{forecast.message}</p>}
    </>}
  </div>
}
function Login({ companyName, storeColor }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  async function login(event) {
    event.preventDefault()
    setLoginError('')
    try { await signInWithEmailAndPassword(auth, email, password) }
    catch { setLoginError('No se pudo iniciar sesión. Revisa tu correo y contraseña.') }
  }
  return <main style={storeThemeVars(storeColor)} className="mx-auto w-full max-w-md px-5 py-12 sm:py-20"><p className="text-sm font-medium text-emerald-800">Panel de {companyName}</p><h1 className="mt-2 text-3xl font-bold text-slate-900">Inicia sesión</h1><p className="mt-2 text-sm text-slate-500">Acceso exclusivo al equipo del negocio.</p><form onSubmit={login} className="mt-7 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><label className="block text-sm font-medium text-slate-700">Correo<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label><label className="block text-sm font-medium text-slate-700">Contraseña<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-600" /></label>{loginError && <p role="alert" className="text-sm text-rose-700">{loginError}</p>}<button className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900">Entrar al dashboard</button></form></main>
}

function ProductDialog({ product, onClose, onSave, saving, error, isPizzeria }) {
  const editing = Boolean(product)
  const [name, setName] = useState(product?.nombre || '')
  const [price, setPrice] = useState(product?.precio ?? '')
  const [stock, setStock] = useState(product?.stock ?? '')
  const [minimumStock, setMinimumStock] = useState(product?.stockMinimo ?? 5)
  const [unit, setUnit] = useState(product?.unidad || 'pzas')
  const [mode, setMode] = useState(product?.modoVenta || 'inventario')
  const [leadDays, setLeadDays] = useState(product?.anticipacionDias || 2)
  const [size, setSize] = useState(product?.tamano || '')
  const [formError, setFormError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (!name.trim() || Number(price) <= 0 || (isPizzeria && !size) || (mode === 'inventario' && !editing && Number(stock) < 0) || (mode === 'inventario' && Number(minimumStock) < 0)) {
      setFormError(isPizzeria ? 'Escribe el nombre, el tamaño y un precio válido.' : 'Escribe nombre, precio valido y existencias correctas.')
      return
    }
    setFormError('')
    const values = { nombre: name.trim(), precio: Number(price), modoVenta: mode, anticipacionDias: mode === 'bajoPedido' ? Math.max(1, Number(leadDays) || 2) : 0, stockMinimo: mode === 'inventario' ? Number(minimumStock) : 0 }
    if (isPizzeria) values.tamano = size
    if (!editing) Object.assign(values, { stock: mode === 'bajoPedido' ? 0 : Number(stock), stockMaximo: Math.max(Number(stock) || 1, 1), unidad: unit, activo: true, creadoEn: serverTimestamp() })
    await onSave(values)
  }
  return <div role="presentation" onClick={onClose} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-label={editing ? 'Editar producto' : 'Agregar producto'} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h2 className="text-xl font-bold text-slate-900">{editing ? 'Editar producto' : 'Nuevo producto'}</h2><p className="mt-1 text-sm text-slate-500">Configura el catalogo y su forma de venta.</p></div><button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600">?</button></div><form onSubmit={submit} className="mt-5 space-y-4"><label className="block text-sm font-medium text-slate-700">Nombre<input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label><label className="block text-sm font-medium text-slate-700">Precio base (MXN)<input required type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>{isPizzeria && <label className="block text-sm font-medium text-slate-700">Tamaño<select required value={size} onChange={(event) => setSize(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">Selecciona un tamaño</option><option value="Chica">Chica</option><option value="Mediana">Mediana</option><option value="Grande">Grande</option></select></label>}<label className="block text-sm font-medium text-slate-700">Modalidad<select value={mode} onChange={(event) => setMode(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="inventario">Producto con stock disponible</option><option value="bajoPedido">Preparar bajo pedido</option></select></label>{mode === 'bajoPedido' ? <label className="block text-sm font-medium text-slate-700">Anticipacion minima (dias)<input required type="number" min="1" max="60" value={leadDays} onChange={(event) => setLeadDays(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /><span className="mt-1 block text-xs font-normal text-slate-500">Los clientes podran elegir entrega a partir de ese plazo.</span></label> : <>{!editing && <label className="block text-sm font-medium text-slate-700">Existencias<input required type="number" min="0" step="1" value={stock} onChange={(event) => setStock(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>}<label className="block text-sm font-medium text-slate-700">Unidad<select value={unit} onChange={(event) => setUnit(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="pzas">Piezas</option><option value="docenas">Docenas</option><option value="kg">Kilogramos</option><option value="litros">Litros</option></select></label><label className="block text-sm font-medium text-slate-700">Stock mínimo para alerta<input required type="number" min="1" step="1" value={minimumStock} onChange={(event) => setMinimumStock(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /><span className="mt-1 block text-xs font-normal text-slate-500">Se incluirá en el corte de caja cuando el stock llegue a este valor.</span></label></>}{isPizzeria && <label className="block text-sm font-medium text-slate-700">Tamaño (opcional)<input type="text" value={size} onChange={(event) => setSize(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" /></label>}{(formError || error) && <p role="alert" className="text-sm text-rose-700">{formError || error}</p>}<button disabled={saving} className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Guardar producto'}</button></form></section></div>
}
export default function Dashboard({ companyId, companyName, activeTab, onTabChange, onOpenChat, onChooseStore }) {
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
  const [darkMode, setDarkMode] = useState(() => window.localStorage.getItem('dashboard-theme') === 'dark')
  const [period, setPeriod] = useState('today')
  const [targetDays, setTargetDays] = useState(14)
  const [ticket, setTicket] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState('')
  const [storeColor, setStoreColor] = useState(defaultStoreColor)
  const [ordersPausedUntil, setOrdersPausedUntil] = useState('')
  const [cashClosures, setCashClosures] = useState({})
  const [closeReport, setCloseReport] = useState(null)
  const [savingClose, setSavingClose] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [todayKey, setTodayKey] = useState(() => dateKey(new Date()))
  const ordersPausedToday = ordersPausedUntil === todayKey
  const isPizzeria = /pizzer|pizza/i.test(`${companyId || ''} ${companyName || ''}`)

  useEffect(() => {
    if (!auth) { setAuthReady(true); return }
    return onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setAuthReady(true) })
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setTodayKey(dateKey(new Date())), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setIsMember(false)
    setIsOwner(false)
    setOrders([])
    setProducts([])
    setOrdersPausedUntil('')
    setCashClosures({})
    if (!db || !user || !companyId) { setAccessLoading(false); return }
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
  }, [user, companyId])

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
  }, [isMember, companyId])

  useEffect(() => {
    if (!db || !companyId) return
    return onSnapshot(doc(db, 'empresas', companyId), (snapshot) => {
      const companySettings = snapshot.data() || {}
      const configuredColor = companySettings.colorPrimario
      const color = /^#[0-9a-f]{6}$/i.test(configuredColor || '') ? configuredColor : defaultStoreColor
      setStoreColor(color)
      setOrdersPausedUntil(companySettings.pedidosPausadosHasta || '')
      setCashClosures(companySettings.cierresCajaPorDia || {})
    })
  }, [companyId])

  const now = new Date()
  const todayOrders = orders.filter((order) => {
    const date = order.creadoEn?.toDate?.()
    return date && date.toDateString() === now.toDateString()
  })
  const validatedRevenue = todayOrders.filter((order) => stateOf(order) !== workflow[0]).reduce((sum, order) => sum + (Number(order.total) || 0), 0)
  const lowStock = products.filter((product) => product.modoVenta !== 'bajoPedido' && (Number(product.stock) || 0) <= (Number(product.stockMinimo) || 5))
  const deliveredToday = orders.filter((order) => stateOf(order) === workflow[3] && deliveryDayKey(order) === todayKey)
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

  function openCashClose() {
    setPdfError('')
    const productTotals = new Map()
    const paymentTotals = new Map()
    for (const order of deliveredToday) {
      const method = paymentMethodOf(order)
      const payment = paymentTotals.get(method) || { metodo: method, cantidad: 0, total: 0 }
      payment.cantidad += 1
      payment.total += Number(order.total) || 0
      paymentTotals.set(method, payment)
      for (const item of order.productos || []) {
        const name = item.nombre || 'Producto'
        const entry = productTotals.get(name) || { nombre: name, cantidad: 0 }
        entry.cantidad += Number(item.cantidad) || 1
        productTotals.set(name, entry)
      }
    }
    const topProduct = [...productTotals.values()].sort((a, b) => b.cantidad - a.cantidad)[0] || null
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowKey = dateKey(tomorrow)
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = dateKey(yesterday)
    const previousWeekStart = new Date(now)
    previousWeekStart.setDate(previousWeekStart.getDate() - 7)
    const previousWeekKey = dateKey(previousWeekStart)
    const cancelledUpcoming = orders.filter((order) => clean(order.estado || '').includes('cancel') && [todayKey, tomorrowKey].includes(deliveryDayKey(order)))
    const activeUpcoming = orders.filter((order) => !clean(order.estado || '').includes('cancel') && stateOf(order) !== workflow[3] && [todayKey, tomorrowKey].includes(deliveryDayKey(order)))
    const toUpcomingRow = (order) => ({
      folio: orderFolio(order),
      fechaLabel: deliveryDayKey(order) === todayKey ? 'Hoy' : 'Mañana',
      cliente: order.cliente || 'Cliente',
      productos: orderItems(order),
      estado: order.estado || 'Pendiente',
      total: Number(order.total) || 0,
      anticipo: Number(order.anticipo) || 0,
      porCobrar: clean(order.estado || '').includes('cancel') ? null : Math.max((Number(order.total) || 0) - (Number(order.anticipo) || 0), 0),
    })
    const scheduledTomorrow = new Map()
    for (const order of activeUpcoming.filter((item) => deliveryDayKey(item) === tomorrowKey)) {
      for (const item of order.productos || []) {
        if (!item.productoId || item.modalidad === 'bajoPedido') continue
        const entry = scheduledTomorrow.get(item.productoId) || { total: 0, notAlreadyReserved: 0 }
        const quantity = Number(item.cantidad) || 1
        entry.total += quantity
        if (!order.reservaId) entry.notAlreadyReserved += quantity
        scheduledTomorrow.set(item.productoId, entry)
      }
    }
    const replenishment = products.filter((product) => product.modoVenta !== 'bajoPedido').map((product) => {
      const stockActual = Number(product.stock) || 0
      const minimum = Number(product.stockMinimo) || 5
      const scheduled = scheduledTomorrow.get(product.id) || { total: 0, notAlreadyReserved: 0 }
      const availableAfterOrders = Math.max(0, stockActual - scheduled.notAlreadyReserved)
      return { nombre: product.nombre, stockActual, pedidosManana: scheduled.total, disponibleTrasPedidos: availableAfterOrders, minimo: minimum, reponer: Math.max(minimum - availableAfterOrders, 0), unidad: product.unidad || 'pzas' }
    }).filter((item) => item.disponibleTrasPedidos <= item.minimo)
    const revenueFor = (startKey, endKey) => deliveredOrdersForKeys(startKey, endKey).reduce((sum, order) => sum + (Number(order.total) || 0), 0)
    const deliveredOrdersForKeys = (startKey, endKey) => orders.filter((order) => stateOf(order) === workflow[3] && deliveryDayKey(order) >= startKey && deliveryDayKey(order) <= endKey)
    const previousWeekTotal = revenueFor(previousWeekKey, yesterdayKey)
    const yesterdayTotal = revenueFor(yesterdayKey, yesterdayKey)
    const dateLabel = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
    const closedAt = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' }).format(now)
    setCloseReport({
      dateKey: todayKey,
      dateLabel,
      folio: `C-${todayKey.replaceAll('-', '')}-${companyId.slice(0, 4).toUpperCase()}`,
      responsable: user?.displayName || user?.email || user?.uid || 'Responsable no identificado',
      closedAt,
      orderCount: deliveredToday.length,
      total: deliveredToday.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
      ticketAverage: deliveredToday.length ? deliveredToday.reduce((sum, order) => sum + (Number(order.total) || 0), 0) / deliveredToday.length : 0,
      yesterdayTotal,
      previousWeekTotal,
      unitsSold: [...productTotals.values()].reduce((sum, item) => sum + item.cantidad, 0),
      topProduct,
      paymentBreakdown: [...paymentTotals.values()],
      deliveredOrders: deliveredToday.map((order) => ({ folio: orderFolio(order), hora: timeOf(order.creadoEn).split(',').at(-1).trim(), cliente: order.cliente || 'Cliente', productos: orderItems(order), metodoPago: paymentMethodOf(order), total: Number(order.total) || 0 })),
      pendingToday: activeUpcoming.filter((order) => deliveryDayKey(order) === todayKey).map(toUpcomingRow),
      pendingTomorrow: activeUpcoming.filter((order) => deliveryDayKey(order) === tomorrowKey).map(toUpcomingRow),
      cancelledUpcoming: cancelledUpcoming.map((order) => ({ ...toUpcomingRow(order), estado: order.estado || 'Cancelado' })),
      replenishment,
    })
  }

  async function saveCashClose() {
    if (!closeReport || !isOwner) return
    setSavingClose(true)
    setError('')
    try {
      await updateDoc(doc(db, 'empresas', companyId), { [`cierresCajaPorDia.${closeReport.dateKey}`]: { ...closeReport, cerradoEn: serverTimestamp() } })
      setCashClosures((current) => ({ ...current, [closeReport.dateKey]: { ...closeReport, cerradoEn: new Date() } }))
      setToast('Corte de caja guardado')
      setTimeout(() => setToast(''), 2200)
    } catch {
      setError('No se pudo guardar el corte. Verifica que tengas rol owner y permisos para actualizar la tienda.')
    } finally {
      setSavingClose(false)
    }
  }

  async function toggleOrdersPaused() {
    const nextPauseDate = ordersPausedToday ? '' : dateKey(new Date())
    setError('')
    try {
      await updateDoc(doc(db, 'empresas', companyId), { pedidosPausadosHasta: nextPauseDate })
      setOrdersPausedUntil(nextPauseDate)
      setToast(nextPauseDate ? 'Pedidos pausados para hoy; el chat ofrecerá entregas desde mañana.' : 'Se reanudaron los pedidos para hoy.')
      setTimeout(() => setToast(''), 2800)
    } catch {
      setError('No se pudo cambiar la pausa. Verifica que tengas rol owner en esta tienda y las reglas de Firestore.')
    }
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

  async function recordCounterSale(product) {
    const rawQuantity = window.prompt(`¿Cuántas unidades de ${product.nombre} vendiste en mostrador?`, '1')
    if (rawQuantity === null) return
    const quantity = Number(rawQuantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError('Escribe una cantidad entera mayor que cero para registrar la venta.')
      return
    }
    setError('')
    try {
      await runTransaction(db, async (transaction) => {
        const productRef = doc(db, 'empresas', companyId, 'productos', product.id)
        const snapshot = await transaction.get(productRef)
        if (!snapshot.exists()) throw new Error('PRODUCT_NOT_FOUND')
        const currentStock = Number(snapshot.data().stock) || 0
        if (quantity > currentStock) throw new Error('INSUFFICIENT_STOCK')
        transaction.update(productRef, { stock: currentStock - quantity })
      })
      setToast(`Venta en mostrador registrada: ${quantity} ${product.unidad || 'pzas'} de ${product.nombre}`)
      setTimeout(() => setToast(''), 2600)
    } catch (saleError) {
      setError(saleError.message === 'INSUFFICIENT_STOCK'
        ? `No hay suficiente stock de ${product.nombre}; se actualizó el catálogo con las existencias disponibles.`
        : 'No se pudo registrar la venta. Verifica tu conexión y que tengas rol owner.')
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
  if (!user) return <Login companyName={companyName} storeColor={storeColor} />
  if (accessLoading) return <main className="px-6 py-16 text-sm text-slate-500">Verificando acceso al negocio…</main>
  if (!isMember) return <main className="mx-auto max-w-2xl px-5 py-12"><h1 className="text-3xl font-bold">Acceso pendiente</h1><p className="mt-3 text-sm text-slate-600">Agrega un documento con este ID en <code>empresas/{companyId}/miembros</code>:</p><code className="mt-3 block break-all rounded-lg bg-slate-100 p-3 text-xs">{user.uid}</code><button onClick={() => signOut(auth)} className="mt-5 text-sm font-medium text-emerald-800">Cerrar sesión</button></main>

  const dateText = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(now)
  const searched = filteredOrders
  const columns = workflow.map((status) => ({ status, orders: searched.filter((order) => stateOf(order) === status) }))

  return (
    <div style={storeThemeVars(storeColor)} className={`min-h-[calc(100vh-76px)] bg-[#f7f9fc] text-slate-800 ${darkMode ? 'dashboard-dark' : ''}`}>
      <header className="border-b border-slate-200 bg-white px-5 py-4 lg:px-8">
        <div className="mx-auto grid w-full max-w-[1800px] items-center gap-x-6 gap-y-4 lg:grid-cols-2 xl:grid-cols-[minmax(330px,1fr)_minmax(480px,1.45fr)_minmax(270px,.9fr)]">
          <div className="flex min-w-0 items-center gap-3"><CakeMark /><div className="min-w-0"><h1 className="text-lg font-bold leading-tight tracking-tight text-slate-900 2xl:text-xl">{companyName}</h1><span className="mt-2 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800"><i className="size-2 rounded-full bg-emerald-500" />Bot de WhatsApp Activo</span></div></div>
          <div className="grid min-w-0 grid-cols-3 divide-x divide-slate-200">
            <div className="min-w-0 px-3"><p className="text-[11px] text-slate-500">Pedidos hoy</p><p className="mt-1 text-2xl font-bold text-slate-900">{todayOrders.length}</p></div>
            <div className="min-w-0 px-3"><p className="text-[11px] text-slate-500">Ingresos validados</p><p className="mt-1 whitespace-nowrap text-xl font-bold leading-tight text-emerald-700 2xl:text-2xl">{money.format(validatedRevenue)} MXN</p></div>
            <div className="min-w-0 px-3"><p className="text-[11px] text-slate-500">Insumos bajos</p><p className="mt-1 text-2xl font-bold text-amber-700">{lowStock.length}</p></div>
          </div>
          <div className="flex min-w-0 items-center gap-2 lg:col-span-2 xl:col-span-1"><label className="relative min-w-0 flex-1"><span className="sr-only">Buscar pedidos</span><svg viewBox="0 0 24 24" className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente o n.º de orden" className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-xs outline-none placeholder:text-slate-500 focus:border-emerald-600" /></label><button type="button" aria-label={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} aria-pressed={darkMode} title={darkMode ? 'Modo claro' : 'Modo oscuro'} onClick={() => setDarkMode((current) => { const next = !current; window.localStorage.setItem('dashboard-theme', next ? 'dark' : 'light'); return next })} className="grid size-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">{darkMode ? <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg> : <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/></svg>}</button></div>
        </div>
      </header>

      <nav className="border-b border-white/20 px-5 lg:px-8" style={{ backgroundColor: storeColor }}><div className="mx-auto flex max-w-[1800px] items-center gap-7 overflow-x-auto">
        {[['live', 'Operación en vivo'], ['history', 'Historial de pedidos'], ['inventory', 'Inventario']].map(([key, label]) => <button key={key} onClick={() => onTabChange(key)} className={`relative flex h-12 shrink-0 items-center gap-2.5 text-xs font-semibold ${activeTab === key ? 'text-white' : 'text-white/75 hover:text-white'}`}><NavIcon name={key} />{label}{activeTab === key && <i className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-white" />}</button>)}
        <button onClick={() => onTabChange('forecast')} className={`relative hidden h-12 shrink-0 items-center gap-2 text-xs font-medium lg:flex ${activeTab === 'forecast' ? 'text-white' : 'text-white/75 hover:text-white'}`}><NavIcon name="forecast" />Pronóstico{activeTab === 'forecast' && <i className="absolute inset-x-0 bottom-0 h-[3px] rounded-t bg-white" />}</button>
        <span className="hidden shrink-0 items-center gap-2 py-3 text-xs text-white/80 md:flex"><NavIcon name="calendar" /> <span className="capitalize">{dateText}</span></span>
        <button onClick={onOpenChat} className="shrink-0 py-3 text-[11px] font-medium text-white hover:text-white/80">Abrir chat</button>
        <button onClick={onChooseStore} className="shrink-0 rounded-lg border border-white/35 px-3 py-2 text-[11px] font-medium text-white transition hover:bg-white/10">Cambiar tienda</button>
        <button onClick={() => signOut(auth)} className="shrink-0 rounded-lg bg-rose-600 px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">Cerrar sesión</button>
      </div></nav>

      <main className="mx-auto max-w-[1800px] px-5 py-5 lg:px-8 lg:py-6">
        {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {activeTab === 'live' && <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_280px] 2xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0">
            <WeeklyPlanner orders={orders} />
            <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><div className="flex flex-wrap items-center gap-3"><h2 className="text-2xl font-bold tracking-tight text-slate-900">Tablero de Pedidos en Vivo</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700">● En vivo</span></div><p className="mt-1.5 text-xs text-slate-500">Cada pedido en su lugar. Todo bajo control.</p></div><div className="flex flex-wrap items-center gap-2"><label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600">◷<select value={period} onChange={(event) => setPeriod(event.target.value)} className="bg-transparent outline-none"><option value="today">Todo el día</option><option value="week">Últimos 7 días</option><option value="all">Todo el historial</option></select></label><button onClick={toggleOrdersPaused} disabled={!isOwner} aria-pressed={ordersPausedToday} title={!isOwner ? 'Solo el owner puede cambiar la pausa' : ordersPausedToday ? 'Reanudar pedidos para hoy' : 'Pausar pedidos para hoy'} className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 ${ordersPausedToday ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100' : 'border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}><svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ordersPausedToday ? <path d="M8 5v14l11-7-11-7Z" fill="currentColor" stroke="none"/> : <><rect x="4" y="4" width="6" height="16" rx="1"/><rect x="14" y="4" width="6" height="16" rx="1"/></>}</svg>{ordersPausedToday ? 'Reanudar pedidos' : 'Pausar pedidos'}</button><button onClick={openCashClose} disabled={!isOwner} title={!isOwner ? 'Solo el owner puede cerrar caja' : 'Preparar el corte de caja de hoy'} style={{ backgroundColor: storeColor }} className="flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"><svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 11h18M8 6V4h8v2M8 15h3"/><circle cx="17" cy="15" r="1" fill="currentColor" stroke="none"/></svg>{cashClosures[todayKey] ? 'Ver corte' : 'Cerrar caja'}</button></div></div>
            <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-4">{columns.map(({ status, orders: columnOrders }) => <section key={status} className="min-w-0 rounded-xl border border-slate-200 bg-[#eef3f8] p-2"><header className="flex items-center justify-between px-1 py-2"><h3 className="flex items-center gap-2 text-[11px] font-semibold text-slate-700"><i className={`size-2 rounded-full ${status === workflow[0] ? 'bg-amber-500' : status === workflow[1] ? 'bg-blue-500' : status === workflow[2] ? 'bg-emerald-500' : 'bg-slate-400'}`} />{status}</h3><span className={`grid size-6 place-items-center rounded-md text-[10px] font-semibold ${status === workflow[0] ? 'bg-amber-100 text-amber-800' : status === workflow[1] ? 'bg-blue-100 text-blue-800' : status === workflow[2] ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>{columnOrders.length}</span></header><div className="space-y-2">{columnOrders.map((order) => <OrderCard key={order.id} order={order} onStatus={changeStatus} onTicket={setTicket} />)}{columnOrders.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-6 text-center text-xs text-slate-400">Sin pedidos</p>}</div></section>)}</div>
          </section>
          <InventoryPanel products={products} canEdit={isOwner} onChange={changeStock} onCounterSale={recordCounterSale} forecastByProduct={forecastByProduct} onCreate={() => { setError(''); setCreateOpen(true) }} onEdit={(product) => { setError(''); setEditingProduct(product) }} />
        </div>}

        {activeTab === 'history' && <section><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-900">Historial de pedidos</h2><p className="mt-1 text-sm text-slate-500">Todos los pedidos de {companyName}.</p></div><span className="text-sm text-slate-500">{filteredOrders.length} resultados</span></div><div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Orden</th><th className="px-5 py-3">Cliente</th><th className="px-5 py-3">Productos</th><th className="px-5 py-3">Entrega</th><th className="px-5 py-3">Total</th><th className="px-5 py-3">Estado</th><th className="px-5 py-3" /></tr></thead><tbody className="divide-y divide-slate-100">{filteredOrders.map((order) => <tr key={order.id}><td className="px-5 py-4 font-semibold">#{order.id.slice(-6).toUpperCase()}</td><td className="px-5 py-4">{order.cliente || 'Cliente'}</td><td className="max-w-xs truncate px-5 py-4 text-slate-500">{orderItems(order)}</td><td className="px-5 py-4">{timeOf(order.entrega)}</td><td className="px-5 py-4 font-semibold">{orderTotalText(order)}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{order.estado}</span></td><td className="px-5 py-4"><button onClick={() => setTicket(order)} className="text-xs font-semibold text-emerald-800">Ver ticket</button></td></tr>)}</tbody></table>{filteredOrders.length === 0 && <p className="p-12 text-center text-sm text-slate-500">No hay pedidos para mostrar.</p>}</div></div></section>}

        {activeTab === 'inventory' && <section><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-900">Inventario</h2><p className="mt-1 text-sm text-slate-500">Existencias y estimación según pedidos validados de los últimos 30 días.</p></div>{isOwner && <button onClick={() => { setError(''); setCreateOpen(true) }} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-900">＋ Agregar producto</button>}</div><div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{products.map((product) => <div key={product.id} className="rounded-2xl border border-slate-200 bg-white p-5"><StockItem product={product} canEdit={isOwner} onChange={changeStock} onCounterSale={recordCounterSale} onEdit={setEditingProduct} forecast={forecastByProduct.get(product.id)} /><p className="mt-2 text-xs text-slate-500">{money.format(Number(product.precio) || 0)} por unidad</p></div>)}</div>{products.length === 0 && <p className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">Agrega productos a la subcolección productos de esta empresa.</p>}</section>}

        {activeTab === 'forecast' && <ForecastView products={forecastProducts} forecastByProduct={forecastByProduct} targetDays={targetDays} onTargetDaysChange={setTargetDays} />}
      </main>
      <footer className="mx-auto flex max-w-[1800px] items-center justify-between px-5 pb-5 text-xs text-slate-500 lg:px-8"><span className="flex items-center gap-2"><i className="size-2 rounded-full bg-emerald-500" />Todos los cambios guardados</span><span className="hidden sm:block">Sincronización en tiempo real · {companyName}</span></footer>

      {toast && <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg">{toast}</div>}
      {activeTab === 'live' && <button onClick={() => setCreateOpen(true)} className="fixed bottom-6 right-6 z-30 rounded-full bg-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-900 2xl:hidden">＋ Producto</button>}
      {(createOpen || editingProduct) && isOwner && <ProductDialog product={editingProduct} onClose={() => { setCreateOpen(false); setEditingProduct(null); setError('') }} onSave={saveProduct} saving={creating} error={error} isPizzeria={isPizzeria} />}
      {closeReport && <CashCloseDialog report={closeReport} companyName={companyName} alreadySaved={Boolean(cashClosures[closeReport.dateKey])} saving={savingClose} pdfError={pdfError} onPrint={() => setPdfError(printCashClose(closeReport, companyName) ? '' : 'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para guardar el corte como PDF.')} onSave={saveCashClose} onClose={() => setCloseReport(null)} />}      {ticket && <div role="presentation" onClick={() => setTicket(null)} className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"><section role="dialog" aria-modal="true" aria-label="Detalle del pedido" onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-emerald-700">{companyName}</p><h2 className="mt-1 text-xl font-bold">Pedido #{ticket.id.slice(-6).toUpperCase()}</h2></div><button onClick={() => setTicket(null)} className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600">×</button></div><div className="mt-5 space-y-3 text-sm"><p><span className="text-slate-500">Cliente:</span> {ticket.cliente || 'Pedido por chat'}</p><p><span className="text-slate-500">Entrega:</span> {timeOf(ticket.entrega)}</p><div className="border-y border-dashed border-slate-200 py-3"><p className="mb-2 text-slate-500">Productos</p><p>{orderItems(ticket)}</p></div><p className="flex justify-between text-base font-bold"><span>{clean(ticket.estado || '').includes('cotiz') ? 'Precio' : 'Total'}</span><span>{orderTotalText(ticket)}</span></p><p className="text-slate-500">Estado: {ticket.estado || 'Pendiente de pago'}</p></div><button onClick={() => setTicket(null)} className="mt-5 w-full rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white">Cerrar</button></section></div>}
    </div>
  )
}

function CashCloseDialog({ report, companyName, alreadySaved, saving, pdfError, onPrint, onSave, onClose }) {
  const upcoming = [...report.pendingToday, ...report.pendingTomorrow, ...report.cancelledUpcoming]
  return <div role="presentation" onClick={onClose} className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/50 p-4"><section role="dialog" aria-modal="true" aria-label="Corte de caja del día" onClick={(event) => event.stopPropagation()} className="my-auto w-full max-w-4xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{companyName}</p><h2 className="mt-1 text-2xl font-bold text-slate-900">Corte de caja del día</h2><p className="mt-1 text-sm capitalize text-slate-500">{report.dateLabel} · Folio {report.folio}</p><p className="mt-1 text-xs text-slate-500">Responsable: {report.responsable} · Generado a las {report.closedAt}</p></div><button onClick={onClose} aria-label="Cerrar" className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-lg text-slate-600">×</button></div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs text-emerald-800">Ventas entregadas hoy</p><p className="mt-2 text-2xl font-bold text-emerald-900">{money.format(report.total)} MXN</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Pedidos · unidades</p><p className="mt-2 text-2xl font-bold text-slate-900">{report.orderCount} · {report.unitsSold}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Ticket promedio</p><p className="mt-2 text-2xl font-bold text-slate-900">{money.format(report.ticketAverage)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Ayer · 7 días previos</p><p className="mt-2 text-sm font-bold text-slate-900">{money.format(report.yesterdayTotal)} · {money.format(report.previousWeekTotal)}</p></div></div>
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(240px,.7fr)]"><section className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">Producto estrella</h3><p className="mt-1 text-sm text-slate-600">{report.topProduct ? `${report.topProduct.nombre} · ${report.topProduct.cantidad} unidades` : 'No hay productos en pedidos entregados hoy.'}</p></section><section className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-semibold text-slate-900">Método de pago registrado</h3>{report.paymentBreakdown.length ? <div className="mt-2 space-y-1.5">{report.paymentBreakdown.map((payment) => <p key={payment.metodo} className="flex justify-between gap-2 text-xs"><span className="text-slate-600">{payment.metodo} ({payment.cantidad})</span><strong>{money.format(payment.total)}</strong></p>)}</div> : <p className="mt-1 text-xs text-slate-500">No hay método de pago guardado en las órdenes.</p>}</section></div>
    <section className="mt-5"><h3 className="text-sm font-semibold text-slate-900">Detalle de pedidos entregados hoy</h3><div className="mt-2 max-h-56 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">Folio</th><th className="px-3 py-2.5">Hora de registro</th><th className="px-3 py-2.5">Cliente</th><th className="px-3 py-2.5">Productos</th><th className="px-3 py-2.5">Método</th><th className="px-3 py-2.5">Importe</th></tr></thead><tbody className="divide-y divide-slate-100">{report.deliveredOrders.map((order) => <tr key={order.folio}><td className="px-3 py-2.5 font-semibold">#{order.folio}</td><td className="px-3 py-2.5">{order.hora}</td><td className="px-3 py-2.5">{order.cliente}</td><td className="max-w-xs px-3 py-2.5 text-slate-600">{order.productos}</td><td className="px-3 py-2.5">{order.metodoPago}</td><td className="px-3 py-2.5 font-semibold">{money.format(order.total)}</td></tr>)}{!report.deliveredOrders.length && <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-500">No hay pedidos entregados hoy.</td></tr>}</tbody></table></div></section>
    <section className="mt-5"><h3 className="text-sm font-semibold text-slate-900">Pedidos por cobrar o entregar hoy y mañana</h3><div className="mt-2 max-h-48 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[700px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">Entrega</th><th className="px-3 py-2.5">Folio</th><th className="px-3 py-2.5">Cliente</th><th className="px-3 py-2.5">Productos</th><th className="px-3 py-2.5">Estado</th><th className="px-3 py-2.5">Total</th><th className="px-3 py-2.5">Anticipo registrado</th><th className="px-3 py-2.5">Saldo estimado</th></tr></thead><tbody className="divide-y divide-slate-100">{upcoming.map((order, index) => <tr key={`${order.folio}-${index}`}><td className="px-3 py-2.5">{order.fechaLabel}</td><td className="px-3 py-2.5 font-semibold">#{order.folio}</td><td className="px-3 py-2.5">{order.cliente}</td><td className="max-w-xs px-3 py-2.5 text-slate-600">{order.productos}</td><td className="px-3 py-2.5">{order.estado}</td><td className="px-3 py-2.5">{money.format(order.total)}</td><td className="px-3 py-2.5">{order.anticipo ? money.format(order.anticipo) : "—"}</td><td className="px-3 py-2.5">{order.porCobrar === null ? "—" : money.format(order.porCobrar)}</td></tr>)}{!upcoming.length && <tr><td colSpan="8" className="px-3 py-6 text-center text-slate-500">No hay pedidos activos ni cancelados para hoy y mañana.</td></tr>}</tbody></table></div></section>
    <section className="mt-5"><div><h3 className="text-sm font-semibold text-slate-900">Reposición considerando pedidos de mañana</h3><p className="mt-1 text-xs text-slate-500">Los pedidos del chat con reserva ya descontaron su stock; se restan solo órdenes sin reserva para evitar doble conteo.</p></div><div className="mt-2 max-h-44 overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[680px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-3 py-2.5">Producto</th><th className="px-3 py-2.5">Stock actual</th><th className="px-3 py-2.5">Pedido mañana</th><th className="px-3 py-2.5">Disponible ajustado</th><th className="px-3 py-2.5">Mínimo</th><th className="px-3 py-2.5">Surtir</th></tr></thead><tbody className="divide-y divide-slate-100">{report.replenishment.map((item) => <tr key={item.nombre}><td className="px-3 py-2.5 font-medium">{item.nombre}</td><td className="px-3 py-2.5">{item.stockActual} {item.unidad}</td><td className="px-3 py-2.5">{item.pedidosManana} {item.unidad}</td><td className="px-3 py-2.5">{item.disponibleTrasPedidos} {item.unidad}</td><td className="px-3 py-2.5">{item.minimo} {item.unidad}</td><td className="px-3 py-2.5 font-semibold text-amber-800">+{item.reponer} {item.unidad}</td></tr>)}{!report.replenishment.length && <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-500">No hay productos bajo mínimo después de considerar los pedidos de mañana.</td></tr>}</tbody></table></div></section>
    <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">Este sistema no registra todavía el efectivo contado/fondo inicial, gastos, retiros, propinas ni la fecha de cobro de anticipos y abonos. No se muestran descuentos, devoluciones, mermas ni IVA porque esos campos no existen en las órdenes. El método de pago se desglosa solo si ya está guardado. Las ventas en mostrador solo descuentan stock, no se guardan como transacciones y quedan fuera del total. El inventario registra productos, no ingredientes ni recetas.</p>
    {pdfError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-800">{pdfError}</p>}
    <div className="mt-6 flex flex-wrap justify-end gap-2"><button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cerrar</button><button onClick={onPrint} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Exportar PDF</button><button onClick={onSave} disabled={saving} className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{saving ? 'Guardando…' : alreadySaved ? 'Actualizar corte guardado' : 'Guardar cierre del día'}</button></div>
  </section></div>
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

function InventoryPanel({ products, canEdit, onChange, onCounterSale, onCreate, onEdit, forecastByProduct }) {
  const alerts = products.filter((product) => product.modoVenta !== 'bajoPedido' && Number(product.stock) <= 5).length
  return <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,.03)] sm:p-6 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto xl:overscroll-contain"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-900">Inventario en Vivo</h2><p className="mt-1.5 text-xs text-slate-500">Stock y pronóstico por ventas validadas (30 días).</p><button disabled={!canEdit} onClick={onCreate} className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:hidden">＋ Agregar producto</button></div><span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${alerts ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}`}>⚠ {alerts} alertas</span></div><div className="mt-5 border-t border-slate-200 pt-4">{products.slice(0, 8).map((product) => <StockItem key={product.id} product={product} canEdit={canEdit} onChange={onChange} onCounterSale={onCounterSale} onEdit={onEdit} forecast={forecastByProduct.get(product.id)} />)}{products.length === 0 && <p className="py-8 text-center text-xs text-slate-500">Aún no hay productos en el inventario.</p>}</div>{!canEdit && products.length > 0 && <p className="mt-2 text-[10px] text-slate-400">Solicita el rol owner para ajustar existencias.</p>}</aside>
}
