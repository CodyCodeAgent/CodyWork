import { createApp } from 'vue'
import App from './App.vue'
import { initializeTheme } from './theme'
import './style.css'
import './responsive.css'
import './mobile-composer.css'
import './parallel.css'
import './themes.css'
import './conversation-theme.css'

const disposeTheme = initializeTheme()
createApp(App).mount('#root')
if (import.meta.hot) import.meta.hot.dispose(disposeTheme)
