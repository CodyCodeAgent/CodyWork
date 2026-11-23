import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [operation, output, macBundle, archive] = process.argv.slice(2)
const { version } = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const desktopRelease = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF_TYPE === 'tag'
const tag = process.env.GITHUB_REF_NAME
const publicKey = process.env.CODYWORK_DESKTOP_UPDATER_PUBLIC_KEY?.trim() || ''

if (desktopRelease) {
  const cargoVersion = readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version = "([^"]+)"/m)?.[1]
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      cargoVersion !== version || tag !== `desktop-v${version}`) {
    throw new Error('Desktop tag, Cargo.toml and tauri.conf.json must use the same stable version.')
  }
  if (!publicKey) throw new Error('Set the repository variable CODYWORK_DESKTOP_UPDATER_PUBLIC_KEY before publishing.')
}

if (operation === 'config') {
  writeFileSync(output, JSON.stringify({
    bundle: { createUpdaterArtifacts: desktopRelease },
    plugins: { updater: { pubkey: publicKey } },
  }))
} else if (operation === 'assets' && desktopRelease) {
  const signature = readFileSync(join(macBundle, 'CodyWork.app.tar.gz.sig'), 'utf8').trim()
  if (!signature) throw new Error('The updater signature is empty.')
  const asset = 'CodyWork.app.tar.gz'
  const url = `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/download/${tag}/${asset}`
  const notes = execFileSync('git', ['for-each-ref', '--format=%(contents)', `refs/tags/${tag}`], { encoding: 'utf8' }).trim()
  const platform = { signature, url }

  mkdirSync(output, { recursive: true })
  copyFileSync(join(macBundle, asset), join(output, asset))
  copyFileSync(join(macBundle, asset + '.sig'), join(output, asset + '.sig'))
  copyFileSync(archive, join(output, `CodyWork-macos-${version}.zip`))
  writeFileSync(join(output, 'release-notes.md'), notes + '\n')
  writeFileSync(join(output, 'latest.json'), JSON.stringify({
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: { 'darwin-aarch64': platform, 'darwin-x86_64': platform },
  }, null, 2) + '\n')
} else {
  throw new Error('Expected config, or assets during a desktop tag build.')
}
