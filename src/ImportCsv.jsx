import { useState } from 'react'
import Papa from 'papaparse'
import { api, newId, FIELD_TYPES, COLORS } from './api.js'
import { suggest, convert, parseComment, parseDate, jiraToText } from './jira.js'
import { mapWorkType, WORK_TYPES, levelOf } from './format.js'
import { textToHtml } from './RichText.jsx'

export default function ImportCsv({ statuses, fields, tickets: existing = [], settings, actions, onDone }) {
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
        // empty columns are skipped; one-of-a-kind roles (title, status, key…) go to the first matching column only
        const SINGLE = ['title', 'description', 'status', 'created', 'key', 'worktype', 'jira_id', 'parent_key', 'parent_id']
        const seen = new Set()
        gs.forEach(g => {
          if (!g.filled) { g.map = { kind: 'ignore' }; return }
          if (SINGLE.includes(g.map.kind)) { if (seen.has(g.map.kind)) g.map = { kind: 'ignore' }; else seen.add(g.map.kind) }
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
  const keyGroup = groups.find(g => g.map.kind === 'key')
  const typeGroup = groups.find(g => g.map.kind === 'worktype')
  const existingKeys = new Set(existing.map(t => (t.key || '').toUpperCase()).filter(Boolean))
  const cellOf = (r, g) => g ? String(r[g.idx[0]] ?? '').trim() : ''
  const dupCount = rows && keyGroup ? rows.filter(r => existingKeys.has(cellOf(r, keyGroup).toUpperCase())).length : 0
  const typeCounts = rows && typeGroup ? WORK_TYPES.map(w => [w.label, rows.filter(r => mapWorkType(cellOf(r, typeGroup)) === w.value).length]).filter(x => x[1]) : null
  const nestCount = rows ? rows.filter(r => groups.some(g => (g.map.kind === 'parent_key' || g.map.kind === 'parent_id') && cellOf(r, g))).length : 0
  const checklistCount = groups.filter(g => g.map.kind === 'checklist').length
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

      // 2b. checklist columns: every distinct value becomes an item; a ticket's values = ticked
      const checklistItems = {}
      const templatesToCreate = []
      groups.forEach((g, i) => {
        if (g.map.kind !== 'checklist') return
        const items = []
        rows.forEach(r => g.idx.forEach(x => {
          const v = String(r[x] ?? '').trim()
          if (v && !items.includes(v)) items.push(v)
        }))
        checklistItems[i] = items
        templatesToCreate.push({ name: g.label, items })
      })
      const existingTpl = await api.list('checklist_templates')
      const newTpls = templatesToCreate.filter(t => !existingTpl.some(e => e.name.toLowerCase() === t.name.toLowerCase()))
      if (newTpls.length) await api.insert('checklist_templates', newTpls)

      // 3. tickets + comments
      setProgress('Creating tickets…')
      const pos = {}
      const tickets = [], comments = []
      const prefixCount = {}
      let skipped = 0
      rows.forEach(r => {
        const title = String(r[titleGroup.idx[0]] || '').trim()
        if (!title) return
        const key = cellOf(r, keyGroup).toUpperCase()
        if (key && existingKeys.has(key)) { skipped++; return }
        const id = newId()
        const sid = statusGroup ? statusId(r[statusGroup.idx[0]]) : allStatuses[0].id
        pos[sid] = (pos[sid] || 0) + 1
        const t = { id, title, status_id: sid, position: pos[sid], description: '', custom: {}, checklists: [], work_type: 'project', created_at: new Date().toISOString() }
        const km = key.match(/^([A-Z][A-Z0-9_]*)-(\d+)$/)
        if (km) { t.key = key; t.number = +km[2]; prefixCount[km[1]] = (prefixCount[km[1]] || 0) + 1 }
        else if (key) t.key = key
        groups.forEach((g, i) => {
          const cells = g.idx.map(x => r[x])
          if (g.map.kind === 'worktype') { if (String(cells[0] || '').trim()) t.work_type = mapWorkType(cells[0]) }
          else if (g.map.kind === 'jira_id') { if (cells[0]) t.jira_id = String(cells[0]).trim() }
          else if (g.map.kind === 'parent_key') { if (cells[0]) t._parentKey = String(cells[0]).trim().toUpperCase() }
          else if (g.map.kind === 'parent_id') { if (cells[0]) t._parentJira = String(cells[0]).trim() }
          else if (g.map.kind === 'description') t.description = textToHtml(cells.filter(Boolean).map(jiraToText).join('\n\n'))
          else if (g.map.kind === 'created') { const d = parseDate(cells[0]); if (d) t.created_at = d.toISOString() }
          else if (g.map.kind === 'checklist') {
            const ticked = new Set(cells.map(c => String(c ?? '').trim()).filter(Boolean))
            t.checklists.push({ id: newId(), title: g.label,
              items: checklistItems[i].map(text => ({ id: newId(), text, done: ticked.has(text) })) })
          }
          else if (g.map.kind === 'comments') cells.forEach(c => { const pc = parseComment(c); if (pc) comments.push({ ...pc, ticket_id: id }) })
          else if (fieldFor[i]) {
            const f = fieldFor[i]
            const v = convert(f.type, cells)
            if (v != null && !(Array.isArray(v) && !v.length)) t.custom[f.id] = v
          }
        })
        tickets.push(t)
      })
      // 3b. nesting: resolve parents by key / Jira id (from this file or tickets already on the board)
      const byKey = {}, byJira = {}
      ;[...existing, ...tickets].forEach(t => { if (t.key) byKey[t.key.toUpperCase()] = t; if (t.jira_id) byJira[t.jira_id] = t })
      let nested = 0, badNest = 0
      tickets.forEach(t => {
        const p = (t._parentKey && byKey[t._parentKey]) || (t._parentJira && byJira[t._parentJira])
        if (p && p.id !== t.id) {
          if (levelOf(p) < levelOf(t)) { t.parent_id = p.id; nested++ } else badNest++
        }
        delete t._parentKey; delete t._parentJira
      })
      // parents first, so they exist before their children are saved
      tickets.sort((a, b) => levelOf(a) - levelOf(b))
      // adopt the Jira prefix for new tickets if you haven't set your own
      const topPrefix = Object.entries(prefixCount).sort((a, b) => b[1] - a[1])[0]?.[0]
      if (topPrefix && (!settings || settings.key_prefix === 'PRJ')) await actions.saveSettings({ key_prefix: topPrefix })

      for (let i = 0; i < tickets.length; i += 200) {
        setProgress(`Creating tickets… ${Math.min(i + 200, tickets.length)}/${tickets.length}`)
        await api.insert('tickets', tickets.slice(i, i + 200))
      }
      for (let i = 0; i < comments.length; i += 200) {
        setProgress(`Adding comments… ${Math.min(i + 200, comments.length)}/${comments.length}`)
        await api.insert('comments', comments.slice(i, i + 200))
      }
      setProgress('')
      alert(`Imported ${tickets.length} tickets (${nested} nested under a parent), ${comments.length} comments, ${toCreate.length} new fields, ${newStatusNames.length} new statuses.` +
        (skipped ? `\nSkipped ${skipped} already on your board.` : '') +
        (badNest ? `\n${badNest} couldn't be nested because the parent is the same or a lower level.` : ''))
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
                        <option value="checklist">Checklist (ticked values = done)</option>
                        <option value="key">Issue key (e.g. POC-71)</option>
                        <option value="worktype">Work type</option>
                        <option value="jira_id">Jira issue id (for nesting)</option>
                        <option value="parent_key">Parent key (for nesting)</option>
                        <option value="parent_id">Parent id (for nesting)</option>
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
            Will create <b>{rows.filter(r => titleGroup && String(r[titleGroup.idx[0]] || '').trim() && !(keyGroup && existingKeys.has(cellOf(r, keyGroup).toUpperCase()))).length}</b> tickets,
            {' '}<b>{commentCount}</b> comments, <b>{newFieldCount}</b> new fields
            {checklistCount > 0 && <>, <b>{checklistCount}</b> checklist{checklistCount > 1 ? 's' : ''} per ticket (also saved as a template)</>}
            {newStatusNames.length > 0 && <>, and <b>{newStatusNames.length}</b> new statuses ({newStatusNames.join(', ')})</>}.
            {typeCounts && <div className="muted small">Work types: {typeCounts.map(([l, n]) => `${n} ${l}`).join(' · ')}{nestCount > 0 && ` · ${nestCount} will be nested under a parent`}</div>}
            {dupCount > 0 && <div className="note small">{dupCount} rows have an issue key that's already on your board — they'll be skipped.</div>}
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
