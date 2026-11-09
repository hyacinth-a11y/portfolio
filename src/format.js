export function displayValue(field, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''
  switch (field.type) {
    case 'checkbox': return v ? '✓ ' + field.name : ''
    case 'multiselect': return Array.isArray(v) ? v.join(', ') : String(v)
    case 'date': {
      const d = new Date(v + (String(v).length === 10 ? 'T00:00:00' : ''))
      return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
    default: return String(v)
  }
}
export const ticketKey = t => t.key || `PRJ-${t.number ?? '?'}`

// Hierarchy: Workstream > Project Name > Sub-task (levels can be skipped)
export const WORK_TYPES = [
  { value: 'workstream', label: 'Workstream', level: 0, icon: '◆', color: '#e8922e' },
  { value: 'project', label: 'Project Name', level: 1, icon: '■', color: '#2d5a7b' },
  { value: 'subtask', label: 'Sub-task', level: 2, icon: '▸', color: '#6f93ad' },
]
export const typeOf = t => WORK_TYPES.find(w => w.value === t?.work_type) || WORK_TYPES[1]
export const levelOf = t => typeOf(t).level
// map a Jira "Issue Type" value to a work type
export function mapWorkType(v) {
  const s = String(v || '').toLowerCase().trim()
  if (/workstream|epic/.test(s)) return 'workstream'
  if (/sub-?task/.test(s)) return 'subtask'
  return 'project'
}
// all descendants of a ticket (to stop loops when picking a parent)
export function descendants(id, tickets) {
  const out = new Set(), stack = [id]
  while (stack.length) {
    const cur = stack.pop()
    for (const t of tickets) if (t.parent_id === cur && !out.has(t.id)) { out.add(t.id); stack.push(t.id) }
  }
  return out
}
export function checklistProgress(t) {
  const items = (t.checklists || []).flatMap(c => c.items)
  return items.length ? { done: items.filter(i => i.done).length, total: items.length } : null
}
export function matches(t, q, fields) {
  if (!q) return true
  q = q.toLowerCase()
  const hay = [t.title, String(t.description || '').replace(/<[^>]+>/g, ' '), ticketKey(t),
    ...fields.map(f => displayValue(f, t.custom?.[f.id]))].join(' ').toLowerCase()
  return hay.includes(q)
}

// Jira-style link types. A link is stored once (from -> to); each side reads it differently.
export const LINK_TYPES = [
  { value: 'relates', out: 'relates to', in: 'relates to' },
  { value: 'blocks', out: 'blocks', in: 'is blocked by' },
  { value: 'duplicates', out: 'duplicates', in: 'is duplicated by' },
  { value: 'clones', out: 'clones', in: 'is cloned by' },
]
// options for the "link" dropdown: each direction as its own choice
export const LINK_CHOICES = LINK_TYPES.flatMap(t => t.out === t.in
  ? [{ id: t.value + ':out', label: t.out, type: t.value, dir: 'out' }]
  : [{ id: t.value + ':out', label: t.out, type: t.value, dir: 'out' }, { id: t.value + ':in', label: t.in, type: t.value, dir: 'in' }])
export function mapLinkType(name) {
  const s = String(name || '').toLowerCase()
  if (s.includes('block')) return 'blocks'
  if (s.includes('dupl')) return 'duplicates'
  if (s.includes('clon')) return 'clones'
  return 'relates'
}
