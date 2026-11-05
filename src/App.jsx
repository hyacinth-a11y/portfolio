import { useEffect, useState, useCallback } from 'react'
import { api, supabase, DEMO, newId } from './api.js'
import Board from './Board.jsx'
import TicketModal from './TicketModal.jsx'
import Settings from './Settings.jsx'
import ImportCsv from './ImportCsv.jsx'

const DEFAULT_STATUSES = [
  { name: 'To Do', color: '#6f93ad' },
  { name: 'In Progress', color: '#e8922e' },
  { name: 'Done', color: '#3a9d8f' },
]

export default function App() {
  const [session, setSession] = useState(DEMO ? { demo: true } : undefined)
  useEffect(() => {
    if (DEMO) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="center muted">Loading…</div>
  if (!session) return <Login />
  return <Workspace session={session} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('in')
  const [msg, setMsg] = useState('')
  const submit = async e => {
    e.preventDefault(); setMsg('')
    const fn = mode === 'in' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { error } = await fn.call(supabase.auth, { email, password })
    if (error) setMsg(error.message)
    else if (mode === 'up') setMsg('Account created. If email confirmation is on, check your inbox, then sign in.')
  }
  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1><span className="brand-mark">◆</span>Project Portfolio</h1>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} /></label>
        <button className="primary" type="submit">{mode === 'in' ? 'Sign in' : 'Create account'}</button>
        {msg && <p className="note">{msg}</p>}
        <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'First time? Create your account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}

function Workspace({ session }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)
  const [view, setView] = useState('board') // board | settings | import

  const load = useCallback(async () => {
    try {
      let [statuses, fields, tickets, templates, settingsRows] = await Promise.all([
        api.list('statuses'), api.list('fields'), api.list('tickets'), api.list('checklist_templates'), api.list('settings'),
      ])
      if (statuses.length === 0) {
        statuses = await api.insert('statuses', DEFAULT_STATUSES.map((s, i) => ({ ...s, position: i })))
      }
      setData({ statuses, fields, tickets, templates, settings: settingsRows[0] || null })
    } catch (e) { setError(e.message || String(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const sortBy = (arr, k = 'position') => [...arr].sort((a, b) => (a[k] ?? 0) - (b[k] ?? 0))

  const actions = {
    reload: load,
    setError,
    async saveSettings(patch) {
      const cur = data.settings
      const row = cur ? await api.update('settings', cur.id, patch) : await api.insertOne('settings', patch)
      setData(d => ({ ...d, settings: { ...(cur || {}), ...row } }))
    },
    async createTicket(statusId, title, extra = {}) {
      const inStatus = data.tickets.filter(t => t.status_id === statusId)
      const autoLists = data.templates.filter(t => t.auto_apply).map(t => ({
        id: newId(), title: t.name, items: t.items.map(text => ({ id: newId(), text, done: false })),
      }))
      const t = await api.insertOne('tickets', {
        title, status_id: statusId, checklists: autoLists, work_type: 'project', ...extra,
        position: Math.max(0, ...inStatus.map(x => x.position)) + 1,
      })
      setData(d => ({ ...d, tickets: [...d.tickets, t] }))
      return t
    },
    async updateTicket(id, patch) {
      setData(d => ({ ...d, tickets: d.tickets.map(t => t.id === id ? { ...t, ...patch } : t) }))
      try { await api.update('tickets', id, patch) } catch (e) { setError(e.message); load() }
    },
    async deleteTicket(id) {
      setData(d => ({ ...d, tickets: d.tickets.filter(t => t.id !== id).map(t => t.parent_id === id ? { ...t, parent_id: null } : t) }))
      await api.remove('tickets', id)
    },
    async saveRow(table, key, row) {
      // insert or update a config row (statuses, fields, checklist_templates)
      if (row.id) {
        setData(d => ({ ...d, [key]: d[key].map(r => r.id === row.id ? { ...r, ...row } : r) }))
        const { id, user_id, created_at, ...patch } = row
        await api.update(table, id, patch)
      } else {
        const r = await api.insertOne(table, row)
        setData(d => ({ ...d, [key]: [...d[key], r] }))
      }
    },
    async deleteRow(table, key, id) {
      setData(d => ({ ...d, [key]: d[key].filter(r => r.id !== id) }))
      await api.remove(table, id)
      if (table === 'statuses') load()
    },
  }

  if (error) return (
    <div className="center"><div className="card">
      <h2>Something went wrong</h2><p className="note">{error}</p>
      <p className="muted">If this is a fresh deploy, make sure you ran <code>supabase/schema.sql</code> in the Supabase SQL editor.</p>
      <button onClick={() => { setError(''); load() }}>Retry</button>
    </div></div>
  )
  if (!data) return <div className="center muted">Loading your board…</div>

  const statuses = sortBy(data.statuses)
  const fields = sortBy(data.fields)
  const openTicket = data.tickets.find(t => t.id === openId)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span>Project Portfolio</div>
        <nav>
          <button className={view === 'board' ? 'tab on' : 'tab'} onClick={() => setView('board')}>Board</button>
          <button className={view === 'settings' ? 'tab on' : 'tab'} onClick={() => setView('settings')}>Settings</button>
          <button className={view === 'import' ? 'tab on' : 'tab'} onClick={() => setView('import')}>Import CSV</button>
        </nav>
        <div className="right">
          {DEMO ? <span className="pill warn" title="No Supabase keys set — data is saved only in this browser">Demo mode</span>
            : <><span className="muted small">{session.user?.email}</span>
              <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button></>}
        </div>
      </header>
      {view === 'board' && <Board statuses={statuses} fields={fields} tickets={data.tickets} actions={actions} onOpen={setOpenId} />}
      {view === 'settings' && <Settings settings={data.settings} statuses={statuses} fields={fields} templates={data.templates} tickets={data.tickets} actions={actions} />}
      {view === 'import' && <ImportCsv statuses={statuses} fields={fields} tickets={data.tickets} settings={data.settings} actions={actions} onDone={() => { load(); setView('board') }} />}
      {openTicket && (
        <TicketModal ticket={openTicket} tickets={data.tickets} onOpen={setOpenId} statuses={statuses} fields={fields} templates={data.templates}
          actions={actions} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}
