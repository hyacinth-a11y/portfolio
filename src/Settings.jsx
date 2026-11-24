import { useState } from 'react'
import Papa from 'papaparse'
import { api, FIELD_TYPES, COLORS } from './api.js'
import { displayValue, ticketKey, typeOf, WORK_TYPES, priorityOf, cleanPrefix } from './format.js'
import { htmlToText, RichEditor, RichView } from './RichText.jsx'
import { parseDate, toDateOnly } from './jira.js'

export default function Settings({ boards = [], currentBoard, allTickets = [], settings, statuses, fields, templates, descTemplates = [], tickets, actions }) {
  const [tab, setTab] = useState('boards')
  return (
    <main className="settings">
      <div className="subtabs">
        {[['boards', 'Boards'], ['statuses', 'Statuses', 'this board'], ['fields', 'Fields', 'all boards'], ['templates', 'Checklist templates', 'all boards'], ['desc', 'Description templates', 'all boards'], ['data', 'Export', 'this board']].map(([k, l, scope]) => (
          <button key={k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>{l}{scope && <span className="scope">· {scope}</span>}</button>
        ))}
      </div>
      {tab === 'boards' && <Boards boards={boards} currentBoard={currentBoard} allTickets={allTickets} actions={actions} />}
      {tab === 'statuses' && <Statuses board={currentBoard} statuses={statuses} tickets={tickets} actions={actions} />}
      {tab === 'fields' && <Fields fields={fields} allTickets={allTickets} boards={boards} actions={actions} />}
      {tab === 'templates' && <Templates templates={templates} actions={actions} />}
      {tab === 'desc' && <DescTemplates templates={descTemplates} actions={actions} />}
      {tab === 'data' && <Export statuses={statuses} fields={fields} tickets={tickets} />}
    </main>
  )
}

function Boards({ boards, currentBoard, allTickets, actions }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const count = id => allTickets.filter(t => t.board_id === id).length
  const taken = (k, exceptId) => boards.some(b => b.id !== exceptId && b.key_prefix === k)
  async function changeKey(b, input) {
    const v = cleanPrefix(input.value)
    if (!v || v === b.key_prefix) { input.value = b.key_prefix; return }
    if (taken(v, b.id)) { alert(`Another board already uses ${v}.`); input.value = b.key_prefix; return }
    const n = count(b.id)
    if (!confirm(`Change the key of "${b.name}" from ${b.key_prefix} to ${v}?` + (n ? `\n\nAll ${n} tickets get new keys (e.g. ${b.key_prefix}-12 becomes ${v}-12). Old keys still work in search.` : ''))) { input.value = b.key_prefix; return }
    input.disabled = true
    await actions.changeBoardKey(b, v)
    input.disabled = false
  }
  return (
    <section className="card wide">
      <h3>Boards <span className="muted small">— each board has its own columns and its own ticket key</span></h3>
      <div className="board-rows">
        <div className="set-row head muted small"><span className="bc-name">Name</span><span className="bc-key">Key</span><span className="bc-n">Tickets</span><span className="bc-api">Shared with API</span><span /></div>
        {boards.map(b => (
          <div className="set-row" key={b.id}>
            <input className="bc-name" defaultValue={b.name} onBlur={e => e.target.value.trim() && e.target.value !== b.name && actions.saveRow('boards', 'boards', { id: b.id, name: e.target.value.trim() })} />
            <input className="bc-key mono" defaultValue={b.key_prefix} key={b.key_prefix} onBlur={e => changeKey(b, e.target)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }} />
            <span className="bc-n muted small">{count(b.id)}{b.id === currentBoard.id && ' · open now'}</span>
            <label className="bc-api inline small"><input type="checkbox" checked={!!b.api_enabled}
              onChange={e => actions.saveRow('boards', 'boards', { id: b.id, api_enabled: e.target.checked })} /> {b.api_enabled ? 'Yes' : 'No'}</label>
            <button className="ghost danger" onClick={() => {
              if (boards.length === 1) return alert('You need at least one board.')
              if (count(b.id)) return alert(`"${b.name}" still has ${count(b.id)} tickets. Move them to another board first (open a ticket → Board).`)
              if (confirm(`Delete board "${b.name}" and its columns?`)) actions.deleteRow('boards', 'boards', b.id)
            }}>Delete</button>
          </div>
        ))}
      </div>
      <form className="set-row add" onSubmit={async e => {
        e.preventDefault()
        const k = cleanPrefix(key), n = name.trim()
        if (!n || !k) return alert('Give the board a name and a key.')
        if (taken(k)) return alert(`Another board already uses ${k}.`)
        await actions.createBoard(n, k); setName(''); setKey('')
      }}>
        <input className="bc-name" placeholder="New board name (e.g. Internal Ops)" value={name}
          onChange={e => { setName(e.target.value); if (!key) {} }} />
        <input className="bc-key mono" placeholder="KEY" value={key} onChange={e => setKey(cleanPrefix(e.target.value))} />
        <button className="primary" type="submit">Add board</button>
      </form>
      <p className="muted small">The key is the prefix on ticket numbers (POC-12). Changing it re-keys every ticket on that board; the old keys are remembered and still found by search.
        “Shared with API” controls which boards your other apps (like Off Duty) can read through <code>/api/portfolio</code> — boards left unticked are never sent.</p>
    </section>
  )
}

