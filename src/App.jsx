import { useEffect, useState, useCallback } from 'react'
import { api, supabase, DEMO, newId, COLORS } from './api.js'
import { descendants, cleanPrefix } from './format.js'
import Board from './Board.jsx'
import TicketModal from './TicketModal.jsx'
import Settings from './Settings.jsx'
import ImportCsv from './ImportCsv.jsx'

const BOARD_KEY = 'pb-current-board'
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
  const [boardId, setBoardIdState] = useState(() => { try { return localStorage.getItem(BOARD_KEY) } catch { return null } })
  const setBoardId = id => { setBoardIdState(id); try { localStorage.setItem(BOARD_KEY, id) } catch {} }
  const [boardMenu, setBoardMenu] = useState(false)

  const load = useCallback(async () => {
    try {
      let [statuses, fields, tickets, templates, settingsRows] = await Promise.all([
        api.list('statuses'), api.list('fields'), api.list('tickets'), api.list('checklist_templates'), api.list('settings').catch(() => []),
      ])
      const links = await api.list('ticket_links').catch(() => [])
      const descTemplates = await api.list('description_templates').catch(() => [])
      let boards
      try { boards = await api.list('boards') }
      catch { throw new Error('Your database needs the latest update: run supabase/schema.sql in the Supabase SQL Editor, then reload.') }
      // first run / upgrade: everything goes on one "Projects" board
      if (boards.length === 0) {
        boards = [await api.insertOne('boards', {
          name: 'Projects', key_prefix: settingsRows[0]?.key_prefix || 'PRJ', position: 0, api_enabled: true,
        })]
      }
      const first = boards[0].id
      for (const st of statuses.filter(x => !x.board_id)) { await api.update('statuses', st.id, { board_id: first }); st.board_id = first }
      for (const t of tickets.filter(x => !x.board_id)) { await api.update('tickets', t.id, { board_id: first }); t.board_id = first }
      for (const b of boards) {
        if (!statuses.some(x => x.board_id === b.id)) {
          statuses = statuses.concat(await api.insert('statuses', DEFAULT_STATUSES.map((x, i) => ({ ...x, position: i, board_id: b.id }))))
        }
      }
      setData({ statuses, fields, tickets, templates, settings: settingsRows[0] || null, links, descTemplates, boards })
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
      const statusBoard = data.statuses.find(x => x.id === statusId)?.board_id
      extra = { board_id: statusBoard || currentBoard.id, ...extra }
      const inStatus = data.tickets.filter(t => t.status_id === statusId)
      const autoLists = data.templates.filter(t => t.auto_apply).map(t => ({
        id: newId(), title: t.name, items: t.items.map(text => ({ id: newId(), text, done: false })),
      }))
      const workType = extra.work_type || 'project'
      const defaultDesc = (data.descTemplates || []).find(d => d.work_type === workType)
      const t = await api.insertOne('tickets', {
        title, status_id: statusId, checklists: autoLists, work_type: 'project',
        ...(defaultDesc ? { description: defaultDesc.body } : {}), ...extra,
        position: Math.max(0, ...inStatus.map(x => x.position)) + 1,
      })
      setData(d => ({ ...d, tickets: [...d.tickets, t] }))
      return t
    },
    async updateTicket(id, patch) {
      setData(d => ({ ...d, tickets: d.tickets.map(t => t.id === id ? { ...t, ...patch } : t) }))
      try { await api.update('tickets', id, patch) } catch (e) { setError(e.message); load() }
    },
    async createBoard(name, key_prefix) {
      const b = await api.insertOne('boards', { name, key_prefix, position: data.boards.length, api_enabled: false })
      const sts = await api.insert('statuses', DEFAULT_STATUSES.map((x, i) => ({ ...x, position: i, board_id: b.id })))
      setData(d => ({ ...d, boards: [...d.boards, b], statuses: [...d.statuses, ...sts] }))
      return b
    },
    // change a board's key prefix: every ticket on it gets the new key, the old one is remembered
    async changeBoardKey(board, prefix) {
      await actions.saveRow('boards', 'boards', { id: board.id, key_prefix: prefix })
      for (const t of data.tickets.filter(x => x.board_id === board.id)) {
        const key = `${prefix}-${t.number}`
        if (key === t.key) continue
        await actions.updateTicket(t.id, { key, prev_keys: [...new Set([...(t.prev_keys || []), t.key].filter(Boolean))] })
      }
    },
    // move a ticket (and everything nested under it) to another board
    async moveTicket(id, toBoardId) {
      const root = data.tickets.find(t => t.id === id)
      const target = data.boards.find(b => b.id === toBoardId)
      if (!root || !target || root.board_id === toBoardId) return
      const moving = [root, ...data.tickets.filter(t => descendants(id, data.tickets).has(t.id)).sort((a, b) => (a.number || 0) - (b.number || 0))]
      let targetStatuses = data.statuses.filter(x => x.board_id === toBoardId).sort((a, b) => a.position - b.position)
      // columns the moving tickets use but the target board doesn't have yet are added to it
      const needed = [...new Map(moving.map(t => data.statuses.find(x => x.id === t.status_id)).filter(Boolean)
        .filter(st => !targetStatuses.some(x => x.name.toLowerCase() === st.name.toLowerCase()))
        .map(st => [st.name.toLowerCase(), st])).values()]
      if (needed.length) {
        const created = await api.insert('statuses', needed.map((st, i) => ({ name: st.name, color: st.color, position: targetStatuses.length + i, board_id: toBoardId })))
        setData(d => ({ ...d, statuses: [...d.statuses, ...created] }))
        targetStatuses = [...targetStatuses, ...created]
      }
      let next = Math.max(0, ...data.tickets.filter(t => t.board_id === toBoardId).map(t => t.number || 0))
      for (const t of moving) {
        const oldStatus = data.statuses.find(x => x.id === t.status_id)
        const st = targetStatuses.find(x => oldStatus && x.name.toLowerCase() === oldStatus.name.toLowerCase()) || targetStatuses[0]
        next += 1
        await actions.updateTicket(t.id, {
          board_id: toBoardId, status_id: st?.id || null, number: next, key: `${target.key_prefix}-${next}`,
          prev_keys: [...new Set([...(t.prev_keys || []), t.key].filter(Boolean))],
          ...(t.id === id ? { parent_id: null } : {}),
        })
      }
      return moving.length
    },
    async addLink(from_id, to_id, link_type) {
      const l = await api.insertOne('ticket_links', { from_id, to_id, link_type })
      setData(d => ({ ...d, links: [...d.links, l] }))
    },
    async removeLink(id) {
      setData(d => ({ ...d, links: d.links.filter(l => l.id !== id) }))
      await api.remove('ticket_links', id)
    },
    async deleteTicket(id) {
      setData(d => ({ ...d, links: d.links.filter(l => l.from_id !== id && l.to_id !== id), tickets: d.tickets.filter(t => t.id !== id).map(t => t.parent_id === id ? { ...t, parent_id: null } : t) }))
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
    // insert a row with a chosen id (used to bring back a deleted field so its saved values show again)
    async insertRow(table, key, row) {
      const r = await api.insertOne(table, row)
      setData(d => ({ ...d, [key]: [...d[key].filter(x => x.id !== r.id), r] }))
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

  const boards = sortBy(data.boards)
  const currentBoard = boards.find(b => b.id === boardId) || boards[0]
  const statusesOf = bid => sortBy(data.statuses.filter(x => x.board_id === bid))
  const statuses = statusesOf(currentBoard.id)
  const boardTickets = data.tickets.filter(t => t.board_id === currentBoard.id)
  const fields = sortBy(data.fields)
  const openTicket = data.tickets.find(t => t.id === openId)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">◆</span>Project Portfolio</div>
        <div className="board-switch">
          <button className="board-btn" onClick={() => setBoardMenu(v => !v)} title="Switch board">
            <span className="board-key">{currentBoard.key_prefix}</span> {currentBoard.name} <span className="muted">▾</span>
          </button>
          {boardMenu && <>
            <div className="menu-backdrop" onClick={() => setBoardMenu(false)} />
            <div className="board-menu">
              {boards.map(b => (
                <button key={b.id} className={'board-item' + (b.id === currentBoard.id ? ' on' : '')}
                  onClick={() => { setBoardId(b.id); setBoardMenu(false); setView('board') }}>
                  <span className="board-key">{b.key_prefix}</span>
                  <span className="board-name">{b.name}</span>
                  <span className="muted small">{data.tickets.filter(t => t.board_id === b.id).length}</span>
                  {b.api_enabled && <span className="pill api-pill" title="Shared with other apps through the API">API</span>}
                </button>
              ))}
              <button className="board-item new" onClick={async () => {
                setBoardMenu(false)
                const name = window.prompt('New board name (e.g. Internal Ops)')
                if (!name || !name.trim()) return
                const suggested = cleanPrefix(name.trim().split(/\s+/).map(w => w[0]).join('')) || 'NEW'
                const key = cleanPrefix(window.prompt('Key for this board\'s tickets (letters/numbers, e.g. OPS → OPS-1)', suggested))
                if (!key) return
                if (boards.some(b => b.key_prefix === key)) return alert(`Another board already uses the key ${key}.`)
                const b = await actions.createBoard(name.trim(), key)
                setBoardId(b.id); setView('board')
              }}>+ New board</button>
              <button className="board-item new" onClick={() => { setBoardMenu(false); setView('settings') }}>Manage boards…</button>
            </div>
          </>}
        </div>
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
      {view === 'board' && <Board key={currentBoard.id} statuses={statuses} fields={fields} tickets={boardTickets} actions={actions} onOpen={setOpenId} />}
      {view === 'settings' && <Settings boards={boards} currentBoard={currentBoard} allTickets={data.tickets} settings={data.settings} statuses={statuses} fields={fields} templates={data.templates} descTemplates={data.descTemplates} tickets={boardTickets} actions={actions} />}
      {view === 'import' && <ImportCsv boards={boards} currentBoard={currentBoard} statusesOf={statusesOf} statuses={statuses} fields={fields} tickets={data.tickets} settings={data.settings} actions={actions} onDone={() => { load(); setView('board') }} />}
      {openTicket && (
        <TicketModal ticket={openTicket} tickets={data.tickets} boards={boards} links={data.links} descTemplates={data.descTemplates} onOpen={setOpenId} statuses={statusesOf(openTicket.board_id)} fields={fields} templates={data.templates}
          actions={actions} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}
