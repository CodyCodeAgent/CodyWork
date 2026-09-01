import { once } from 'node:events'
import { WorkbenchDb } from '../src/db/index.js'
import { startServer } from '../src/routes/index.js'
import { describe, expect, it } from 'vitest'

describe('password protected CodyWork service', () => {
  it('protects pages and APIs while retaining loopback health checks', async () => {
    const db = new WorkbenchDb(':memory:')
    const server = startServer({ db }, { host: '127.0.0.1', port: 0, password: 'correct horse battery staple' })
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const base = `http://127.0.0.1:${address.port}`

    const page = await fetch(`${base}/`)
    expect(page.status).toBe(401)
    await expect(page.text()).resolves.toContain('请输入访问密码')

    const rejected = await fetch(`${base}/api/workspaces`)
    expect(rejected.status).toBe(401)
    await expect(rejected.json()).resolves.toMatchObject({ ok: false, error: 'authentication required' })

    const wrong = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ password: 'nope' }),
    })
    expect(wrong.status).toBe(401)

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ password: 'correct horse battery staple' }),
    })
    expect(login.status).toBe(303)
    const cookie = login.headers.get('set-cookie')
    expect(cookie).toContain('codywork_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')

    const accepted = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookie ?? '' } })
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toMatchObject({ ok: true })

    const health = await fetch(`${base}/api/health`)
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({ ok: true, data: { service: 'codywork' } })

    await new Promise<void>(resolve => server.close(() => resolve()))
    db.close()
  })
})
