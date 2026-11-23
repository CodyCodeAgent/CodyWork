const invoke = window.__TAURI__.core.invoke
const byId = id => document.getElementById(id)
const saved = byId('saved')
const list = byId('servers')
const editor = byId('editor')
const form = byId('server-form')
const name = byId('server-name')
const address = byId('server-address')
const status = byId('status')
const formFeedback = byId('form-feedback')
const removeDialog = byId('remove-dialog')
let connections
let previous = null
let busy = false

function feedback(element, message = '', error = false) {
  element.dataset.error = String(error)
  element.hidden = !message
  element.textContent = message
}

async function operation(target, waiting, action) {
  if (busy) return
  busy = true
  const controls = [...document.querySelectorAll('main button, #fields')]
  controls.forEach(control => { control.disabled = true })
  feedback(target, waiting)
  try {
    await action()
  } catch (error) {
    feedback(target, typeof error === 'string' ? error : '操作失败，请重试。', true)
  } finally {
    busy = false
    controls.forEach(control => { control.disabled = false })
  }
}

function showEditor(server) {
  previous = server?.address ?? null
  editor.hidden = false
  byId('form-title').textContent = server ? '编辑服务器' : '添加服务器'
  byId('cancel-edit').hidden = !connections.servers.length
  name.value = server?.name ?? ''
  address.value = server?.address ?? ''
  feedback(formFeedback)
  name.focus()
}

function button(text, onClick, className) {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = text
  if (className) element.className = className
  element.addEventListener('click', onClick)
  return element
}

function showServers() {
  saved.hidden = !connections.servers.length
  list.replaceChildren(...connections.servers.map(server => {
    const row = document.createElement('li')
    const details = document.createElement('div')
    const label = document.createElement('strong')
    label.textContent = server.name
    details.append(label)
    if (server.address === connections.default_address) {
      const badge = document.createElement('span')
      badge.className = 'default'
      badge.textContent = '默认'
      details.append(badge)
    }
    const url = document.createElement('p')
    url.textContent = server.address
    details.append(url)
    const actions = document.createElement('div')
    actions.className = 'actions'
    if (server.address !== connections.default_address) {
      actions.append(button('设为默认', () => operation(status, '正在保存…', async () => {
        await invoke('set_default_server', { address: server.address })
        await load()
        feedback(status, '已更新默认服务器。')
      })))
    }
    actions.append(
      button('编辑', () => showEditor(server)),
      button('移除', () => {
        byId('remove-name').textContent = server.name
        removeDialog.returnValue = ''
        removeDialog.addEventListener('close', () => {
          if (removeDialog.returnValue === 'remove') {
            operation(status, '正在移除…', async () => {
              await invoke('remove_server', { address: server.address })
              editor.hidden = true
              await load()
              feedback(status, '已移除连接。')
            })
          }
        }, { once: true })
        removeDialog.showModal()
      }),
      button('打开', () => operation(status, '正在连接…', async () => {
        await invoke('connect_server', { address: server.address })
        await load()
        feedback(status)
      }), 'primary'),
    )
    row.append(details, actions)
    return row
  }))
}

async function load() {
  const settings = await invoke('desktop_settings')
  connections = settings.connections
  showServers()
  if (!connections.servers.length) showEditor()
  if (settings.startupError) feedback(status, settings.startupError, true)
}

byId('about-updates').addEventListener('click', () => {
  invoke('open_update_settings').catch(() => feedback(status, '无法打开更新窗口。', true))
})
byId('add-server').addEventListener('click', () => showEditor())
byId('cancel-edit').addEventListener('click', () => {
  editor.hidden = true
  byId('add-server').focus()
})
byId('test-server').addEventListener('click', () => {
  if (!address.reportValidity()) return
  operation(formFeedback, '正在测试连接…', async () => {
    const result = await invoke('check_server', { address: address.value })
    feedback(formFeedback, result.requiresLogin ? '服务器可连接。打开工作台后登录。' : '服务器可连接。')
  })
})
form.addEventListener('input', () => feedback(formFeedback))
form.addEventListener('submit', event => {
  event.preventDefault()
  operation(formFeedback, '正在保存并连接…', async () => {
    const savedAddress = await invoke('save_server', { previous, name: name.value, address: address.value })
    previous = savedAddress
    await load()
    await invoke('connect_server', { address: savedAddress })
    editor.hidden = true
    feedback(formFeedback)
    feedback(status)
    await load()
  })
})

load().catch(() => feedback(status, '无法读取服务器连接，请重新打开应用。', true))
