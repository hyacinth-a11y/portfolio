import { useState } from 'react'
import Papa from 'papaparse'
import { api, FIELD_TYPES, COLORS } from './api.js'
import { displayValue, ticketKey } from './format.js'

export default function Settings({ statuses, fields, templates, tickets, actions }) {
  const [tab, setTab] = useState('statuses')
  return (
    <main className="settings">
      <div className="subtabs">
        {[['statuses', 'Statuses'], ['fields', 'Fields'], ['templates', 'Checklist templates'], ['data', 'Export']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'tab on' : 'tab'} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'statuses' && <Statuses statuses={statuses} tickets={tickets} actions={actions} />}
      {tab === 'fields' && <Fields fields={fields} actions={actions} />}
      {tab === 'templates' && <Templates templates={templates} actions={actions} />}
      {tab === 'data' && <Export statuses={statuses} fields={fields} tickets={tickets} />}
    </main>
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

function Statuses({ statuses, tickets, actions }) {
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
      <h3>Statuses <span className="muted small">— these are your board columns, left to right</span></h3>
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
        actions.saveRow('statuses', 'statuses', { name: name.trim(), color: COLORS[statuses.length % COLORS.length], position: statuses.length }); setName('')
      }}>
        <input placeholder="New status name" value={name} onChange={e => setName(e.target.value)} />
        <button className="primary" type="submit">Add status</button>
      </form>
    </section>
  )
}

function Fields({ fields, actions }) {
  const [draft, setDraft] = useState({ name: '', type: 'text' })
  const save = row => actions.saveRow('fields', 'fields', row)
  return (
    <section className="card wide">
      <h3>Custom fields <span className="muted small">— Title, Description, Status and Comments are built in</span></h3>
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
            <button className="ghost danger" onClick={() => confirm(`Delete field "${f.name}"? Values stored in tickets will be hidden.`) && actions.deleteRow('fields', 'fields', f.id)}>Delete</button>
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
  )
}

function Templates({ templates, actions }) {
  const [draft, setDraft] = useState({ name: '', items: '' })
  const save = row => actions.saveRow('checklist_templates', 'templates', row)
  const lines = s => s.split('\n').map(x => x.trim()).filter(Boolean)
  return (
    <section className="card wide">
      <h3>Checklist templates <span className="muted small">— add them to any ticket from “+ Add checklist”</span></h3>
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
      const header = ['Key', 'Title', 'Description', 'Status', 'Created', ...fields.map(f => f.name), 'Checklists',
        ...Array.from({ length: maxC }, () => 'Comment')]
      const rows = [...tickets].sort((a, b) => a.number - b.number).map(t => {
        const cs = comments.filter(c => c.ticket_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
        return [ticketKey(t), t.title, t.description, st[t.status_id] || '', t.created_at,
          ...fields.map(f => f.type === 'multiselect' ? (t.custom?.[f.id] || []).join(', ') : f.type === 'checkbox' ? String(!!t.custom?.[f.id]) : (t.custom?.[f.id] ?? '')),
          (t.checklists || []).map(l => l.title + ': ' + l.items.map(i => (i.done ? '[x] ' : '[ ] ') + i.text).join('; ')).join(' | '),
          ...Array.from({ length: maxC }, (_, i) => cs[i] ? `${cs[i].created_at};${cs[i].author || ''};${cs[i].body}` : '')]
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
