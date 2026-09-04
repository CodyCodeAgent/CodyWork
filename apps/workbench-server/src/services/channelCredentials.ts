import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const PREFIX = 'codywork:v1'

function keyPath(databasePath: string): string {
  return process.env.CODYWORK_CHANNEL_KEY_FILE?.trim() || join(dirname(databasePath), 'channel-credentials.key')
}

function credentialKey(databasePath: string): Buffer {
  const encoded = process.env.CODYWORK_CHANNEL_KEY?.trim()
  if (encoded) {
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== 32) throw new Error('CODYWORK_CHANNEL_KEY 必须是 32 字节 Base64 密钥')
    return key
  }
  const path = keyPath(databasePath)
  if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' })
  const key = readFileSync(path)
  if (key.length !== 32) throw new Error(`飞书凭据密钥格式无效：${path}`)
  return key
}

export function sealChannelCredential(value: string, accountId: string, databasePath: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', credentialKey(databasePath), iv)
  cipher.setAAD(Buffer.from(`${PREFIX}:${accountId}`))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':')
}

export function openChannelCredential(value: string, accountId: string, databasePath: string): string {
  const [namespace, version, ivValue, tagValue, encryptedValue, extra] = value.split(':')
  if (`${namespace}:${version}` !== PREFIX || !ivValue || !tagValue || !encryptedValue || extra) throw new Error('飞书凭据密文格式无效')
  const decipher = createDecipheriv('aes-256-gcm', credentialKey(databasePath), Buffer.from(ivValue, 'base64url'))
  decipher.setAAD(Buffer.from(`${PREFIX}:${accountId}`))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8')
}
