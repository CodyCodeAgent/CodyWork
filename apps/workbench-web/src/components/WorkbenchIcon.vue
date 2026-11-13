<template><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="workbench-icon"><path :d="paths[name] || paths.grid" /></svg></template>
<script setup lang="ts">
defineProps<{ name: string }>()
const paths: Record<string, string> = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  book: 'M12 5v15M12 5C8 2 4 3 3 4v15c3-2 6-1 9 1 3-2 6-3 9-1V4c-3-2-6-1-9 1Z',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  bolt: 'm13 2-8 12h6l-1 8 9-12h-6l1-8Z',
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V11.5a8.5 8.5 0 0 1 17 0ZM7 9h9M7 13h6',
  settings: 'm12 3 2 3 3-1 2 3-2 3 2 3-2 3-3-1-2 3-2-3-3 1-2-3 2-3-2-3 2-3 3 1 2-3ZM9 11a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  history: 'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
  plus: 'M12 5v14M5 12h14',
  code: 'm8 6-6 6 6 6M16 6l6 6-6 6m-3-15-2 18',
  columns: 'M3 4h18v16H3zM12 4v16',
  'three-columns': 'M3 4h18v16H3zM9 4v16M15 4v16',
  branch: 'M6 7v10M6 13c8 0 12-2 12-6M4 3h4v4H4zM4 17h4v4H4zM16 3h4v4h-4z',
  expand: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l5 5m13-5-5 5M3 21l5-5m13 5-5-5',
  more: 'M4 11h2v2H4zM11 11h2v2h-2zM18 11h2v2h-2z',
  grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
}
</script>
<style scoped>.workbench-icon{width:18px;height:18px;flex:none;vertical-align:middle}</style>
