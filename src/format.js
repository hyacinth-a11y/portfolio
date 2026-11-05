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
export const ticketKey = t => `PRJ-${t.number ?? '?'}`
export function checklistProgress(t) {
  const items = (t.checklists || []).flatMap(c => c.items)
  return items.length ? { done: items.filter(i => i.done).length, total: items.length } : null
}
export function matches(t, q, fields) {
  if (!q) return true
  q = q.toLowerCase()
  const hay = [t.title, t.description, ticketKey(t),
    ...fields.map(f => displayValue(f, t.custom?.[f.id]))].join(' ').toLowerCase()
  return hay.includes(q)
}
