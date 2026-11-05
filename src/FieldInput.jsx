import { useEffect, useState } from 'react'

const isUrl = s => /^https?:\/\//i.test(s || '')

export default function FieldInput({ field, value, onChange, onAddOption }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => { setV(value ?? '') }, [value])
  const commit = val => { if (val !== (value ?? '')) onChange(val === '' ? null : val) }

  switch (field.type) {
    case 'checkbox':
      return <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
    case 'select':
      return (
        <select value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
          <option value="">None</option>
          {field.options.map(o => <option key={o} value={o}>{o}</option>)}
          {value && !field.options.includes(value) && <option value={value}>{value}</option>}
        </select>
      )
    case 'multiselect': return <MultiSelect field={field} value={value} onChange={onChange} onAddOption={onAddOption} />
    case 'textarea':
      return <textarea rows={3} value={v} onChange={e => setV(e.target.value)} onBlur={() => commit(v)} placeholder="None" />
    case 'link':
      return (
        <div className="link-field">
          <input type="url" value={v} placeholder="https://…" onChange={e => setV(e.target.value)} onBlur={() => commit(v.trim())} />
          {isUrl(value) && <a href={value} target="_blank" rel="noreferrer" title="Open link">↗</a>}
        </div>
      )
    case 'date':
      return <input type="date" value={v} onChange={e => { setV(e.target.value); commit(e.target.value) }} />
    case 'number':
      return <input type="number" value={v} onChange={e => setV(e.target.value)}
        onBlur={() => commit(v === '' ? '' : Number(v))} placeholder="None" />
    default:
      return <input value={v} onChange={e => setV(e.target.value)} onBlur={() => commit(v)} placeholder="None" />
  }
}

function MultiSelect({ field, value, onChange, onAddOption }) {
  const sel = Array.isArray(value) ? value : []
  const [txt, setTxt] = useState('')
  const toggle = o => onChange(sel.includes(o) ? sel.filter(x => x !== o) : [...sel, o])
  const all = [...new Set([...field.options, ...sel])]
  const add = e => {
    e.preventDefault()
    const o = txt.trim(); if (!o) return
    if (!field.options.includes(o)) onAddOption?.(o)
    if (!sel.includes(o)) onChange([...sel, o])
    setTxt('')
  }
  return (
    <div className="multi">
      {all.map(o => (
        <button type="button" key={o} className={'chip' + (sel.includes(o) ? ' on' : '')} onClick={() => toggle(o)}>{o}</button>
      ))}
      <input className="chip-input" value={txt} placeholder="+ add" onChange={e => setTxt(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add(e) }} onBlur={add} />
    </div>
  )
}
