const BASE = 'https://bodha-ai-three.vercel.app'
let cookie = ''
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ')
  return res
}
const KEY = process.env.CC_KEY
const email = `dbg-${Date.now()}@example.com`
await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Dbg', email, password: 'bodha-test-1234' }) })

// 1. plain save-anyway with a target we control nothing about
let res = await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ custom: { baseUrl: 'https://example.com/v1', apiKey: 'k', models: [{ id: 'm', label: 'M' }], skipTest: true } }) })
console.log(`\n[save-anyway, generic host] status=${res.status}\n  ${(await res.text()).slice(0, 400)}`)

// 2. the codecraft payload, skipTest
res = await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ custom: { baseUrl: 'https://codecraftapi.com/v1', apiKey: KEY, skipTest: true,
    models: [{ id: 'claude-opus-4.8', label: 'Claude Opus' }] } }) })
console.log(`\n[codecraft, save-anyway] status=${res.status}\n  ${(await res.text()).slice(0, 400)}`)

// 3. what does it say WITHOUT skipTest (so we see the provider's own reply)?
res = await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ custom: { baseUrl: 'https://codecraftapi.com/v1', apiKey: KEY,
    models: [{ id: 'claude-opus-4.8', label: 'Claude Opus' }] } }) })
console.log(`\n[codecraft, tested] status=${res.status}\n  ${(await res.text()).slice(0, 500)}`)
console.log(`\nCLEANUP_EMAIL=${email}`)
