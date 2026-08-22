import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import type { WorkspaceRow } from '../db/index.js'

const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.json', '.yaml', '.yml'])

export interface KnowledgeDocument {
  id: string
  name: string
  relativePath: string
  path: string
  extension: string
  size: number
  updatedAt: string
  content?: string
}

function documentsRoot(workspace: WorkspaceRow): string {
  return resolve(workspace.path, 'docs')
}

function walk(root: string, current = root): string[] {
  if (!existsSync(current) || !statSync(current).isDirectory()) return []
  const files: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
    const path = join(current, entry.name)
    if (entry.isDirectory()) files.push(...walk(root, path))
    else if (entry.isFile() && DOCUMENT_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path)
  }
  return files
}

function toDocument(root: string, path: string, includeContent: boolean): KnowledgeDocument {
  const info = statSync(path)
  const relativePath = relative(root, path)
  return {
    id: relativePath,
    name: relativePath.split('/').pop() ?? relativePath,
    relativePath,
    path,
    extension: extname(path).toLowerCase().slice(1),
    size: info.size,
    updatedAt: info.mtime.toISOString(),
    ...(includeContent ? { content: readFileSync(path, 'utf8') } : {}),
  }
}

export function listKnowledgeDocuments(workspace: WorkspaceRow): KnowledgeDocument[] {
  const root = documentsRoot(workspace)
  return walk(root)
    .map(path => toDocument(root, path, false))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

export function getKnowledgeDocument(workspace: WorkspaceRow, id: string): KnowledgeDocument {
  const root = documentsRoot(workspace)
  const candidate = resolve(root, id)
  const relativePath = relative(root, candidate)
  if (!relativePath || relativePath.startsWith('..') || resolve(root, relativePath) !== candidate) throw new Error('知识文档路径无效')
  if (!existsSync(candidate) || !statSync(candidate).isFile() || !DOCUMENT_EXTENSIONS.has(extname(candidate).toLowerCase())) throw new Error(`知识文档不存在：${id}`)
  return toDocument(root, candidate, true)
}