async function swap(list, i, j, actions, table, key) {
  if (j < 0 || j >= list.length) return
  const a = list[i], b = list[j]
  await actions.saveRow(table, key, { id: a.id, position: j })
  await actions.saveRow(table, key, { id: b.id, position: i })
  // normalise any others
  for (let k = 0; k < list.length; k++) if (k !== i && k !== j && list[k].position !== k)
    await actions.saveRow(table, key, { id: list[k].id, position: k })
}

function Statuses({ board, statuses, tickets, actions }) {
  const [name, setName] = useState('')
  const del = async s => {
    const n = tickets.filter(t => t.status_id === s.id).length
    if (statuses.length <= 1) return alert('You need at least one status.')
    const target = statuses.find(x => x.id !== s.id)
    if (!confirm(n ? `Delete "${s.name}"? Its ${n} ticket(s) will move to "${target.name}".` : `Delete "${s.name}"?`)) return
    for (const t of tickets.filter(t => t.status_id === s.id)) await actions.updateTicket(t.id, { status_id: target.id })
    await actions.deleteRow('statuses', 'statuses', s.id)
  }
  return (
    <section className="card wide">
      <h3>Statuses · {board?.name} <span className="pill this-board">This board only</span> <span className="muted small">— this board's columns, left to right (switch boards at the top to edit another)</span></h3>
      {statuses.map((s, i) => (
        <div className="set-row" key={s.id}>
          <input type="color" value={s.color} onChange={e => actions.saveRow('statuses', 'statuses', { id: s.id, color: e.target.value })} />
          <input defaultValue={s.name} onBlur={e => e.target.value.trim() && e.target.value !== s.name && actions.saveRow('statuses', 'statuses', { id: s.id, name: e.target.value.trim() })} />
          <span className="muted small">{tickets.filter(t => t.status_id === s.id).length} tickets</span>
          <button className="ghost" onClick={() => swap(statuses, i, i - 1, actions, 'statuses', 'statuses')} disabled={i === 0}>↑</button>
          <button className="ghost" onClick={() => swap(statuses, i, i + 1, actions, 'statuses', 'statuses')} disabled={i === statuses.length - 1}>↓</button>
          <button className="ghost danger" onClick={() => del(s)}>Delete</button>
        </div>
      ))}
      <form className="set-row" onSubmit={e => {
        e.preventDefault(); if (!name.trim()) return
        actions.saveRow('statuses', 'statuses', { name: name.trim(), color: COLORS[statuses.length % COLORS.length], position: statuses.length, board_id: board.id }); setName('')
      }}>
        <input placeholder="New status name" value={name} onChange={e => setName(e.target.value)} />
        <button className="primary" type="submit">Add status</button>
      </form>
    </section>
  )
}

