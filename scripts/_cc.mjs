const BASE = 'https://bodha-ai-three.vercel.app'
let cookie = ''
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ')
  return res
}
const ok = (l, c, e = '') => console.log(`${c ? '✅' : '❌'} ${l}${e ? ` — ${e}` : ''}`)

const email = `cc-${Date.now()}@example.com`
await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'CC', email, password: 'bodha-test-1234' }) })

// Exactly what Srijan tried, from the real deployment.
const KEY = process.env.CC_KEY
let res = await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ custom: { baseUrl: 'https://codecraftapi.com/v1', apiKey: KEY,
    models: [{ id: 'claude-opus-4.8', label: 'Claude Opus' }, { id: 'gpt-4o-mini', label: 'GPT mini' }] } }) })
let data = await res.json().catch(() => ({}))
ok('the test still cannot reach it (their API is down)', !res.ok)
console.log(`   the message you will see:\n   "${(data.error ?? '').slice(0, 300)}"`)
ok('and BODHA offers “Save anyway”', data.canSaveAnyway === true)

// Save anyway — the path they want.
res = await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ custom: { baseUrl: 'https://codecraftapi.com/v1', apiKey: KEY, skipTest: true,
    models: [{ id: 'claude-opus-4.8', label: 'Claude Opus' }, { id: 'gpt-4o-mini', label: 'GPT mini' }] } }) })
data = await res.json().catch(() => ({}))
ok('it saves, with both models named', res.ok && data.settings?.custom?.models?.length === 2,
   (data.settings?.custom?.models ?? []).map(m => m.label).join(' + '))
ok('the key never comes back', data.settings?.custom && !('apiKey' in data.settings.custom))
console.log(`   warning shown: "${(data.warning ?? '').slice(0, 120)}…"`)

// A question on their model falls back to BODHA with a notice naming it.
const chat = (await (await call('/api/chats', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'CC' }) })).json()).chat
const t0 = Date.now()
res = await call(`/api/chats/${chat.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ content: 'Say hello in three words.', model: 'claude-opus-4.8' }) })
let text = '', notices = []
const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
while (true) { const { done, value } = await reader.read(); if (done) break
  buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
  for (const line of lines) { if (!line.trim()) continue; const f = JSON.parse(line)
    if (f.t === 'delta') text += f.v; if (f.t === 'notice') notices.push(f.v) } }
ok('you still get an answer while it is down', text.length > 5, `${Date.now()-t0}ms · "${text.slice(0, 34)}"`)
ok('the notice names your model the way you named it', notices.some(n => n.includes('Claude Opus')), notices[0]?.slice(0, 90))

console.log(`CLEANUP_EMAIL=${email}`)
