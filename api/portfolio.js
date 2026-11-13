// Read-only API for other apps: GET /api/portfolio
// Auth: header "Authorization: Bearer <PORTFOLIO_API_TOKEN>" (or "x-api-key: <token>", or ?token=<token>)
// Optional filters: ?key=POC-71  ?status=In Progress  ?work_type=project|workstream|subtask
//                   ?updated_since=2026-11-01  ?include=tickets,board (default both)
//
// Vercel environment variables needed (NOT prefixed with VITE_, so they stay on the server):
//   SUPABASE_SERVICE_ROLE_KEY  - Supabase > Project Settings > API Keys > service_role / secret key
//   PORTFOLIO_API_TOKEN        - any long random string you make up; give it to the other app
//   (the existing VITE_SUPABASE_URL is reused for the project address)

const WORK_TYPES = { workstream: 'Workstream', project: 'Project Name', subtask: 'Sub-task' }

function htmlToText(html) {
  if (!html) return ''
  if (!/^\s*</.test(html)) return html
  return html
    .replace(/<li[^>]*>/g, '\n• ').replace(/<\/(p|h[1-6]|blockquote|pre)>/g, '\n').replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim()
}

async function fetchAll(base, key, table, query = '') {
  const out = []
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${base}/rest/v1/${table}?select=*${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`)
    const rows = await r.json()
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Read-only API: use GET' })

  const TOKEN = process.env.PORTFOLIO_API_TOKEN
  const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '')
  const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!TOKEN || !SB_URL || !SB_KEY) return res.status(500).json({ error: 'API not configured: set PORTFOLIO_API_TOKEN and SUPABASE_SERVICE_ROLE_KEY in Vercel' })

  const q = req.query || {}
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-api-key'] || q.token
  if (given !== TOKEN) return res.status(401).json({ error: 'Missing or wrong API token' })

  try {
    const include = String(q.include || 'tickets,board').split(',')
    const [statuses, fields, templates, settings] = await Promise.all([
      fetchAll(SB_URL, SB_KEY, 'statuses', '&order=position'),
      fetchAll(SB_URL, SB_KEY, 'fields', '&order=position'),
      include.includes('board') ? fetchAll(SB_URL, SB_KEY, 'checklist_templates') : [],
      fetchAll(SB_URL, SB_KEY, 'settings').catch(() => []),
    ])
    const body = { generated_at: new Date().toISOString(), key_prefix: settings[0]?.key_prefix || 'PRJ' }

    if (include.includes('board')) {
      body.board = {
        statuses: statuses.map(s => ({ id: s.id, name: s.name, color: s.color, position: s.position })),
        work_types: Object.entries(WORK_TYPES).map(([value, label], level) => ({ value, label, level })),
        fields: fields.map(f => ({ id: f.id, name: f.name, type: f.type, options: f.options, show_on_card: f.show_on_card })),
        checklist_templates: templates.map(t => ({ id: t.id, name: t.name, items: t.items, auto_apply: t.auto_apply })),
      }
    }

    if (include.includes('tickets')) {
      let tickets = await fetchAll(SB_URL, SB_KEY, 'tickets', '&order=number')
      const statusName = Object.fromEntries(statuses.map(s => [s.id, s.name]))
      const byId = Object.fromEntries(tickets.map(t => [t.id, t]))
      if (q.key) tickets = tickets.filter(t => (t.key || '').toUpperCase() === String(q.key).toUpperCase())
      if (q.status) tickets = tickets.filter(t => (statusName[t.status_id] || '').toLowerCase() === String(q.status).toLowerCase())
      if (q.work_type) tickets = tickets.filter(t => (t.work_type || 'project') === q.work_type)
      if (q.priority) tickets = tickets.filter(t => (t.priority || 'low') === String(q.priority).toLowerCase())
      if (q.updated_since) tickets = tickets.filter(t => t.updated_at >= q.updated_since)
      body.tickets = tickets.map(t => {
        const parent = byId[t.parent_id]
        const custom = {}
        for (const f of fields) if (t.custom && t.custom[f.id] != null) custom[f.name] = t.custom[f.id]
        return {
          id: t.id,
          key: t.key || `${body.key_prefix}-${t.number}`,
          title: t.title,
          status: statusName[t.status_id] || null,
          work_type: t.work_type || 'project',
          work_type_label: WORK_TYPES[t.work_type || 'project'],
          priority: t.priority || 'low',
          parent_key: parent ? (parent.key || null) : null,
          parent_title: parent ? parent.title : null,
          description_text: htmlToText(t.description),
          description_html: t.description || '',
          fields: custom,
          checklists: (t.checklists || []).map(c => ({
            title: c.title, done: c.items.filter(i => i.done).length, total: c.items.length,
            items: c.items.map(i => ({ text: i.text, done: i.done })),
          })),
          created_at: t.created_at,
          updated_at: t.updated_at,
        }
      })
      body.count = body.tickets.length
    }
    return res.status(200).json(body)
  } catch (e) {
    return res.status(502).json({ error: 'Could not read from Supabase', detail: String(e.message || e) })
  }
}