// Guess a field type from stored values
function guessType(values) {
  const v = values.filter(x => x != null && x !== '')
  if (v.some(Array.isArray)) return 'multiselect'
  if (v.every(x => typeof x === 'boolean')) return 'checkbox'
  if (v.every(x => typeof x === 'number')) return 'number'
  const str = v.map(String)
  if (str.every(x => /^https?:\/\//i.test(x))) return 'link'
  if (str.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x))) return 'date'
  if (str.some(x => x.length > 120 || x.includes('\n'))) return 'textarea'
  const uniq = new Set(str)
  if (str.length >= 4 && uniq.size <= 15 && uniq.size <= str.length / 3) return 'select'
  return 'text'
}

// Values of deleted fields are still saved inside the tickets. This finds them and lets you bring the fields back.
function RestoreFields({ fields, allTickets, boards, actions }) {
  const known = new Set(fields.map(f => f.id))
  const orphans = {}
  for (const t of allTickets) for (const [fid, val] of Object.entries(t.custom || {})) {
    if (known.has(fid) || val == null || val === '' || (Array.isArray(val) && !val.length)) continue
    ;(orphans[fid] = orphans[fid] || { id: fid, tickets: [] }).tickets.push({ t, val })
  }
  const list = Object.values(orphans)
  const [names, setNames] = useState({})
  const [types, setTypes] = useState({})
  const [busy, setBusy] = useState(false)
  const [csvNote, setCsvNote] = useState('')
  if (!list.length) return null
  const boardName = id => boards.find(b => b.id === id)?.name || '?'

  // optional: read names from the original Jira CSV by matching values
  function matchCsv(file) {
    Papa.parse(file, {
      skipEmptyLines: 'greedy', complete: res => {
        const [head, ...rows] = res.data
        const cols = head.map((h, i) => {
          const raw = rows.map(r => String(r[i] ?? '').trim()).filter(Boolean)
          const dates = raw.map(v => toDateOnly(parseDate(v))).filter(Boolean)   // Jira dates -> 2026-06-22
          return { name: String(h).replace(/^\ufeff/, '').replace(/^Custom field \((.*)\)$/i, '$1').trim(), vals: new Set([...raw, ...dates]) }
        })
        // score every (deleted field, column) pair, then hand out columns best-first so each is used once
        const pairs = []
        for (const o of list) {
          const vals = o.tickets.flatMap(x => [x.val].flat()).map(v => String(v).trim())
          cols.forEach((c, ci) => {
            const score = vals.filter(v => c.vals.has(v) || [...c.vals].some(cv => cv.split(/\s*,\s*/).includes(v))).length
            if (score >= Math.max(1, vals.length * 0.5)) pairs.push({ o, ci, score: score / vals.length, n: score })
          })
        }
        pairs.sort((a, b) => b.score - a.score || b.n - a.n)
        const guessed = {}, usedCols = new Set()
        for (const pr of pairs) {
          if (guessed[pr.o.id] || usedCols.has(pr.ci)) continue
          guessed[pr.o.id] = cols[pr.ci].name; usedCols.add(pr.ci)
        }
        setNames(n => ({ ...guessed, ...Object.fromEntries(Object.entries(n).filter(([, v]) => v)) }))
        setCsvNote(`Matched ${Object.keys(guessed).length} of ${list.length} fields to columns in ${file.name}.`)
      },
    })
  }
  async function restore(o) {
    const name = (names[o.id] || '').trim()
    if (!name) return alert('Type a name for this field first.')
    const type = types[o.id] || guessType(o.tickets.map(x => x.val))
    const options = type === 'select' || type === 'multiselect' ? [...new Set(o.tickets.flatMap(x => [x.val].flat()).map(String))] : []
    // same id as before, so every ticket's value shows up again
    await actions.insertRow('fields', 'fields', { id: o.id, name, type, options, position: fields.length })
  }
  async function restoreAll() {
    const ready = list.filter(o => (names[o.id] || '').trim())
    if (!ready.length) return alert('Type a name for at least one field (or match names from your Jira CSV).')
    setBusy(true); for (const o of ready) await restore(o); setBusy(false)
  }
  return (
    <section className="card wide restore">
      <h3>Restore deleted fields <span className="muted small">— {list.length} deleted field{list.length > 1 ? 's' : ''} still {list.length > 1 ? 'have' : 'has'} values saved in your tickets</span></h3>
      <p className="muted small">Deleting a field hides it, but the values stay in the tickets. Give each one its name back and click Restore — the values reappear on every ticket.
        Don't remember the names? Choose your original Jira CSV and they'll be filled in for you.</p>
      <div className="set-row"><label className="inline small">Fill names from a CSV:</label>
        <input type="file" accept=".csv,text/csv" onChange={e => e.target.files[0] && matchCsv(e.target.files[0])} />
        {csvNote && <span className="muted small">{csvNote}</span>}</div>
      {list.map(o => {
        const sample = [...new Set(o.tickets.map(x => [x.val].flat().join(', ')))].slice(0, 3)
        const bs = [...new Set(o.tickets.map(x => boardName(x.t.board_id)))]
        const type = types[o.id] || guessType(o.tickets.map(x => x.val))
        return (
          <div className="field-def" key={o.id}>
            <div className="set-row">
              <input placeholder="Field name (e.g. SOW)" value={names[o.id] || ''} onChange={e => setNames(n => ({ ...n, [o.id]: e.target.value }))} />
              <select value={type} onChange={e => setTypes(t => ({ ...t, [o.id]: e.target.value }))}>
                {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <button className="primary" onClick={() => restore(o)}>Restore</button>
            </div>
            <div className="muted small restore-meta">
              On {o.tickets.length} ticket{o.tickets.length > 1 ? 's' : ''} ({bs.join(', ')}) · e.g. {sample.map((x, i) => <code key={i}>{x.length > 60 ? x.slice(0, 60) + '…' : x}</code>)}
            </div>
          </div>
        )
      })}
      <button className="primary" disabled={busy} onClick={restoreAll}>{busy ? 'Restoring…' : 'Restore all named fields'}</button>
    </section>
  )
}

function Fields({ fields, allTickets = [], boards = [], actions }) {
  const [draft, setDraft] = useState({ name: '', type: 'text' })
  const save = row => actions.saveRow('fields', 'fields', row)
  const usedOn = f => allTickets.filter(t => { const v = t.custom?.[f.id]; return v != null && v !== '' && !(Array.isArray(v) && !v.length) })
  return (<>
    <RestoreFields fields={fields} allTickets={allTickets} boards={boards} actions={actions} />
    <section className="card wide">
      <h3>Custom fields <span className="pill all-boards">All boards</span> <span className="muted small">— these fields appear on every board. Title, Description, Status and Comments are built in</span></h3>
      {fields.length === 0 && <p className="muted">No custom fields yet.</p>}
      {fields.map((f, i) => (
        <div className="field-def" key={f.id}>
          <div className="set-row">
            <input defaultValue={f.name} onBlur={e => e.target.value.trim() && e.target.value !== f.name && save({ id: f.id, name: e.target.value.trim() })} />
            <select value={f.type} onChange={e => save({ id: f.id, type: e.target.value })}>
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="inline"><input type="checkbox" checked={f.show_on_card} onChange={e => save({ id: f.id, show_on_card: e.target.checked })} /> Show on card</label>
            <button className="ghost" onClick={() => swap(fields, i, i - 1, actions, 'fields', 'fields')} disabled={i === 0}>↑</button>
            <button className="ghost" onClick={() => swap(fields, i, i + 1, actions, 'fields', 'fields')} disabled={i === fields.length - 1}>↓</button>
            <button className="ghost danger" onClick={() => {
              const used = usedOn(f)
              const bs = [...new Set(used.map(t => boards.find(b => b.id === t.board_id)?.name).filter(Boolean))]
              confirm(`Delete field "${f.name}" from ALL boards?` +
                (used.length ? `\n\nIt has values on ${used.length} ticket(s) in: ${bs.join(', ')}. The values are kept and can be restored later from this page.` : '')) &&
                actions.deleteRow('fields', 'fields', f.id)
            }}>Delete</button>
          </div>
          {(f.type === 'select' || f.type === 'multiselect') && (
            <div className="options">
              <span className="muted small">Options (one per line):</span>
              <textarea rows={Math.max(2, f.options.length + 1)} defaultValue={f.options.join('\n')}
                onBlur={e => save({ id: f.id, options: [...new Set(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))] })} />
            </div>
          )}
        </div>
      ))}
      <form className="set-row add" onSubmit={e => {
        e.preventDefault(); if (!draft.name.trim()) return
        save({ name: draft.name.trim(), type: draft.type, options: [], position: fields.length }); setDraft({ name: '', type: 'text' })
      }}>
        <input placeholder="New field name (e.g. Client, Repo link, Go-live date)" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <select value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>
          {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button className="primary" type="submit">Add field</button>
      </form>
    </section>
  </>)
}

function DescTemplates({ templates, actions }) {
  const [editing, setEditing] = useState(null) // template id or 'new'
  const [name, setName] = useState('')
  const save = row => actions.saveRow('description_templates', 'descTemplates', row)
  return (
    <section className="card wide">
      <h3>Description templates <span className="pill all-boards">All boards</span> <span className="muted small">— insert them from “Template” when editing a description</span></h3>
      {templates.length === 0 && editing !== 'new' && <p className="muted">No description templates yet.</p>}
      {templates.map(t => (
        <div className="field-def" key={t.id}>
          <div className="set-row">
            <input className="strong" defaultValue={t.name} onBlur={e => e.target.value.trim() && e.target.value !== t.name && save({ id: t.id, name: e.target.value.trim() })} />
            <label className="inline small">Use for new
              <select value={t.work_type || ''} onChange={e => {
                const wt = e.target.value || null
                // only one default per work type
                if (wt) templates.filter(x => x.id !== t.id && x.work_type === wt).forEach(x => save({ id: x.id, work_type: null }))
                save({ id: t.id, work_type: wt })
              }}>
                <option value="">— not automatic —</option>
                {WORK_TYPES.map(w => <option key={w.value} value={w.value}>{w.label} tickets</option>)}
              </select>
            </label>
            {editing !== t.id && <button className="ghost" onClick={() => setEditing(t.id)}>Edit</button>}
            <button className="ghost danger" onClick={() => confirm(`Delete template "${t.name}"?`) && actions.deleteRow('description_templates', 'descTemplates', t.id)}>Delete</button>
          </div>
          <div className="options">
            {editing === t.id
              ? <RichEditor html={t.body} placeholder="Template content…" onSave={body => { save({ id: t.id, body }); setEditing(null) }} onCancel={() => setEditing(null)} />
              : <div className="tpl-preview">{t.body ? <RichView html={t.body} /> : <span className="muted">Empty</span>}</div>}
          </div>
        </div>
      ))}
      {editing === 'new' ? (
        <div className="field-def">
          <div className="set-row"><input autoFocus placeholder="Template name (e.g. Project kickoff brief)" value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="options">
            <RichEditor html="" placeholder="Write the template: headings, bullets, placeholders like “Budget: ___”…"
              onSave={body => { if (!name.trim()) return alert('Give the template a name first.'); save({ name: name.trim(), body }); setName(''); setEditing(null) }}
              onCancel={() => { setName(''); setEditing(null) }} />
          </div>
        </div>
      ) : <button className="primary" onClick={() => setEditing('new')}>+ New description template</button>}
    </section>
  )
}

function Templates({ templates, actions }) {
  const [draft, setDraft] = useState({ name: '', items: '' })
  const save = row => actions.saveRow('checklist_templates', 'templates', row)
  const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean)
  return (
    <section className="card wide">
      <h3>Checklist templates <span className="pill all-boards">All boards</span> <span className="muted small">— add them to any ticket from “+ Add checklist”</span></h3>
      {templates.map(t => (
        <div className="field-def" key={t.id}>
          <div className="set-row">
            <input className="strong" defaultValue={t.name} onBlur={e => e.target.value.trim() && save({ id: t.id, name: e.target.value.trim() })} />
            <label className="inline"><input type="checkbox" checked={t.auto_apply} onChange={e => save({ id: t.id, auto_apply: e.target.checked })} /> Auto-add to new tickets</label>
            <button className="ghost danger" onClick={() => confirm(`Delete template "${t.name}"?`) && actions.deleteRow('checklist_templates', 'templates', t.id)}>Delete</button>
          </div>
          <div className="options">
            <span className="muted small">Items (one per line):</span>
            <textarea rows={Math.max(3, t.items.length + 1)} defaultValue={t.items.join('\n')} onBlur={e => save({ id: t.id, items: lines(e.target.value) })} />
          </div>
        </div>
      ))}
      <form className="field-def" onSubmit={e => {
        e.preventDefault(); if (!draft.name.trim()) return
        save({ name: draft.name.trim(), items: lines(draft.items) }); setDraft({ name: '', items: '' })
      }}>
        <div className="set-row"><input placeholder="Template name (e.g. Client onboarding)" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
        <div className="options">
          <textarea rows={4} placeholder={'Kickoff call scheduled\nAWS account access granted\nArchitecture review done'} value={draft.items} onChange={e => setDraft({ ...draft, items: e.target.value })} />
        </div>
        <button className="primary" type="submit">Add template</button>
      </form>
    </section>
  )
}

