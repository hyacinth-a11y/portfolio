// Search box that finds tickets by key or title and lets you pick one.
import { useEffect, useRef, useState } from 'react'
import { ticketKey, typeOf } from './format.js'

export default function TicketPicker({ candidates, onPick, onClose, placeholder = 'Search by key or name…', autoFocus = true, note }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef(null)
  const query = q.trim().toLowerCase()
  const results = candidates
    .filter(t => !query || ticketKey(t).toLowerCase().includes(query) || t.title.toLowerCase().includes(query))
    .sort((a, b) => {
      // exact key match first, then key prefix, then title
      const ka = ticketKey(a).toLowerCase(), kb = ticketKey(b).toLowerCase()
      return (kb === query) - (ka === query) || (kb.startsWith(query)) - (ka.startsWith(query)) || a.title.localeCompare(b.title)
    })
    .slice(0, 8)

  useEffect(() => { setActive(0) }, [q])
  useEffect(() => {
    if (!onClose) return
    const h = e => { if (box.current && !box.current.contains(e.target)) onClose() }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [onClose])

  const pick = t => { if (t) { onPick(t); setQ('') } }
  return (
    <div className="picker" ref={box}>
      <input autoFocus={autoFocus} value={q} placeholder={placeholder} onChange={e => setQ(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); pick(results[active]) }
          if (e.key === 'Escape') { e.stopPropagation(); onClose ? onClose() : setQ('') }
        }} />
      {(q || onClose) && (
        <div className="picker-list">
          {results.length === 0 && <div className="picker-empty muted small">No matching tickets</div>}
          {results.map((t, i) => (
            <div key={t.id} className={'picker-row' + (i === active ? ' active' : '')}
              onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(t) }}>
              <span style={{ color: typeOf(t).color }} title={typeOf(t).label}>{typeOf(t).icon}</span>
              <span className="key">{ticketKey(t)}</span>
              <span className="picker-title">{t.title}</span>
              {note && <span className="muted small">{note(t)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
