import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStaticAssetHandler } from '../src/http/staticAssets.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('production static assets', () => {
  it('serves built assets and falls back to the SPA entry point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codywork-static-'))
    temporaryRoots.push(root)
    await writeFile(join(root, 'index.html'), '<main>CodyWork production</main>')
    await writeFile(join(root, 'app.js'), 'globalThis.codyWork = true')
    const serve = createStaticAssetHandler(root)
    const server = createServer(async (req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      if (!await serve(req, res, pathname)) {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    const origin = `http://127.0.0.1:${address.port}`

    try {
      expect(await (await fetch(`${origin}/app.js`)).text()).toContain('codyWork')
      expect(await (await fetch(`${origin}/workspace/demand`)).text()).toContain('CodyWork production')
      expect((await fetch(`${origin}/missing.css`)).status).toBe(404)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
