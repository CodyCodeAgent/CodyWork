<script setup lang="ts">
import { currentTheme, setTheme, themeOptions } from '../theme'
</script>

<template>
  <section class="theme-preferences" aria-labelledby="theme-preferences-title">
    <div class="theme-preferences-heading"><div><span class="eyebrow">PERSONALIZE</span><h2 id="theme-preferences-title">工作台外观</h2></div><p>选择适合你的工作氛围，自动保存在当前浏览器。</p></div>
    <div class="theme-options" role="group" aria-label="工作台主题">
      <button v-for="option in themeOptions" :key="option.id" type="button" class="theme-option" :data-preview="option.id" :aria-pressed="currentTheme === option.id" @click="setTheme(option.id)">
        <span class="theme-preview" aria-hidden="true"><i /><span><b /><b /><b /></span></span>
        <span class="theme-option-title">{{ option.label }}<span v-if="currentTheme === option.id">✓ 已选择</span></span>
        <small>{{ option.description }}</small>
      </button>
    </div>
  </section>
</template>
