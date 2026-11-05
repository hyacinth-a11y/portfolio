// Rich text (Jira-style) editor and viewer for ticket descriptions.
import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { Placeholder } from '@tiptap/extensions'

const extensions = (placeholder) => [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    link: { openOnClick: true, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({ placeholder }),
]

/* ---------- plain text (older / imported) -> HTML ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function inline(s) {
  return s.split(/(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|https?:\/\/[^\s<>()]+)/g).map(p => {
    const md = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)
    if (md) return `<a href="${esc(md[2])}">${esc(md[1])}</a>`
    if (/^\*\*[^*]+\*\*$/.test(p)) return `<strong>${inline(p.slice(2, -2))}</strong>`
    if (/^https?:\/\//.test(p)) return `<a href="${esc(p)}">${esc(p)}</a>`
    return esc(p)
  }).join('')
}
export const isHtml = s => /^\s*<(p|ul|ol|h[1-6]|blockquote|pre|hr|div)[\s>/]/i.test(s || '')

export function textToHtml(text) {
  if (!text) return ''
  if (isHtml(text)) return text
  const out = []
  const stack = [] // {type, liOpen}
  const closeTo = n => {
    while (stack.length > n) {
      const top = stack.pop()
      if (top.liOpen) out.push('</li>')
      out.push(`</${top.type}>`)
    }
  }
  for (const raw of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\t/g, '    ')
    const m = line.match(/^(\s*)(•|◦|-|\*|\d+[.)])\s+(.*)$/)
    if (m) {
      const level = Math.floor(m[1].length / 4)
      const type = /\d/.test(m[2]) ? 'ol' : 'ul'
      closeTo(level + 1)
      if (stack.length === level + 1) {
        const top = stack[level]
        if (top.type !== type) { closeTo(level) }
        else if (top.liOpen) { out.push('</li>'); top.liOpen = false }
      }
      while (stack.length < level + 1) {
        const parent = stack[stack.length - 1]
        if (parent && !parent.liOpen) { out.push('<li><p></p>'); parent.liOpen = true }
        out.push(`<${type}>`); stack.push({ type, liOpen: false })
      }
      out.push(`<li><p>${inline(m[3])}</p>`); stack[stack.length - 1].liOpen = true
      continue
    }
    closeTo(0)
    if (/^[─—-]{4,}\s*$/.test(line.trim())) out.push('<hr>')
    else if (line.trim()) out.push(`<p>${inline(line.trim())}</p>`)
  }
  closeTo(0)
  return out.join('')
}

export function htmlToText(html) {
  if (!isHtml(html)) return html || ''
  return html
    .replace(/<li[^>]*data-checked="true"[^>]*>/g, '\n[x] ').replace(/<li[^>]*data-checked="false"[^>]*>/g, '\n[ ] ')
    .replace(/<li[^>]*>/g, '\n• ').replace(/<\/(p|h[1-6]|blockquote|pre)>/g, '\n').replace(/<br\s*\/?>/g, '\n').replace(/<hr\s*\/?>/g, '\n---\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim()
}

/* ---------- read-only view ---------- */
export function RichView({ html }) {
  const editor = useEditor({ extensions: extensions(''), content: textToHtml(html), editable: false })
  useEffect(() => { if (editor && !editor.isDestroyed) editor.commands.setContent(textToHtml(html), { emitUpdate: false }) }, [html, editor])
  return <EditorContent editor={editor} className="rich" />
}

/* ---------- editor with toolbar ---------- */
export function RichEditor({ html, onSave, onCancel, placeholder = 'Add a description…' }) {
  const editor = useEditor({
    extensions: extensions(placeholder),
    content: textToHtml(html),
    autofocus: 'end',
    shouldRerenderOnTransaction: true,
    editorProps: {
      handleKeyDown: (_v, e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { save(); return true }
        if (e.key === 'Escape') { onCancel(); return true }
        return false
      },
    },
  })
  function save() {
    if (!editor) return
    onSave(editor.isEmpty ? '' : editor.getHTML().replace(/(<p><\/p>)+$/, ''))
  }
  if (!editor) return null
  const c = () => editor.chain().focus()
  const B = ({ on, title, run, children }) => (
    <button type="button" title={title} className={'tb' + (on ? ' on' : '')}
      onMouseDown={e => e.preventDefault()} onClick={run}>{children}</button>
  )
  const block = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3'
    : editor.isActive('heading', { level: 4 }) ? 'h4' : editor.isActive('codeBlock') ? 'code' : 'p'
  const setBlock = v => {
    if (v === 'p') c().setParagraph().run()
    else if (v === 'code') c().toggleCodeBlock().run()
    else c().setHeading({ level: +v.slice(1) }).run()
  }
  const link = () => {
    const prev = editor.getAttributes('link').href || ''
    const url = window.prompt('Link URL (leave empty to remove)', prev || 'https://')
    if (url === null) return
    if (!url.trim() || url.trim() === 'https://') return c().extendMarkRange('link').unsetLink().run()
    c().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }
  return (
    <div className="rich-edit">
      <div className="toolbar-rt">
        <select value={block} onChange={e => setBlock(e.target.value)} title="Text style">
          <option value="p">Normal text</option>
          <option value="h2">Heading 1</option>
          <option value="h3">Heading 2</option>
          <option value="h4">Heading 3</option>
          <option value="code">Code block</option>
        </select>
        <span className="sep" />
        <B title="Bold (Ctrl+B)" on={editor.isActive('bold')} run={() => c().toggleBold().run()}><b>B</b></B>
        <B title="Italic (Ctrl+I)" on={editor.isActive('italic')} run={() => c().toggleItalic().run()}><i>I</i></B>
        <B title="Underline (Ctrl+U)" on={editor.isActive('underline')} run={() => c().toggleUnderline().run()}><u>U</u></B>
        <B title="Strikethrough" on={editor.isActive('strike')} run={() => c().toggleStrike().run()}><s>S</s></B>
        <B title="Inline code" on={editor.isActive('code')} run={() => c().toggleCode().run()}>{'</>'}</B>
        <span className="sep" />
        <B title="Bulleted list" on={editor.isActive('bulletList')} run={() => c().toggleBulletList().run()}>• ☰</B>
        <B title="Numbered list" on={editor.isActive('orderedList')} run={() => c().toggleOrderedList().run()}>1. ☰</B>
        <B title="Checklist" on={editor.isActive('taskList')} run={() => c().toggleTaskList().run()}>☑</B>
        <B title="Indent (Tab)" run={() => c().sinkListItem(editor.isActive('taskList') ? 'taskItem' : 'listItem').run()}>→</B>
        <B title="Outdent (Shift+Tab)" run={() => c().liftListItem(editor.isActive('taskList') ? 'taskItem' : 'listItem').run()}>←</B>
        <span className="sep" />
        <B title="Link" on={editor.isActive('link')} run={link}>🔗</B>
        <B title="Quote" on={editor.isActive('blockquote')} run={() => c().toggleBlockquote().run()}>❝</B>
        <B title="Divider" run={() => c().setHorizontalRule().run()}>―</B>
        <span className="sep" />
        <B title="Undo (Ctrl+Z)" run={() => c().undo().run()}>↶</B>
        <B title="Redo (Ctrl+Shift+Z)" run={() => c().redo().run()}>↷</B>
      </div>
      <EditorContent editor={editor} className="rich editable" />
      <div className="row">
        <button className="primary" onClick={save}>Save</button>
        <button className="ghost" onClick={onCancel}>Cancel</button>
        <span className="muted small">Ctrl+Enter to save · Esc to cancel</span>
      </div>
    </div>
  )
}
