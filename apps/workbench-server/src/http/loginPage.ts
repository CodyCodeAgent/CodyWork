import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Presentation only: authentication, redirect and session contracts stay in the HTTP routes. */
export function createLoginPage(staticRoot?: string): (error?: string) => string {
  let palette = ''
  if (staticRoot) {
    try { palette = readFileSync(join(staticRoot, 'theme-tokens.css'), 'utf8') }
    catch { /* API-only/test installations still get a readable default login. */ }
  }
  return (error = '') => `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>CodyWork 登录</title>
<script>
try {
  const theme = localStorage.getItem('codywork.theme');
  document.documentElement.dataset.theme = ['professional','midnight','forest'].includes(theme) ? theme : 'professional';
  document.documentElement.style.colorScheme = theme === 'midnight' ? 'dark' : 'light';
} catch { document.documentElement.dataset.theme = 'professional'; }
</script>
<style>
${palette}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--surface-canvas,#f3f6fa);color:var(--ink-primary,#182b43);font:16px/1.6 var(--font-body,system-ui)}
.card{width:min(100%,420px);padding:32px;border:1px solid var(--border-default,#d8e2ed);border-radius:var(--radius-panel,12px);background:var(--surface-panel,#fff);box-shadow:var(--shadow-panel,0 2px 6px #1c385008)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}.brand-mark{display:grid;place-items:center;width:40px;height:40px;border-radius:var(--radius-control,8px);background:var(--accent,#245bb4);color:var(--on-accent,#fff)}
.brand-mark svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
h1{margin:0;font-size:24px;letter-spacing:-.03em}.brand p{margin:0;font-size:12px}p{color:var(--ink-secondary,#52657b);line-height:1.6}
.error{padding:10px 12px;color:var(--danger,#af3041);background:var(--danger-bg,#fff0f2);border-radius:var(--radius-control,8px);font-size:14px}
label{display:grid;gap:8px;font-size:14px;font-weight:600}input{min-width:0;width:100%;min-height:44px;padding:10px 12px;color:inherit;background:var(--surface-panel,#fff);border:1px solid var(--border-strong,#aebed0);border-radius:var(--radius-control,8px);font:inherit}
button{width:100%;min-height:44px;margin-top:20px;padding:10px 16px;border:1px solid transparent;border-radius:var(--radius-control,8px);background:var(--accent,#245bb4);color:var(--on-accent,#fff);font:inherit;font-weight:600;cursor:pointer}
button:hover{background:var(--accent-hover,#194790)}button:focus-visible,input:focus-visible{outline:3px solid var(--accent,#245bb4);outline-offset:3px}
@media(max-width:480px){.card{padding:24px}body{padding:16px}}
</style></head><body><main class="card">
<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" /></svg></span><div><h1>CodyWork</h1><p>开发工作台</p></div></div>
<p>请输入访问密码以继续。</p>
${error ? '<p class="error" role="alert">密码不正确，请重试。</p>' : ''}
<form method="post" action="/api/auth/login"><label>访问密码<input name="password" type="password" autofocus required autocomplete="current-password"></label><button type="submit">登录</button></form>
</main></body></html>`
}
