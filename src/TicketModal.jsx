import { useEffect, useState } from 'react'
import { api, newId } from './api.js'
import FieldInput from './FieldInput.jsx'
import TicketPicker from './TicketPicker.jsx'
import { RichEditor, RichView } from './RichText.jsx'
import { ticketKey, WORK_TYPES, typeOf, levelOf, descendants } from './format.js'

// Renders plain text with [text](url) links, **bold** and bare URLs.
function Linkify({ text }) {
  const parts = String(text).split(/(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|https?:\/\/[^\s<>()]+)/g)
  return parts.map((p, i) => {
    const md = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (md) return <a key={i} href={md[2]} target="_blank" rel="noreferrer">{md[1]}</a>
    if (/^\*\*[^*]+\*\*$/.test(p)) return <b key={i}>{p.slice(2, -2)}</b>
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a>
    return p
  })
}

export default function TicketModal({ ticket, tickets, onOpen, statuses, fields, templates, actions, onClose }) {
  const [childTitle, setChildTitle] = useState('')
  const wt = typeOf(ticket)
  const byId = Object.fromEntries(tickets.map(t => [t.id, t]))
  const children = tickets.filter(t => t.parent_id === ticket.id).sort((a, b) => (a.number || 0) - (b.number || 0))
  const lowerTypes = WORK_TYPES.filter(w => w.level > wt.level)
  const [childType, setChildType] = useState(null)
  const [parentPicker, setParentPicker] = useState(false)
  const [childMode, setChildMode] = useState('create') // create | existing
  useEffect(() => { setParentPicker(false); setChildMode('create') }, [ticket.id])
  const childCandidates = tickets.filter(t => t.id !== ticket.id && t.parent_id !== ticket.id && levelOf(t) > wt.level)
  const chosenChildType = lowerTypes.find(w => w.value === childType) || lowerTypes[0]
  // breadcrumb: parent chain
  const chain = []
  for (let p = byId[ticket.parent_id], guard = 0; p && guard < 10; p = byId[p.parent_id], guard++) chain.unshift(p)
  const blocked = descendants(ticket.id, tickets)
  const parentOptions = tickets.filter(t => t.id !== ticket.id && !blocked.has(t.id) && levelOf(t) < wt.level)
    .sort((a, b) => levelOf(a) - levelOf(b) || a.title.localeCompare(b.title))
  const statusName = id => statuses.find(s => s.id === id)?.name || ''

  function changeType(v) {
    const nt = WORK_TYPES.find(w => w.value === v)
    const badChild = children.find(c => levelOf(c) <= nt.level)
    if (badChild) return alert(`Can't make this a ${nt.label}: it has a child "${badChild.title}" that is a ${typeOf(badChild).label}. Move or change that child first.`)
    const parent = byId[ticket.parent_id]
    if (parent && levelOf(parent) >= nt.level) {
      if (!confirm(`A ${nt.label} can't sit under a ${typeOf(parent).label}. Remove its parent "${parent.title}"?`)) return
      return upd({ work_type: v, parent_id: null })
    }
    upd({ work_type: v })
  }
  async function addChild(e) {
    e.preventDefault()
    if (!childTitle.trim() || !chosenChildType) return
    await actions.createTicket(statuses[0].id, childTitle.trim(), { work_type: chosenChildType.value, parent_id: ticket.id })
    setChildTitle('')
  }

  const [title, setTitle] = useState(ticket.title)
  const [editDesc, setEditDesc] = useState(false)
  const [comments, setComments] = useState(null)
  const [newComment, setNewComment] = useState('')

  useEffect(() => { setTitle(ticket.title); setEditDesc(false) }, [ticket.id])
  useEffect(() => {
    api.listBy('comments', 'ticket_id', ticket.id)
      .then(c => setComments(c.sort((a, b) => a.created_at.localeCompare(b.created_at))))
      .catch(e => actions.setError(e.message))
  }, [ticket.id])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && !document.activeElement?.matches('input,textarea,select,[contenteditable=true]')) onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const upd = patch => actions.updateTicket(ticket.id, patch)
  const setCustom = (fid, val) => {
    const custom = { ...(ticket.custom || {}) }
    if (val == null || (Array.isArray(val) && !val.length)) delete custom[fid]; else custom[fid] = val
    upd({ custom })
  }
  const addOption = (field, o) => actions.saveRow('fields', 'fields', { ...field, options: [...field.options, o] })

  async function addComment(e) {
    e.preventDefault()
    if (!newComment.trim()) return
    const c = await api.insertOne('comments', { ticket_id: ticket.id, body: newComment.trim() })
    setComments(cs => [...cs, c]); setNewComment('')
  }
  async function delComment(id) {
    setComments(cs => cs.filter(c => c.id !== id))
    await api.remove('comments', id)
  }

  // checklists
  const lists = ticket.checklists || []
  const setLists = checklists => upd({ checklists })
  const addList = tplId => {
    const tpl = templates.find(t => t.id === tplId)
    setLists([...lists, tpl
      ? { id: newId(), title: tpl.name, items: tpl.items.map(text => ({ id: newId(), text, done: false })) }
      : { id: newId(), title: 'Checklist', items: [] }])
  }
  const editList = (id, fn) => setLists(lists.map(l => l.id === id ? fn(l) : l))

  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <div className="crumbs">
            {chain.map(p => <span key={p.id}><button className="link small" onClick={() => onOpen(p.id)}>
              <span style={{ color: typeOf(p).color }}>{typeOf(p).icon}</span> {ticketKey(p)}</button> <span className="muted">/</span> </span>)}
            <span className="key"><span style={{ color: wt.color }}>{wt.icon}</span> {ticketKey(ticket)}</span>
            {wt.level > 0 && (
              <span className="parent-ctl">
                <button className="ghost small parent-btn" onClick={() => setParentPicker(v => !v)}>
                  {ticket.parent_id ? '✎ Change parent' : '+ Add parent'}
                </button>
                {parentPicker && (
                  <div className="parent-pop">
                    <div className="muted small pop-title">
                      Choose a parent ({WORK_TYPES.filter(w => w.level < wt.level).map(w => w.label).join(' or ')})
                    </div>
                    <TicketPicker candidates={parentOptions} onClose={() => setParentPicker(false)}
                      onPick={p => { upd({ parent_id: p.id }); setParentPicker(false) }} />
                    {ticket.parent_id && <button className="link small danger remove-parent"
                      onClick={() => { upd({ parent_id: null }); setParentPicker(false) }}>Remove parent</button>}
                  </div>
                )}
              </span>
            )}
          </div>
          <div className="row">
            <button className="ghost danger" onClick={async () => {
              if (confirm('Delete this ticket and its comments?')) { await actions.deleteTicket(ticket.id); onClose() }
            }}>Delete</button>
            <button className="ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>
        <div className="modal-body">
          <div className="main-col">
            <textarea className="title-input" rows={1} value={title} onChange={e => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== ticket.title && upd({ title: title.trim() })}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }} />

            <h4>Description</h4>
            {editDesc ? (
              <RichEditor html={ticket.description || ''}
                onSave={html => { upd({ description: html }); setEditDesc(false) }}
                onCancel={() => setEditDesc(false)} />
            ) : (
              <div className={'desc' + (ticket.description ? '' : ' empty')} title="Click to edit"
                onClick={e => { if (!e.target.closest('a') && !e.target.closest('input')) setEditDesc(true) }}>
                {ticket.description ? <RichView html={ticket.description} /> : 'Add a description…'}
              </div>
            )}

            {lowerTypes.length > 0 && <>
              <div className="section-head">
                <h4>Child items <span className="muted small">{children.length || ''}</span></h4>
                <div className="seg">
                  <button className={childMode === 'create' ? 'on' : ''} onClick={() => setChildMode('create')}>+ Create new</button>
                  <button className={childMode === 'existing' ? 'on' : ''} onClick={() => setChildMode('existing')}>⤷ Add existing</button>
                </div>
              </div>
              <div className="children">
                {children.map(c => (
                  <div key={c.id} className="child-row" onClick={() => onOpen(c.id)}>
                    <span style={{ color: typeOf(c).color }} title={typeOf(c).label}>{typeOf(c).icon}</span>
                    <span className="key">{ticketKey(c)}</span>
                    <span className="child-title">{c.title}</span>
                    <span className="pill status-pill">{statusName(c.status_id)}</span>
                    <button className="link small unlink" title="Remove from this parent"
                      onClick={e => { e.stopPropagation(); actions.updateTicket(c.id, { parent_id: null }) }}>✕</button>
                  </div>
                ))}
                {childMode === 'existing' ? (
                  <div className="child-add">
                    <TicketPicker candidates={childCandidates} autoFocus
                      placeholder={`Search ${lowerTypes.map(w => w.label).join(' / ')} by key or name to add it here…`}
                      note={t => t.parent_id && byId[t.parent_id] ? `under ${ticketKey(byId[t.parent_id])}` : ''}
                      onPick={c => actions.updateTicket(c.id, { parent_id: ticket.id })} />
                  </div>
                ) : (
                <form className="child-add" onSubmit={addChild}>
                  {lowerTypes.length > 1 && <select value={chosenChildType.value} onChange={e => setChildType(e.target.value)}>
                    {lowerTypes.map(w => <option key={w.value} value={w.value}>{w.icon} {w.label}</option>)}
                  </select>}
                  <input placeholder={`+ Add a ${chosenChildType.label.toLowerCase()}`} value={childTitle} onChange={e => setChildTitle(e.target.value)} />
                  {childTitle.trim() && <button className="primary" type="submit">Add</button>}
                </form>
                )}
              </div>
            </>}

            <div className="section-head">
              <h4>Checklists</h4>
              <select value="" onChange={e => { addList(e.target.value === 'blank' ? null : e.target.value); e.target.value = '' }}>
                <option value="">+ Add checklist</option>
                <option value="blank">Blank checklist</option>
                {templates.length > 0 && <optgroup label="From template">
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>}
              </select>
            </div>
            {lists.map(l => <Checklist key={l.id} list={l}
              onChange={fn => editList(l.id, fn)}
              onDelete={() => setLists(lists.filter(x => x.id !== l.id))}
              onSaveTemplate={() => actions.saveRow('checklist_templates', 'templates',
                { name: l.title, items: l.items.map(i => i.text) }).then(() => alert('Saved as template'))} />)}

            <h4>Comments</h4>
            <form onSubmit={addComment} className="comment-form">
              <textarea rows={2} placeholder="Add a comment…" value={newComment} onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addComment(e) }} />
              {newComment.trim() && <button className="primary" type="submit">Save</button>}
            </form>
            {comments === null ? <p className="muted">Loading…</p> : [...comments].reverse().map(c => (
              <div key={c.id} className="comment">
                <div className="comment-meta">
                  <b>{c.author || 'You'}</b>
                  <span className="muted small">{new Date(c.created_at).toLocaleString()}</span>
                  <button className="link small" onClick={() => delComment(c.id)}>Delete</button>
                </div>
                <div className="comment-body"><Linkify text={c.body} /></div>
              </div>
            ))}
          </div>

          <aside className="side-col">
            <label className="field">
              <span>Work type</span>
              <select value={wt.value} onChange={e => changeType(e.target.value)}>
                {WORK_TYPES.map(w => <option key={w.value} value={w.value}>{w.icon} {w.label}</option>)}
              </select>
            </label>
            {wt.level > 0 && <label className="field">
              <span>Parent</span>
              <select value={ticket.parent_id || ''} onChange={e => upd({ parent_id: e.target.value || null })}>
                <option value="">None</option>
                {WORK_TYPES.filter(w => w.level < wt.level).map(w => (
                  <optgroup key={w.value} label={w.label}>
                    {parentOptions.filter(t => typeOf(t).value === w.value).map(t => <option key={t.id} value={t.id}>{ticketKey(t)} · {t.title}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>}
            <label className="field">
              <span>Status</span>
              <select value={ticket.status_id || ''} onChange={e => upd({ status_id: e.target.value })}>
                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            {fields.length === 0 && <p className="muted small">Add custom fields (links, dates, dropdowns…) in Settings → Fields.</p>}
            {fields.map(f => (
              <div className="field" key={f.id}>
                <span>{f.name}</span>
                <FieldInput field={f} value={ticket.custom?.[f.id]} onChange={v => setCustom(f.id, v)}
                  onAddOption={o => addOption(f, o)} />
              </div>
            ))}
            <div className="meta muted small">
              <div>Created {new Date(ticket.created_at).toLocaleString()}</div>
              {ticket.updated_at && <div>Updated {new Date(ticket.updated_at).toLocaleString()}</div>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function Checklist({ list, onChange, onDelete, onSaveTemplate }) {
  const [txt, setTxt] = useState('')
  const done = list.items.filter(i => i.done).length
  const pct = list.items.length ? Math.round(done / list.items.length * 100) : 0
  const add = e => {
    e.preventDefault()
    if (!txt.trim()) return
    onChange(l => ({ ...l, items: [...l.items, { id: newId(), text: txt.trim(), done: false }] })); setTxt('')
  }
  return (
    <div className="checklist">
      <div className="checklist-head">
        <input className="bare strong" defaultValue={list.title} onBlur={e => e.target.value !== list.title && onChange(l => ({ ...l, title: e.target.value }))} />
        <span className="muted small">{done}/{list.items.length}</span>
        <button className="link small" onClick={onSaveTemplate} title="Save these items as a reusable template">Save as template</button>
        <button className="link small danger" onClick={() => confirm('Remove checklist?') && onDelete()}>Remove</button>
      </div>
      <div className="bar"><div style={{ width: pct + '%' }} /></div>
      {list.items.map(i => (
        <div key={i.id} className={'check-item' + (i.done ? ' done' : '')}>
          <input type="checkbox" checked={i.done} onChange={() => onChange(l => ({ ...l, items: l.items.map(x => x.id === i.id ? { ...x, done: !x.done } : x) }))} />
          <input className="bare" defaultValue={i.text} onBlur={e => e.target.value !== i.text && onChange(l => ({ ...l, items: l.items.map(x => x.id === i.id ? { ...x, text: e.target.value } : x) }))} />
          <button className="link small" onClick={() => onChange(l => ({ ...l, items: l.items.filter(x => x.id !== i.id) }))}>✕</button>
        </div>
      ))}
      <form onSubmit={add} className="row"><input placeholder="Add an item" value={txt} onChange={e => setTxt(e.target.value)} /></form>
    </div>
  )
}
