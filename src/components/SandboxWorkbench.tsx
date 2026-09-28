'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { html as htmlLang } from '@codemirror/lang-html'
import { css as cssLang } from '@codemirror/lang-css'
import { javascript as jsLang } from '@codemirror/lang-javascript'
import { createTheme } from '@uiw/codemirror-themes'
import { tags as t } from '@lezer/highlight'
import clsx from 'clsx'

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), { ssr: false })

// ─── warm CodeMirror theme (matches the chat code blocks) ───────────────────

const warmCodeTheme = createTheme({
  theme: 'dark',
  settings: {
    background: 'var(--code-bg, #2a2117)',
    foreground: '#efe3cc',
    caret: '#e8906c',
    selection: 'rgba(189, 82, 51, 0.28)',
    selectionMatch: 'rgba(189, 82, 51, 0.18)',
    lineHighlight: 'rgba(239, 227, 204, 0.05)',
    gutterBackground: 'transparent',
    gutterForeground: '#93866c',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  styles: [
    { tag: [t.comment, t.quote], color: '#93866c', fontStyle: 'italic' },
    { tag: [t.keyword, t.tagName, t.literal, t.meta, t.typeOperator], color: '#e8906c' },
    { tag: [t.string, t.regexp, t.attributeName, t.attributeValue], color: '#b5c98e' },
    { tag: [t.number, t.variableName, t.definition(t.variableName), t.className], color: '#e6c07a' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#8fc6e3' },
    { tag: [t.standard(t.variableName), t.operatorKeyword], color: '#d4a5a5' },
    { tag: [t.propertyName, t.operator, t.documentMeta], color: '#d8bfa8' },
    { tag: [t.typeName], color: '#a8d5ba' },
  ],
})

// ─── project model ───────────────────────────────────────────────────────────

export interface Project {
  html: string
  css: string
  js: string
}

const CONSOLE_SHIM = `<script>(function(){
  var fmt = function(a) {
    var parts = [];
    for (var i = 0; i < a.length; i++) {
      try {
        var x = a[i];
        parts.push (typeof x === 'object' && x !== null ? JSON.stringify(x, null, 1) : String(x));
      } catch (e) { parts.push(String(x)); }
    }
    return parts.join(' ');
  };
  ['log', 'info', 'warn', 'error'].forEach(function(kind) {
    var orig = console[kind];
    console[kind] = function() {
      try { parent.postMessage({ __bodhaConsole: true, level: kind, text: fmt(arguments) }, '*'); } catch (e) {}
      if (orig) orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e) {
    try { parent.postMessage({ __bodhaConsole: true, level: 'error', text: (e.message || 'Error') + (e.lineno ? '  (line ' + e.lineno + ')' : '') }, '*'); } catch (er) {}
  });
  window.addEventListener('unhandledrejection', function(e) {
    try { parent.postMessage({ __bodhaConsole: true, level: 'error', text: 'Unhandled promise: ' + e.reason }, '*'); } catch (er) {}
  });
})();<\/script>`

function escapeCloseScript(code: string): string {
  return code.replace(/<\/script/gi, '<\\/script')
}

/** Compiles the three editors into one runnable document for the sandbox. */
export function compileProject(p: Project): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
${p.css.trim() ? `<style>\n${p.css}\n</style>` : ''}
${CONSOLE_SHIM}
</head>
<body>
${p.html}
${p.js.trim() ? `<script>\ntry {\n${escapeCloseScript(p.js)}\n} catch (err) { console.error((err && err.message) || String(err)); }\n</scr` + `ipt>` : ''}
</body>
</html>`
}

// ─── templates ───────────────────────────────────────────────────────────────

const TEMPLATES: Record<string, { label: string; hint: string; project: Project }> = {
  blank: {
    label: 'Blank page',
    hint: 'A calm empty page',
    project: {
      html: `<h1>Hello, world 🪔</h1>\n<p>Write something wonderful here.</p>`,
      css: `body {\n  font-family: Georgia, serif;\n  background: #faf3e6;\n  color: #3e3426;\n  display: grid;\n  place-items: center;\n  min-height: 100vh;\n  margin: 0;\n}\nh1 { font-weight: 600; }`,
      js: `console.log('The sandbox is live.');`,
    },
  },
  'bouncing-ball': {
    label: 'Bouncing ball · physics',
    hint: 'requestAnimationFrame + velocity',
    project: {
      html: `<canvas id="sky" width="480" height="300"></canvas>`,
      css: `body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #2a2117; }\ncanvas { border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.4); }`,
      js: `const c = document.getElementById('sky');\nconst ctx = c.getContext('2d');\nlet x = 60, y = 60, vx = 2.4, vy = 1.2, r = 14;\n\nfunction tick() {\n  ctx.clearRect(0, 0, c.width, c.height);\n  x += vx; y += vy;\n  if (x < r || x > c.width - r) vx *= -1;\n  if (y < r || y > c.height - r) vy *= -1;\n  ctx.beginPath();\n  ctx.arc(x, y, r, 0, Math.PI * 2);\n  ctx.fillStyle = '#e8906c';\n  ctx.fill();\n  requestAnimationFrame(tick);\n}\ntick();`,
    },
  },
  'sorting-visualizer': {
    label: 'Sorting visualizer · arrays',
    hint: 'bubble sort, drawn live',
    project: {
      html: `<canvas id="bars" width="480" height="300"></canvas>\n<p style="color:#93866c;font-family:Georgia,serif;text-align:center">Bubble sort, step by step…</p>`,
      css: `body { margin: 0; display: grid; place-items: center; min-height: 100vh; background: #2a2117; }`,
      js: `const c = document.getElementById('bars'), ctx = c.getContext('2d');\nconst bars = Array.from({ length: 24 }, () => 20 + Math.random() * 240);\nlet i = 0, j = 0;\n\nfunction draw() {\n  ctx.clearRect(0, 0, c.width, c.height);\n  const w = c.width / bars.length;\n  bars.forEach((h, k) => {\n    ctx.fillStyle = k === j || k === j + 1 ? '#e8906c' : '#b5c98e';\n    ctx.fillRect(k * w + 2, c.height - h, w - 4, h);\n  });\n}\n\nfunction step() {\n  if (i >= bars.length) { draw(); return; }\n  if (j >= bars.length - i - 1) { j = 0; i++; }\n  else {\n    if (bars[j] > bars[j + 1]) [bars[j], bars[j + 1]] = [bars[j + 1], bars[j]];\n    j++;\n  }\n  draw();\n  setTimeout(step, 24);\n}\nstep();`,
    },
  },
  quiz: {
    label: 'Quiz card · DOM practice',
    hint: 'state + event listeners',
    project: {
      html: `<div class="card">\n  <h2>Quick quiz</h2>\n  <p id="q">What is the powerhouse of the cell?</p>\n  <input id="a" placeholder="Your answer…" />\n  <button id="check">Check</button>\n  <p id="verdict"></p>\n</div>`,
      css: `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #faf3e6; font-family: Georgia, serif; color: #3e3426; }\n.card { background: #fffcf6; padding: 28px; border-radius: 16px; box-shadow: 0 10px 30px rgba(61,52,39,.15); width: 320px; }\ninput { padding: 8px 10px; border-radius: 8px; border: 1px solid #e9ddc7; width: 100%; }\nbutton { margin-top: 10px; padding: 8px 18px; border: none; border-radius: 999px; background: #bd5221; color: #fff; cursor: pointer; }`,
      js: `const answers = {\n  'powerhouse of the cell': 'mitochondria',\n};\ndocument.getElementById('check').onclick = function () {\n  const given = document.getElementById('a').value.trim().toLowerCase();\n  const ok = given.includes('mitochondria');\n  document.getElementById('verdict').textContent = ok\n    ? 'Correct! 🎉'\n    : 'Not quite — try again.';\n};\nconsole.log('Wire up more questions in the js tab!');`,
    },
  },
}

