import { useState } from 'react'
import Papa from 'papaparse'
import { api, newId, FIELD_TYPES, COLORS } from './api.js'
import { suggest, convert, parseComment, parseDate } from './jira.js'

export default function ImportCsv({ statuses, fields, actions, onDone }) {
  const [rows, setRows] = useState(null)        // data rows (arrays)
  const [groups, setGroups] = useState([])      // [{name, idx:[], map:{kind,...}}]
  const [fileName, setFileName] = useState('')
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')
  const [showEmpty, setShowEmpty] = useState(false)

  function onFile(file) {
    setErr(''); setFileName(file.name)
    Papa.parse(file, {
      skipEmptyLines: 'greedy',
      complete: res => {
        const [head, ...data] = res.data
        if (!head || !data.length) { setErr('That CSV looks empty.'); return }
        const header = head.map((h, i) => String(h || `Column ${i + 1}`).replace(/^﻿/, '').trim())
        const byName = new Map()
        header.forEach((h, i) => { if (!byName.has(h)) byName.set(h, []); byName.get(h).push(i) })
        const gs = [...byName].map(([name, idx]) => {
          const values = data.flatMap(r => idx.map(i => String(r[i] ?? '').trim()))
          const filled = values.filter(Boolean)
          const label = name.replace(/^Custom field \((.*)\)$/i, '$1').trim()
          return { name, label, idx, filled: filled.length, sample: filled.slice(0, 3), map: suggest(label, values, idx.length > 1, fields) }
        })
        if (!gs.some(g => g.map.kind === 'title')) {
          const g = gs.find(g => g.filled) ; if (g) g.map = { kind: 'title' }
        }
        setRows(data); setGroups(gs)
      },
      error: e => setErr(e.message),
    })
  }

  const setMap = (i, map) => setGroups(gs => gs.map((g, j) => j === i ? { ...g, map: { ...g.map, ...map } } : g))
  const mapValue = m => m.kind === 'field' ? 'field:' + m.fieldId : m.kind
  const fromValue = v => v.startsWith('field:') ? { kind: 'field', fieldId: v.slice(6) } : v === 'new' ? { kind: 'new', type: 'text' } : { kind: v }

  const titleGroup = groups.find(g => g.map.kind === 'title')
  const statusGroup = groups.find(g => g.map.kind === 'status')
  const newStatusNames = statusGroup ? [...new Set(rows.map(r => String(r[statusGroup.idx[0]] || '').trim()).filter(Boolean))]
    .filter(n => !statuses.some(s => s.name.toLowerCase() === n.toLowerCase())) : []
  const newFieldCount = groups.filter(g => g.map.kind === 'new').length
  const commentCount = rows ? groups.filter(g => g.map.kind === 'comments').reduce((n, g) => n + g.filled, 0) : 0

  async function runImport() {
    if (!titleGroup) { setErr('Pick which column is the ticket Title.'); return }
    setErr('')
    try {
      // 1. statuses
      setProgress('Creating statuses…')
      let allStatuses = [...statuses]
      if (newStatusNames.length) {
        const created = await api.insert('statuses', newStatusNames.map((name, i) => ({
          name, color: COLORS[(statuses.length + i) % COLORS.length], position: statuses.length + i,
        })))
        allStatuses = allStatuses.concat(created)
      }
      const statusId = name => (allStatuses.find(s => s.name.toLowerCase() === String(name || '').trim().toLowerCase()) || allStatuses[0]).id

      // 2. fields
      setProgress('Creating fields…')
      const fieldFor = {} // group index -> field
      const toCreate = []
      groups.forEach((g, i) => {
        if (g.map.kind === 'field') fieldFor[i] = fields.find(f => f.id === g.map.fieldId)
        if (g.map.kind === 'new') toCreate.push([i, g])
      })
      if (toCreate.length) {
        const created = await api.insert('fields', toCreate.map(([, g], k) => {
          const type = g.map.type
          let options = []
          if (type === 'select' || type === 'multiselect')
            options = [...new Set(rows.flatMap(r => convert(type === 'select' ? 'text' : 'multiselect', g.idx.map(i => r[i])) || []).flat())].filter(Boolean).slice(0, 200)
          return { name: g.map.name || g.label, type, options, position: fields.length + k }
        }))
        toCreate.forEach(([i], k) => { fieldFor[i] = created[k] })
      }
      // extend options of existing select fields with new values
      for (const [i, f] of Object.entries(fieldFor)) {
        if (!f || !(f.type === 'select' || f.type === 'multiselect') || toCreate.some(([j]) => j === +i)) continue
        const g = groups[i]
        const vals = rows.flatMap(r => [convert(f.type === 'select' ? 'text' : 'multiselect', g.idx.map(x => r[x]))].flat()).filter(Boolean)
        const opts = [...new Set([...f.options, ...vals])]
        if (opts.length !== f.options.length) await api.update('fields', f.id, { options: opts })
      }

      // 3. tickets + comments
      setProgress('Creating tickets…')
      const pos = {}
      const tickets = [], comments = []
      rows.forEach(r => {
        const title = String(r[titleGroup.idx[0]] || '').trim()
        if (!title) return
        const id = newId()
        const sid = statusGroup ? statusId(r[statusGroup.idx[0]]) : allStatuses[0].id
        pos[sid] = (pos[sid] || 0) + 1
        const t = { id, title, status_id: sid, position: pos[sid], description: '', custom: {}, checklists: [] }
        groups.forEach((g, i) => {
          const cells = g.idx.map(x => r[x])
          if (g.map.kind === 'description') t.description = cells.filter(Boolean).join('\n\n')
          else if (g.map.kind === 'created') { const d = parseDate(cells[0]); if (d) t.created_at = d.toISOString() }
          else if (g.map.kind === 'comments') cells.forEach(c => { const pc = parseComment(c); if (pc) comments.push({ ...pc, ticket_id: id }) })
          else if (fieldFor[i]) {
            const f = fieldFor[i]
            const v = convert(f.type, cells)
            if (v != null && !(Array.isArray(v) && !v.length)) t.custom[f.id] = v
          }
        })
        tickets.push(t)
      })
      for (let i = 0; i < tickets.length; i += 200) {
        setProgress(`Creating tickets… ${Math.min(i + 200, tickets.length)}/${tickets.length}`)
        await api.insert('tickets', tickets.slice(i, i + 200))
      }
      for (let i = 0; i < comments.length; i += 200) {
        setProgress(`Adding comments… ${Math.min(i + 200, comments.length)}/${comments.length}`)
        await api.insert('comments', comments.slice(i, i + 200))
      }
      setProgress('')
      alert(`Imported ${tickets.length} tickets, ${comments.length} comments, ${toCreate.length} new fields, ${newStatusNames.length} new statuses.`)
      onDone()
    } catch (e) {
      setProgress(''); setErr('Import failed: ' + (e.message || e))
    }
  }

  return (
    <main className="settings">
      <section className="card wide">
        <h3>Import from CSV</h3>
        <p className="muted">
          In Jira: open your board → <b>Filters / Search issues</b> → show all issues → <b>Export → Export CSV (all fields)</b>.
          Then choose that file here. Repeated columns (like several <i>Comment</i> or <i>Labels</i> columns) are combined automatically.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
        {err && <p className="note error">{err}</p>}
      </section>

      {rows && (
        <section className="card wide">
          <div className="section-head">
            <h3>Map columns <span className="muted small">— {fileName}: {rows.length} rows, {groups.length} columns</span></h3>
            <label className="inline small"><input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} /> Show empty columns</label>
          </div>
          <table className="map-table">
            <thead><tr><th>CSV column</th><th>Sample values</th><th>Import as</th></tr></thead>
            <tbody>
              {groups.map((g, i) => (!showEmpty && !g.filled && g.map.kind === 'ignore') ? null : (
                <tr key={g.name} className={g.map.kind === 'ignore' ? 'ignored' : ''}>
                  <td><b>{g.name}</b>{g.idx.length > 1 && <span className="muted small"> ×{g.idx.length}</span>}
                    <div className="muted small">{g.filled} values</div></td>
                  <td className="sample">{g.sample.map((s, k) => <div key={k}>{s.length > 80 ? s.slice(0, 80) + '…' : s}</div>)}</td>
                  <td>
                    <div className="row">
                      <select value={mapValue(g.map)} onChange={e => setMap(i, fromValue(e.target.value))}>
                        <option value="ignore">— Skip —</option>
                        <option value="title">Title</option>
                        <option value="description">Description</option>
                        <option value="status">Status</option>
                        <option value="comments">Comments</option>
                        <option value="created">Created date</option>
                        <option value="new">New field…</option>
                        {fields.length > 0 && <optgroup label="Existing field">
                          {fields.map(f => <option key={f.id} value={'field:' + f.id}>{f.name}</option>)}
                        </optgroup>}
                      </select>
                      {g.map.kind === 'new' && <>
                        <input className="narrow" value={g.map.name ?? g.label} onChange={e => setMap(i, { name: e.target.value })} />
                        <select value={g.map.type} onChange={e => setMap(i, { type: e.target.value })}>
                          {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="summary">
            Will create <b>{rows.filter(r => titleGroup && String(r[titleGroup.idx[0]] || '').trim()).length}</b> tickets,
            {' '}<b>{commentCount}</b> comments, <b>{newFieldCount}</b> new fields
            {newStatusNames.length > 0 && <>, and <b>{newStatusNames.length}</b> new statuses ({newStatusNames.join(', ')})</>}.
          </div>
          <div className="row">
            <button className="primary" disabled={!!progress} onClick={runImport}>{progress || 'Import'}</button>
            <button className="ghost" onClick={() => { setRows(null); setGroups([]) }}>Cancel</button>
          </div>
        </section>
      )}
    </main>
  )
}