function Export({ statuses, fields, tickets }) {
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const comments = await api.list('comments')
      const st = Object.fromEntries(statuses.map(s => [s.id, s.name]))
      const maxC = Math.max(0, ...tickets.map(t => comments.filter(c => c.ticket_id === t.id).length))
      const byId = Object.fromEntries(tickets.map(t => [t.id, t]))
      const header = ['Issue key', 'Work type', 'Priority', 'Parent key', 'Title', 'Description', 'Status', 'Created', ...fields.map(f => f.name), 'Checklists',
        ...Array.from({ length: maxC }, () => 'Comment')]
      const rows = [...tickets].sort((a, b) => (a.number || 0) - (b.number || 0)).map(t => {
        const cs = comments.filter(c => c.ticket_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
        return [ticketKey(t), typeOf(t).label, priorityOf(t).label, byId[t.parent_id] ? ticketKey(byId[t.parent_id]) : '', t.title, htmlToText(t.description), st[t.status_id] || '', t.created_at,
          ...fields.map(f => f.type === 'multiselect' ? (t.custom?.[f.id] || []).join(', ') : f.type === 'checkbox' ? String(!!t.custom?.[f.id]) : (t.custom?.[f.id] ?? '')),
          (t.checklists || []).map(l => l.title + ': ' + l.items.map(i => (i.done ? '[x] ' : '[ ] ') + i.text).join('; ')).join(' | '),
          ...Array.from({ length: maxC }, (_, i) => cs[i] ? `${cs[i].created_at};${cs[i].author || ''};${htmlToText(cs[i].body)}` : '')]
      })
      const blob = new Blob([Papa.unparse([header, ...rows])], { type: 'text/csv' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
      a.download = `portfolio-export-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    } finally { setBusy(false) }
  }
  return (
    <section className="card wide">
      <h3>Export</h3>
      <p className="muted">Download every ticket (fields, checklists and comments) as a CSV — handy as a backup.</p>
      <button className="primary" onClick={run} disabled={busy}>{busy ? 'Preparing…' : 'Download CSV'}</button>
    </section>
  )
}