export const TEMPLATE_KEYS = Object.keys(TEMPLATES)

// ─── the workbench ───────────────────────────────────────────────────────────

type Tab = 'html' | 'css' | 'js'

interface Props {
  storageKey?: string
  initialProject?: Project
  embedded?: boolean
  onExplain?: (project: Project) => void
}

export default function SandboxWorkbench({ storageKey, initialProject, embedded, onExplain }: Props) {
  const [tab, setTab] = useState<Tab>('html')
  const [project, setProject] = useState<Project>(() => {
    if (initialProject) return initialProject
    if (storageKey && typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(storageKey)
        if (saved) return JSON.parse(saved) as Project
      } catch {}
    }
    return TEMPLATES.blank.project
  })
  const [autoRun, setAutoRun] = useState(true)
  const [srcdoc, setSrcdoc] = useState(() => compileProject(initialProject ?? TEMPLATES.blank.project))
  const [consoleLines, setConsoleLines] = useState<{ level: string; text: string }[]>([])
  const [consoleOpen, setConsoleOpen] = useState(!embedded)
  const runTokenRef = useRef(0)

  // persist
  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(project))
    } catch {}
  }, [storageKey, project])

  const run = useCallback((p: Project) => {
    runTokenRef.current += 1
    setConsoleLines([])
    setSrcdoc(compileProject(p))
  }, [])

  // auto-run (debounced)
  useEffect(() => {
    if (!autoRun) return
    const t = setTimeout(() => run(project), 700)
    return () => clearTimeout(t)
  }, [project, autoRun, run])

  // console bridge
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data as { __bodhaConsole?: boolean; level?: string; text?: string }
      if (!d || !d.__bodhaConsole) return
      setConsoleLines(prev => [...prev.slice(-199), { level: d.level ?? 'log', text: d.text ?? '' }])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const update = (part: Tab) => (value: string) => setProject(p => ({ ...p, [part]: value }))

  const editorLang = useMemo(() => {
    if (tab === 'html') return [htmlLang()]
    if (tab === 'css') return [cssLang()]
    return [jsLang()]
  }, [tab])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex rounded-full border border-border bg-background p-0.5">
          {(['html', 'css', 'js'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'rounded-full px-3.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <button onClick={() => run(project)} className="btn-primary px-3.5 py-1.5 text-xs">
          ▶ Run
        </button>
        <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={autoRun} onChange={e => setAutoRun(e.target.checked)} className="accent-primary" />
          Auto-run
        </label>

        {!embedded && (
          <select
            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground focus-warm"
            defaultValue=""
            onChange={e => {
              const t = TEMPLATES[e.target.value]
              if (!t) return
              if (!window.confirm('Load this template? Your current sandbox code will be replaced.')) return
              setProject(t.project)
              run(t.project)
            }}
          >
            <option value="" disabled>
              Templates…
            </option>
            {TEMPLATE_KEYS.map(k => (
              <option key={k} value={k}>
                {TEMPLATES[k].label}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          {onExplain && (
            <button
              onClick={() => onExplain(project)}
              className="btn-ghost px-3.5 py-1.5 text-xs"
              title="Send this code to BODHA and ask for an explanation"
            >
              🪔 Ask BODHA to explain
            </button>
          )}
        </div>
      </div>

      {/* body: editors | preview */}
      <div className="grid min-h-0 flex-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
        {/* editor column */}
        <div className="flex min-h-0 flex-col border-b border-border md:border-b-0 md:border-r">
          <div className="min-h-0 flex-1 overflow-hidden text-[13px]">
            <CodeMirror
              value={project[tab]}
              height="100%"
              theme={warmCodeTheme}
              extensions={editorLang}
              onChange={update(tab)}
              basicSetup={{ foldGutter: false, highlightActiveLine: false }}
              className="h-full"
            />
          </div>
          <p className="border-t border-border/70 bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
            {tab === 'html' && 'The structure — what is on the page.'}
            {tab === 'css' && 'The look — colors, spacing, layout.'}
            {tab === 'js' && 'The behaviour — what happens when things are pressed.'}
          </p>
        </div>

        {/* preview column */}
        <div className="flex min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-border bg-card px-3 py-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Compiled preview</span>
            <button
              onClick={() => setConsoleOpen(v => !v)}
              className="rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-primary"
            >
              Console {consoleLines.length ? `(${consoleLines.length})` : ''} {consoleOpen ? '▾' : '▸'}
            </button>
          </div>
          <div className="min-h-0 flex-1 bg-white">
            <iframe
              key={runTokenRef.current}
              title="BODHA sandbox preview"
              srcDoc={srcdoc}
              sandbox="allow-scripts allow-modals allow-forms"
              className="h-full w-full border-0"
            />
          </div>
          {consoleOpen && (
            <div className="max-h-40 min-h-[2rem] shrink-0 overflow-y-auto border-t border-border bg-[var(--code-bg)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#efe3cc]">
              {consoleLines.length === 0 ? (
                <span className="text-[#93866c]">console output will appear here…</span>
              ) : (
                consoleLines.map((l, i) => (
                  <div key={i} className={clsx(l.level === 'error' ? 'text-[#e08d8d]' : l.level === 'warn' ? 'text-[#e6c07a]' : '')}>
                    <span className="mr-1.5 select-none text-[#93866c]">{l.level === 'error' ? '✖' : l.level === 'warn' ? '⚠' : '›'}</span>
                    {l.text}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { TEMPLATES }
