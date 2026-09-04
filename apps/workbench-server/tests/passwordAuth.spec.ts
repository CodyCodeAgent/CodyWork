import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkbenchDb } from '../src/db/index.js'
import { startServer } from '../src/routes/index.js'
import { describe, expect, it } from 'vitest'

async function closeServer(server: ReturnType<typeof startServer>): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()))
}

describe('password protected CodyWork service', () => {
  it('refuses to listen on a non-loopback host without a password', () => {
    const db = new WorkbenchDb(':memory:')
    expect(() => startServer({ db }, { host: '0.0.0.0', port: 0 })).toThrow('CODYWORK_PASSWORD is required')
    expect(() => startServer({ db }, { host: '127.example.com', port: 0 })).toThrow('CODYWORK_PASSWORD is required')
    db.close()
  })

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
    expect(cookie).not.toContain('Secure')

    const accepted = await fetch(`${base}/api/workspaces`, { headers: { cookie: cookie ?? '' } })
    expect(accepted.status).toBe(200)
    await expect(accepted.json()).resolves.toMatchObject({ ok: true })

    const health = await fetch(`${base}/api/health`)
    expect(health.status).toBe(200)
    await expect(health.json()).resolves.toMatchObject({ ok: true, data: { service: 'codywork' } })

    await closeServer(server)
    db.close()
  })

  it('marks the browser session Secure behind an HTTPS reverse proxy', async () => {
    const db = new WorkbenchDb(':memory:')
    const server = startServer({ db }, { host: '127.0.0.1', port: 0, password: 'correct horse battery staple' })
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const login = await fetch(`http://127.0.0.1:${address.port}/api/auth/login`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ password: 'correct horse battery staple' }),
    })
    expect(login.headers.get('set-cookie')).toContain('Secure')
    await closeServer(server)
    db.close()
  })

  it('retains a valid browser session after the CodyWork process restarts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-auth-session-'))
    const path = join(root, 'workspace.db')
    const firstDb = new WorkbenchDb(path)
    const first = startServer({ db: firstDb }, { host: '127.0.0.1', port: 0, password: 'correct horse battery staple' })
    await once(first, 'listening')
    const firstAddress = first.address()
    if (!firstAddress || typeof firstAddress === 'string') throw new Error('server did not bind')
    const firstBase = `http://127.0.0.1:${firstAddress.port}`
    const login = await fetch(`${firstBase}/api/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    })
    const cookie = login.headers.get('set-cookie')
    expect(login.status).toBe(303)
    await closeServer(first)
    firstDb.close()

    const restoredDb = new WorkbenchDb(path)
    const restored = startServer({ db: restoredDb }, { host: '127.0.0.1', port: 0, password: 'correct horse battery staple' })
    await once(restored, 'listening')
    const restoredAddress = restored.address()
    if (!restoredAddress || typeof restoredAddress === 'string') throw new Error('server did not bind')
    const restoredBase = `http://127.0.0.1:${restoredAddress.port}`
    const accepted = await fetch(`${restoredBase}/api/workspaces`, { headers: { cookie: cookie ?? '' } })
    expect(accepted.status).toBe(200)

    await closeServer(restored)
    restoredDb.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('invalidates persisted sessions when the configured password changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codywork-auth-password-change-'))
    const path = join(root, 'workspace.db')
    const firstDb = new WorkbenchDb(path)
    const first = startServer({ db: firstDb }, { host: '127.0.0.1', port: 0, password: 'first password' })
    await once(first, 'listening')
    const firstAddress = first.address()
    if (!firstAddress || typeof firstAddress === 'string') throw new Error('server did not bind')
    const login = await fetch(`http://127.0.0.1:${firstAddress.port}/api/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ password: 'first password' }),
    })
    const cookie = login.headers.get('set-cookie')
    await closeServer(first)
    firstDb.close()

    const changedDb = new WorkbenchDb(path)
    const changed = startServer({ db: changedDb }, { host: '127.0.0.1', port: 0, password: 'second password' })
    await once(changed, 'listening')
    const changedAddress = changed.address()
    if (!changedAddress || typeof changedAddress === 'string') throw new Error('server did not bind')
    const rejected = await fetch(`http://127.0.0.1:${changedAddress.port}/api/workspaces`, { headers: { cookie: cookie ?? '' } })
    expect(rejected.status).toBe(401)

    await closeServer(changed)
    changedDb.close()
    rmSync(root, { recursive: true, force: true })
  })
})
