const { core: { invoke }, event: { listen }, window: { getCurrentWindow } } = window.__TAURI__
const currentVersion = document.getElementById('current-version')
const heading = document.getElementById('update-heading')
const status = document.getElementById('update-status')
const progress = document.getElementById('update-progress')
const notes = document.getElementById('update-notes')
const check = document.getElementById('check-updates')
const install = document.getElementById('install-update')
const dismiss = document.getElementById('dismiss-update')
let offeredVersion

function render(update) {
  const phase = update.phase
  const available = phase === 'available'
  const downloading = phase === 'downloading'
  const percentage = downloading && update.total ? Math.min(100, update.received / update.total * 100) : null
  offeredVersion = available ? update.version : undefined
  currentVersion.textContent = `CodyWork ${update.currentVersion}`
  heading.textContent = available ? `发现新版本 ${update.version}` : '软件更新'
  status.dataset.error = String(phase === 'error')
  const messages = {
    disabled: '此构建未配置应用内更新。',
    idle: '可以手动检查最新版本。',
    checking: '正在检查更新…',
    current: '你正在使用最新版本。',
    available: '下载完成后，应用会安装更新并重新打开。',
    downloading: percentage === null ? '正在下载更新…' : `正在下载更新 · ${Math.floor(percentage)}%`,
    installing: '正在安装更新并重新打开…',
    error: update.message,
  }
  const message = messages[phase]
  if (status.textContent !== message) status.textContent = message
  check.disabled = ['disabled', 'checking', 'downloading', 'installing'].includes(phase)
  dismiss.hidden = !available
  install.hidden = !available
  install.disabled = !available
  notes.hidden = !available || !update.notes
  notes.textContent = available ? update.notes : ''
  progress.hidden = !downloading
  if (percentage === null) progress.removeAttribute('value')
  else {
    progress.max = 100
    progress.value = percentage
  }
}

function reportError() {
  status.dataset.error = 'true'
  status.textContent = '更新操作失败，请重新检查。'
  check.disabled = false
}

check.addEventListener('click', () => {
  check.disabled = true
  invoke('desktop_check_updates').catch(reportError)
})
dismiss.addEventListener('click', () => { getCurrentWindow().close().catch(reportError) })
install.addEventListener('click', () => {
  if (!offeredVersion) return
  install.disabled = true
  invoke('desktop_install_update', { version: offeredVersion }).catch(reportError)
})

try {
  let receivedEvent = false
  await listen('desktop-update-changed', ({ payload }) => {
    receivedEvent = true
    render(payload)
  })
  const state = await invoke('desktop_update_status')
  if (!receivedEvent) render(state)
} catch {
  reportError()
}
