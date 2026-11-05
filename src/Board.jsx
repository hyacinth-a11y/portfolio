import { useState } from 'react'
import { displayValue, ticketKey, checklistProgress, matches, WORK_TYPES, typeOf } from './format.js'
import { COLORS } from './api.js'

export default function Board({ statuses, fields, tickets, actions, onOpen }) {
  const [q, setQ] = useState('')
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null) // {status, beforeId}
  const [dragCol, setDragCol] = useState(null)
  // collapsed columns are remembered in this browser
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('pb-collapsed') || '[]')) } catch { return new Set() }
  })
  const toggleCol = id => setCollapsed(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id)
    try { localStorage.setItem('pb-collapsed', JSON.stringify([...next])) } catch {}
    return next
  })
  const [colOver, setColOver] = useState(null) // {id, side: 'left'|'right'}

  async function dropCol() {
    const from = dragCol, target = colOver
    setDragCol(null); setColOver(null)
    if (!from || !target || target.id === from) return
    const ids = statuses.map(x => x.id).filter(id => id !== from)
    let idx = ids.indexOf(target.id) + (target.side === 'right' ? 1 : 0)
    ids.splice(idx, 0, from)
    await Promise.all(ids.map((id, i) =>
      statuses.find(x => x.id === id).position !== i ? actions.saveRow('statuses', 'statuses', { id, position: i }) : null))
  }
  const [adding, setAdding] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [newCol, setNewCol] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [newType, setNewType] = useState('project')
  const byId = Object.fromEntries(tickets.map(t => [t.id, t]))
  const childCount = {}
  tickets.forEach(t => { if (t.parent_id) childCount[t.parent_id] = (childCount[t.parent_id] || 0) + 1 })

  const cardFields = fields.filter(f => f.show_on_card)
  const colTickets = sid => tickets
    .filter(t => (t.status_id ?? statuses[0]?.id) === sid && matches(t, q, fields) && (typeFilter === 'all' || typeOf(t).value === typeFilter))
    .sort((a, b) => a.position - b.position)

  function drop(statusId, beforeId) {
    const t = tickets.find(x => x.id === dragId)
    setDragId(null); setOver(null)
    if (!t) return
    const list = tickets.filter(x => (x.status_id ?? statuses[0]?.id) === statusId && x.id !== t.id)
      .sort((a, b) => a.position - b.position)
    let idx = beforeId ? list.findIndex(x => x.id === beforeId) : list.length
    if (idx < 0) idx = list.length
    const prev = list[idx - 1]?.position, next = list[idx]?.position
    const position = prev == null && next == null ? 1
      : prev == null ? next - 1 : next == null ? prev + 1 : (prev + next) / 2
    if (t.status_id === statusId && t.position === position) return
    actions.updateTicket(t.id, { status_id: statusId, position })
  }

  async function addTicket(sid) {
    const title = newTitle.trim()
    if (!title) { setAdding(null); return }
    setNewTitle('')
    await actions.createTicket(sid, title, { work_type: newType })
  }

  async function addColumn(e) {
    e.preventDefault()
    if (!newCol.trim()) return
    await actions.saveRow('statuses', 'statuses', {
      name: newCol.trim(), color: COLORS[statuses.length % COLORS.length],
      position: Math.max(-1, ...statuses.map(s => s.position)) + 1,
    })
    setNewCol('')
  }

  return (
    <main className="board-wrap">
      <div className="toolbar">
        <input className="search" placeholder="Search tickets…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="type-filter">
          {[{ value: 'all', label: 'All' }, ...WORK_TYPES].map(w => (
            <button key={w.value} className={'chip' + (typeFilter === w.value ? ' on' : '')} onClick={() => setTypeFilter(w.value)}>
              {w.icon && <span style={{ color: w.color }}>{w.icon} </span>}{w.label}
              <span className="muted"> {w.value === 'all' ? tickets.length : tickets.filter(t => typeOf(t).value === w.value).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="board">
        {statuses.map(s => {
          const list = colTickets(s.id)
          const isCollapsed = collapsed.has(s.id)
          return (
            <section key={s.id}
              onClick={isCollapsed ? () => toggleCol(s.id) : undefined}
              className={'column' + (isCollapsed ? ' collapsed' : '') + (!dragCol && over?.status === s.id ? ' over' : '') + (dragCol === s.id ? ' col-dragging' : '') +
                (dragCol && colOver?.id === s.id && dragCol !== s.id ? ' col-drop-' + colOver.side : '')}
              onDragOver={e => {
                e.preventDefault()
                if (dragCol) {
                  const r = e.currentTarget.getBoundingClientRect()
                  const side = e.clientX < r.left + r.width / 2 ? 'left' : 'right'
                  if (colOver?.id !== s.id || colOver.side !== side) setColOver({ id: s.id, side })
                  return
                }
                if (over?.status !== s.id || over.beforeId) setOver({ status: s.id, beforeId: null })
              }}
              onDrop={e => { e.preventDefault(); if (dragCol) return dropCol(); drop(s.id, over?.status === s.id ? over.beforeId : null) }}>
              <header className="col-head" draggable title="Drag to reorder columns"
                onDragStart={e => { setDragCol(s.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'col:' + s.id) }}
                onDragEnd={() => { setDragCol(null); setColOver(null) }}>
                <button className="collapse-btn" title={isCollapsed ? 'Expand column' : 'Collapse column'}
                  onClick={e => { e.stopPropagation(); toggleCol(s.id) }} onMouseDown={e => e.stopPropagation()}>
                  {isCollapsed ? '›' : '‹'}
                </button>
                {!isCollapsed && <span className="grip" aria-hidden>⋮⋮</span>}
                <span className="dot" style={{ background: s.color }} />
                <span className="col-name">{s.name}</span>
                <span className="count">{list.length}</span>
              </header>
              {!isCollapsed && <>
              <div className="cards">
                {list.map(t => {
                  const prog = checklistProgress(t)
                  const wt = typeOf(t), parent = byId[t.parent_id]
                  return (
                    <article key={t.id} draggable
                      className={'ticket' + (dragId === t.id ? ' dragging' : '') + (over?.beforeId === t.id ? ' drop-before' : '')}
                      onDragStart={e => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id) }}
                      onDragEnd={() => { setDragId(null); setOver(null) }}
                      onDragOver={e => { if (dragCol) return; e.preventDefault(); e.stopPropagation(); if (over?.beforeId !== t.id) setOver({ status: s.id, beforeId: t.id }) }}
                      onDrop={e => { if (dragCol) return; e.preventDefault(); e.stopPropagation(); drop(s.id, t.id) }}
                      onClick={() => onOpen(t.id)}>
                      {parent && <div className="parent-line" title={ticketKey(parent) + ' ' + parent.title}>↳ {parent.title}</div>}
                      <div className="ticket-title">{t.title}</div>
                      {cardFields.map(f => {
                        const v = displayValue(f, t.custom?.[f.id])
                        return v ? <div key={f.id} className="card-field"><span className="muted">{f.type === 'checkbox' ? '' : f.name + ': '}</span>{v}</div> : null
                      })}
                      <div className="ticket-foot">
                        <span className="key"><span className="type-icon" style={{ color: wt.color }} title={wt.label}>{wt.icon}</span> {ticketKey(t)}</span>
                        <span className="foot-right">
                          {childCount[t.id] > 0 && <span className="muted" title="Child items">⑂ {childCount[t.id]}</span>}
                          {prog && <span className={'prog' + (prog.done === prog.total ? ' full' : '')}>☑ {prog.done}/{prog.total}</span>}
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
              {adding === s.id ? (
                <form onSubmit={e => { e.preventDefault(); addTicket(s.id) }} className="quick-add">
                  <textarea autoFocus placeholder="What needs to be done?" value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addTicket(s.id) } if (e.key === 'Escape') setAdding(null) }}
                    onBlur={e => { if (!newTitle.trim() && !e.currentTarget.form.contains(e.relatedTarget)) setAdding(null) }} />
                  <div className="row">
                    <select className="type-select" value={newType} onChange={e => setNewType(e.target.value)} onMouseDown={e => e.stopPropagation()}>
                      {WORK_TYPES.map(w => <option key={w.value} value={w.value}>{w.icon} {w.label}</option>)}
                    </select>
                    <button className="primary" type="submit">Create</button>
                    <button type="button" className="ghost" onClick={() => setAdding(null)}>Cancel</button></div>
                </form>
              ) : (
                <button className="add-card" onClick={() => { setAdding(s.id); setNewTitle('') }}>+ Create</button>
              )}
              </>}
            </section>
          )
        })}
        <form className="column new-col" onSubmit={addColumn}>
          <input placeholder="+ Add status column" value={newCol} onChange={e => setNewCol(e.target.value)} />
          {newCol && <button className="primary" type="submit">Add</button>}
        </form>
      </div>
    </main>
  )
}
