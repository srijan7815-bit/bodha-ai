const BASE = 'https://bodha-ai-three.vercel.app'
let cookie = ''
const call = async (path, init = {}) => {
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ')
  return res
}
const email = `roll-${Date.now()}@example.com`
await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Roll', email, password: 'bodha-test-1234' }) })
const res = await call('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ custom: { baseUrl: 'https://no-such-host-abcxyz.example/v1', apiKey: 'k',
    models: [{ id: 'm', label: 'M' }] } }) })
const data = await res.json().catch(() => ({}))
console.log(`NEW=${data.canSaveAnyway === true}`)
console.log(`error="${(data.error ?? '').slice(0, 70)}"`)
console.log(`CLEANUP_EMAIL=${email}`)
