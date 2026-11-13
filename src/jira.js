// Helpers for reading Jira CSV exports.
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

// Parses Jira dates like "06/Nov/26 10:00 AM", "2026-11-06 10:00", "11/06/2026"
export function parseDate(s) {
  if (!s) return null
  s = String(s).trim()
  let m = s.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i)
  if (m) {
    let [, d, mon, y, h = '0', mi = '0', , ap] = m
    y = +y < 100 ? 2000 + +y : +y
    h = +h; if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0 }
    const mo = MONTHS[mon.toLowerCase()]
    if (mo == null) return null
    return new Date(y, mo, +d, h, +mi)
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return new Date(+m[3], +m[1] - 1, +m[2])
  const d = new Date(s)
  return isNaN(d) ? null : d
}
export const toDateOnly = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null

// Jira comment cells look like "06/Nov/26 10:00 AM;557058:abcd-1234;The comment text"
export function parseComment(cell) {
  const s = String(cell || '').trim()
  if (!s) return null
  const parts = s.split(';')
  if (parts.length >= 3) {
    const d = parseDate(parts[0])
    if (d) {
      const who = parts[1].trim()
      const readable = who && !/^[0-9a-f]{6,}|:|^\d+$/i.test(who) && who.length < 60
      return { created_at: d.toISOString(), author: readable ? who : 'Imported from Jira', body: jiraToText(parts.slice(2).join(';').trim()) }
    }
  }
  return { body: jiraToText(s), author: 'Imported from Jira' }
}

const isUrl = v => /^https?:\/\/\S+$/i.test(v)
const isDate = v => /^\d{1,2}\/[A-Za-z]{3}\/\d{2,4}/.test(v) || /^\d{4}-\d{2}-\d{2}/.test(v)
const isNum = v => /^-?\d+(\.\d+)?$/.test(v)

// Suggest a mapping for a column group based on its header and sample values.
export function suggest(name, values, multiCol, existingFields) {
  const n = name.toLowerCase().trim()
  const filled = values.filter(v => v !== '')
  if (n === 'summary' || n === 'title' || n === 'name') return { kind: 'title' }
  if (n === 'description') return { kind: 'description' }
  if (n === 'status') return { kind: 'status' }
  if (n === 'comment' || n === 'comments' || n === 'comment body') return { kind: 'comments' }
  if (n === 'created') return { kind: 'created' }
  if (n === 'issue key' || n === 'key') return { kind: 'key' }
  if (n === 'issue id') return { kind: 'jira_id' }
  if (n === 'parent key') return { kind: 'parent_key' }
  if (n === 'parent' || n === 'parent id') return { kind: 'parent_id' }
  if (n === 'issue type' || n === 'work type') return { kind: 'worktype' }
  if (n === 'priority') return { kind: 'priority' }
  const lm = n.match(/^(outward|inward) issue link \((.+)\)$/)
  if (lm) return { kind: 'link', dir: lm[1] === 'outward' ? 'out' : 'in', linkName: lm[2] }
  const existing = existingFields.find(f => f.name.toLowerCase() === n)
  if (existing) return { kind: 'field', fieldId: existing.id }
  if (!filled.length) return { kind: 'ignore' }
  if (multiCol && /onboarding tracker|checklist|check ?list/.test(n)) return { kind: 'checklist' }
  if (['parent summary', 'rank', 'approvals', 'project key', 'project name', 'project lead', 'creator', 'reporter', 'resolution'].includes(n) || n.startsWith('[chart]')) return { kind: 'ignore' }
  // same value on every row (e.g. Priority = Medium everywhere) -> nothing to learn
  if (filled.length === values.length && values.length > 3 && new Set(filled).size === 1) return { kind: 'ignore' }
  const NOISE = ['issue id', 'parent id', 'watchers', 'watchers id', 'creator id', 'reporter id', 'assignee id', 'status category changed', 'last viewed', 'σ time spent', 'σ original estimate', 'σ remaining estimate', 'work ratio', 'votes', 'issue type', 'status category', 'project id', 'project type', 'project lead id', 'project url', 'project description', 'attachment', 'sprint']
  if (NOISE.includes(n) || n.endsWith(' id')) return { kind: 'ignore' }
  if (n === 'labels' || n === 'components' || n === 'component/s' || n === 'fix versions' || n === 'fix version/s') return { kind: 'new', type: 'multiselect' }
  if (multiCol) return { kind: 'new', type: 'multiselect' }
  if (filled.every(isUrl)) return { kind: 'new', type: 'link' }
  if (filled.every(isDate)) return { kind: 'new', type: 'date' }
  if (filled.every(isNum)) return { kind: 'new', type: 'number' }
  const uniq = new Set(filled)
  if (filled.length >= 4 && uniq.size <= Math.max(3, filled.length / 4) && uniq.size <= 15 && [...uniq].every(v => v.length < 40)) return { kind: 'new', type: 'select' }
  if (filled.some(v => v.length > 120 || v.includes('\n'))) return { kind: 'new', type: 'textarea' }
  return { kind: 'new', type: 'text' }
}

