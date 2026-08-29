import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

async function regularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export function createStaticAssetHandler(root: string) {
  const assetRoot = resolve(root)
  const indexPath = resolve(assetRoot, 'index.html')

  return async function serveStaticAsset(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false

    let decodedPath: string
    try {
      decodedPath = decodeURIComponent(pathname)
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Bad request')
      return true
    }

    const requestedPath = resolve(assetRoot, `.${decodedPath}`)
    const escapedRoot = relative(assetRoot, requestedPath).startsWith('..')
    if (escapedRoot) return false

    const filePath = await regularFile(requestedPath)
      ? requestedPath
      : extname(decodedPath) === '' && await regularFile(indexPath)
        ? indexPath
        : null
    if (!filePath) return false

    const metadata = await stat(filePath)
    const extension = extname(filePath).toLowerCase()
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
      'Content-Length': String(metadata.size),
      'Cache-Control': filePath === indexPath ? 'no-cache' : 'public, max-age=31536000, immutable',
    })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    createReadStream(filePath).pipe(res)
    return true
  }
}
