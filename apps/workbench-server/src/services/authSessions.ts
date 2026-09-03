import { createHash } from 'node:crypto'
import { WorkbenchDb } from '../db/index.js'

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60 * 1000

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

/**
 * Durable browser login sessions. The raw cookie token and password never
 * enter SQLite: a restart can validate a token, while a password change
 * invalidates every existing session through credentialVersion.
 */
export class AuthSessions {
  private readonly credentialVersion: string

  constructor(private readonly database: WorkbenchDb, password: string) {
    this.credentialVersion = digest(password)
  }

  create(token: string, expiresAtMs: number, nowMs = Date.now()): void {
    this.database.db.prepare('DELETE FROM auth_sessions WHERE expires_at_ms <= ?').run(nowMs)
    this.database.db.prepare(`
      INSERT INTO auth_sessions (token_hash, credential_version, created_at_ms, expires_at_ms, last_seen_at_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET credential_version = excluded.credential_version, created_at_ms = excluded.created_at_ms, expires_at_ms = excluded.expires_at_ms, last_seen_at_ms = excluded.last_seen_at_ms
    `).run(digest(token), this.credentialVersion, nowMs, expiresAtMs, nowMs)
  }

  isAuthenticated(token: string, nowMs = Date.now()): boolean {
    const tokenHash = digest(token)
    const row = this.database.db.prepare(`
      SELECT expires_at_ms, last_seen_at_ms
      FROM auth_sessions
      WHERE token_hash = ? AND credential_version = ?
    `).get(tokenHash, this.credentialVersion) as { expires_at_ms: number; last_seen_at_ms: number } | undefined
    if (!row) return false
    if (row.expires_at_ms <= nowMs) {
      this.database.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash)
      return false
    }
    if (row.last_seen_at_ms <= nowMs - LAST_SEEN_WRITE_INTERVAL_MS) {
      this.database.db.prepare('UPDATE auth_sessions SET last_seen_at_ms = ? WHERE token_hash = ?').run(nowMs, tokenHash)
    }
    return true
  }
}
