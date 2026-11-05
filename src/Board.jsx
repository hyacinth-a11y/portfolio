import { useState } from 'react'
import { displayValue, ticketKey, checklistProgress, matches } from './format.js'
import { COLORS } from './api.js'

export default function Board({ statuses, fields, tickets, actions, onOpen }) {
  const [q, setQ] = useState('')
  const [dragId, setDragId] = useState(null)
  const [over, setOver] = useState(null) // {status, beforeId}
  const [adding, setAdding] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [newCol, setNewCol] = useState('')

  const cardFields = fields.filter(f => f.show_on_card)
  const colTickets = sid => tickets
    .filter(t => (t.status_id ?? statuses[0]?.id) === sid && matches(t, q, fields))
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
    await actions.createTicket(sid, title)
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
        <span className="muted small">{tickets.length} tickets</span>
      </div>
      <div className="board">
        {statuses.map(s => {
          const list = colTickets(s.id)
          return (
            <section key={s.id} className={'column' + (over?.status === s.id ? ' over' : '')}
              onDragOver={e => { e.preventDefault(); if (over?.status !== s.id || over.beforeId) setOver({ status: s.id, beforeId: null }) }}
              onDrop={e => { e.preventDefault(); drop(s.id, over?.status === s.id ? over.beforeId : null) }}>
              <header className="col-head">
                <span className="dot" style={{ background: s.color }} />
                <span className="col-name">{s.name}</span>
                <span className="count">{list.length}</span>
              </header>
              <div className="cards">
                {list.map(t => {
                  const prog = checklistProgress(t)
                  return (
                    <article key={t.id} draggable
                      className={'ticket' + (dragId === t.id ? ' dragging' : '') + (over?.beforeId === t.id ? ' drop-before' : '')}
                      onDragStart={e => { setDragId(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id) }}
                      onDragEnd={() => { setDragId(null); setOver(null) }}
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (over?.beforeId !== t.id) setOver({ status: s.id, beforeId: t.id }) }}
                      onDrop={e => { e.preventDefault(); e.stopPropagation(); drop(s.id, t.id) }}
                      onClick={() => onOpen(t.id)}>
                      <div className="ticket-title">{t.title}</div>
                      {cardFields.map(f => {
                        const v = displayValue(f, t.custom?.[f.id])
                        return v ? <div key={f.id} className="card-field"><span className="muted">{f.type === 'checkbox' ? '' : f.name + ': '}</span>{v}</div> : null
                      })}
                      <div className="ticket-foot">
                        <span className="key">{ticketKey(t)}</span>
                        {prog && <span className={'prog' + (prog.done === prog.total ? ' full' : '')}>☑ {prog.done}/{prog.total}</span>}
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
                    onBlur={() => { if (!newTitle.trim()) setAdding(null) }} />
                  <div className="row"><button className="primary" type="submit">Create</button>
                    <button type="button" className="ghost" onClick={() => setAdding(null)}>Cancel</button></div>
                </form>
              ) : (
                <button className="add-card" onClick={() => { setAdding(s.id); setNewTitle('') }}>+ Create</button>
              )}
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
