import { existsSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

export interface DirectoryRoot {
  name: string
  path: string
}

export interface DirectoryEntry {
  name: string
  path: string
}

export interface DirectoryListing {
  roots: DirectoryRoot[]
  current: string
  parent: string | null
  directories: DirectoryEntry[]
}

function canonicalDirectory(path: string): string {
  const normalized = resolve(path.trim())
  if (!isAbsolute(normalized) || !existsSync(normalized)) throw new Error('目录不存在')
  const canonical = realpathSync(normalized)
  readdirSync(canonical, { withFileTypes: true })
  return canonical
}

function configuredRoots(): string[] {
  const home = homedir()
  const dataHome = join('/data00/home', basename(home))
  const extra = process.env.CODYWORK_DIRECTORY_ROOTS?.split(',').map(path => path.trim()).filter(Boolean) ?? []
  return [home, ...(existsSync(dataHome) ? [dataHome] : []), ...extra]
}

function isWithin(path: string, root: string): boolean {
  const difference = relative(root, path)
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference))
}

function allowedRoots(paths = configuredRoots()): DirectoryRoot[] {
  const seen = new Set<string>()
  return paths.flatMap((path): DirectoryRoot[] => {
    try {
      const canonical = canonicalDirectory(path)
      if (seen.has(canonical)) return []
      seen.add(canonical)
      return [{ name: canonical === homedir() ? '主目录' : basename(canonical) || canonical, path: canonical }]
    } catch {
      return []
    }
  })
}

/** Lists only direct child directories under server-side approved roots. */
export function listBrowsableDirectories(requestedPath?: string, rootPaths?: string[]): DirectoryListing {
  const roots = allowedRoots(rootPaths)
  if (roots.length === 0) throw new Error('没有可浏览的目录根')
  const requested = requestedPath?.trim()
  const current = requested ? canonicalDirectory(requested) : roots[0]!.path
  if (!roots.some(root => isWithin(current, root.path))) throw new Error('目录不在允许浏览范围内')

  const directories = readdirSync(current, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, path: join(current, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name))

  const candidateParent = dirname(current)
  const parent = roots.some(root => isWithin(candidateParent, root.path)) ? candidateParent : null
  return { roots, current, parent, directories }
}
