// Data layer. Uses Supabase when env vars are set; otherwise a local
// "demo mode" that stores everything in this browser (for trying it out).
import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const DEMO = !URL || !KEY
export const supabase = DEMO ? null : createClient(URL, KEY)

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))
export const newId = uid

/* ---------------- local demo backend ---------------- */
const LS = 'portfolio-board-demo-v1'
function loadDb() {
  try { return JSON.parse(localStorage.getItem(LS)) || {} } catch { return {} }
}
function saveDb(db) { try { localStorage.setItem(LS, JSON.stringify(db)) } catch {} }
const DEFAULTS = {
  statuses: { color: '#6b778c', position: 0 },
  fields: { options: [], show_on_card: false, position: 0 },
  tickets: { description: '', position: 0, custom: {}, checklists: [], work_type: 'project', parent_id: null },
  settings: { key_prefix: 'PRJ' },
  ticket_links: { link_type: 'relates' },
  comments: {},
  checklist_templates: { items: [], auto_apply: false },
}
const local = {
  async list(table) { return (loadDb()[table] || []).slice() },
  async listBy(table, col, val) { return (loadDb()[table] || []).filter(r => r[col] === val) },
  async insert(table, rows) {
    const db = loadDb(); db[table] = db[table] || []
    const now = new Date().toISOString()
    const out = rows.map(r => {
      const row = { ...DEFAULTS[table], id: uid(), created_at: now, ...r }
      if (table === 'tickets') {
        row.updated_at = now
        if (row.number == null) row.number = Math.max(0, ...db.tickets.map(t => t.number || 0)) + 1
        if (!row.key) row.key = ((db.settings || [])[0]?.key_prefix || 'PRJ') + '-' + row.number
      }
      db[table].push(row); return row
    })
    saveDb(db); return out
  },
  async update(table, id, patch) {
    const db = loadDb()
    const row = (db[table] || []).find(r => r.id === id)
    if (!row) return null
    Object.assign(row, patch, table === 'tickets' ? { updated_at: new Date().toISOString() } : {})
    saveDb(db); return row
  },
  async remove(table, id) {
    const db = loadDb()
    db[table] = (db[table] || []).filter(r => r.id !== id)
    if (table === 'tickets') {
      db.comments = (db.comments || []).filter(c => c.ticket_id !== id)
      db.tickets.forEach(t => { if (t.parent_id === id) t.parent_id = null })
      db.ticket_links = (db.ticket_links || []).filter(l => l.from_id !== id && l.to_id !== id)
    }
    if (table === 'statuses') (db.tickets || []).forEach(t => { if (t.status_id === id) t.status_id = null })
    saveDb(db)
  },
}

/* ---------------- supabase backend ---------------- */
const remote = {
  async list(table) {
    // page through results (Supabase returns max 1000 rows per request)
    let all = [], from = 0
    for (;;) {
      const { data, error } = await supabase.from(table).select('*').range(from, from + 999)
      if (error) throw error
      all = all.concat(data)
      if (data.length < 1000) return all
      from += 1000
    }
  },
  async listBy(table, col, val) {
    const { data, error } = await supabase.from(table).select('*').eq(col, val)
    if (error) throw error
    return data
  },
  async insert(table, rows) {
    let out = []
    for (let i = 0; i < rows.length; i += 200) {
      const { data, error } = await supabase.from(table).insert(rows.slice(i, i + 200), { defaultToNull: false }).select()
      if (error) throw error
      out = out.concat(data)
    }
    return out
  },
  async update(table, id, patch) {
    const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single()
    if (error) throw error
    return data
  },
  async remove(table, id) {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
  },
}

const backend = DEMO ? local : remote
export const api = {
  list: t => backend.list(t),
  listBy: (t, col, val) => backend.listBy(t, col, val),
  insert: (t, rows) => backend.insert(t, Array.isArray(rows) ? rows : [rows]),
  insertOne: async (t, row) => (await backend.insert(t, [row]))[0],
  update: (t, id, patch) => backend.update(t, id, patch),
  remove: (t, id) => backend.remove(t, id),
}

export const FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'link', label: 'Link (URL)' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multiselect', label: 'Multi-select / labels' },
  { value: 'checkbox', label: 'Checkbox' },
]

// nClouds palette first, then supporting tones
export const COLORS = ['#6f93ad', '#2d5a7b', '#e8922e', '#8ec5d6', '#183449', '#3a9d8f', '#c0392b', '#b5651d']