// Convert raw cell(s) into a stored value for a given field type.
export function convert(type, cells) {
  const vals = cells.map(c => String(c ?? '').trim()).filter(Boolean)
  if (!vals.length) return null
  switch (type) {
    case 'multiselect': {
      const out = vals.length > 1 ? vals : vals[0].split(/\s*,\s*/)
      return [...new Set(out.filter(Boolean))]
    }
    case 'checkbox': return /^(y|yes|true|1|x|✓|checked|done)$/i.test(vals[0])
    case 'number': { const n = parseFloat(vals[0].replace(/[, ]/g, '')); return isNaN(n) ? null : n }
    case 'date': { const d = parseDate(vals[0]); return d ? toDateOnly(d) : vals[0] }
    case 'textarea': return vals.join('\n\n')
    default: return vals.join(', ')
  }
}

// Turn Jira wiki markup into readable text.
// Links become [text](url), bold becomes **text** (both rendered by the ticket view).
export function jiraToText(s) {
  if (!s) return ''
  let t = String(s).replace(/\r\n?/g, '\n')
  t = t.replace(/\{(code|noformat|quote|panel)(:[^}]*)?\}/g, '')
  t = t.replace(/\{color(:[^}]*)?\}/g, '')
  t = t.replace(/\{\{([^}]*)\}\}/g, '$1')                                  // {{monospace}}
  t = t.replace(/!([^!\s|]+)(\|[^!]*)?!/g, '[image: $1]')                 // !image.png|thumbnail!
  t = t.replace(/\[([^\]|]+)\|(https?:\/\/[^\]|\s]+)(\|[^\]]*)?\]/g, (_, txt, url) =>
    txt.trim() === url ? url : `[${txt.trim()}](${url})`)               // [text|url]
  t = t.replace(/\[(https?:\/\/[^\]\s]+)\]/g, '$1')                       // [url]
  t = t.replace(/\[~accountid:[^\]]+\]/g, '@user')
  t = t.replace(/\\\\/g, '\n')
  t = t.split('\n').map(line => {
    let l = line
    l = l.replace(/^h[1-6]\.\s*(.*)$/, '**$1**')
    l = l.replace(/^-{4,}\s*$/, '────────')
    l = l.replace(/^\s*([*#-]+)\s+/, (_, m) => '    '.repeat(m.length - 1) + (m.endsWith('#') ? '• ' : '• '))
    l = l.replace(/(^|[\s(•])\*(?!\s)([^*\n]+?)\*(?=$|[\s.,:;)!?])/g, '$1**$2**')
    l = l.replace(/(^|[\s(•])_(?!\s)([^_\n]+?)_(?=$|[\s.,:;)!?])/g, '$1$2')
    l = l.replace(/(^|[\s(•])-(?!\s)([^-\n]+?)-(?=$|[\s.,:;)!?])/g, '$1$2')
    return l.replace(/\*\*\s*\*\*/g, '').replace(/\s+$/, '')
  }).join('\n')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}
