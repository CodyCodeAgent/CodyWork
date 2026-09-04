<template>
  <div class="quick-settings">
    <aside class="action-list-card">
      <div class="action-list-head"><div><strong>快捷指令</strong><small>{{ actions.length }} 条</small></div><button type="button" class="new-button" @click="selectNew">＋ 新建</button></div>
      <button v-for="action in actions" :key="action.id" type="button" :class="['action-row',{active:selectedId===action.id}]" @click="emit('update:selectedId',action.id)">
        <span class="action-row-copy"><strong>{{ action.name }}</strong><small>{{ action.enabled ? '需求开发' : '已停用' }} · {{ action.skills.length }} Skills</small></span>
        <span v-if="action.missingSkillIds.length" class="invalid-pill">需修复</span><span v-else-if="action.enabled" class="enabled-dot" aria-label="已启用" />
      </button>
      <div v-if="!actions.length" class="action-empty"><span>⌘</span><strong>还没有快捷指令</strong><small>把重复的需求开发步骤变成一键操作。</small></div>
    </aside>

    <form class="action-editor" @submit.prevent="submit">
      <div class="editor-head"><div><div class="kicker">{{ selectedAction ? 'EDIT COMMAND' : 'NEW COMMAND' }}</div><h2>{{ selectedAction ? selectedAction.name : '新建快捷指令' }}</h2></div><label class="enabled-toggle"><input v-model="form.enabled" type="checkbox" /><span>启用</span></label></div>
      <p v-if="selectedAction?.missingSkillIds.length" class="warning" role="alert">配置中的部分 Skill 已失效。重新选择后才能保存和执行。</p>
      <label for="quick-action-name">指令名称</label><input id="quick-action-name" v-model="form.name" class="field" maxlength="80" placeholder="例如：检查实现并补测试" />
      <label for="quick-action-prompt">执行内容</label><textarea id="quick-action-prompt" v-model="form.prompt" class="field prompt-field" maxlength="20000" placeholder="描述点击后要直接发送给 Codex 的完整任务…" />
      <div class="field-label"><label for="quick-action-skill-search">默认 Skills <span>可多选</span></label><small>执行时会作为结构化 Skill 引用发送</small></div>
      <input id="quick-action-skill-search" v-model="skillQuery" class="field skill-search" type="search" placeholder="搜索 Skill…" />
      <div class="skill-picker">
        <label v-for="skill in filteredSkills" :key="skill.id" :class="['skill-option',{disabled:!isSkillAvailable(skill)}]"><input v-model="form.skillIds" type="checkbox" :value="skill.id" :disabled="!isSkillAvailable(skill)" /><span><strong>{{ skill.name }}</strong><small>{{ skill.description || skill.path }}</small></span><em>{{ skill.source }}</em></label>
        <p v-if="!filteredSkills.length" class="no-results">没有匹配的 Skill。</p>
      </div>
      <fieldset><legend>应用场景</legend><label class="scene-option"><input v-model="form.scenes" type="checkbox" value="demand-development" /><span><strong>需求开发</strong><small>显示在 Demand 会话输入框上方</small></span></label></fieldset>
      <p v-if="validationError" class="form-error" role="alert">{{ validationError }}</p><p v-else-if="message" class="success-message" role="status">{{ message }}</p>
      <div class="editor-actions">
        <div><button v-if="selectedAction" type="button" class="delete-button" :disabled="saving" @click="requestDelete">{{ confirmingDelete ? '再点一次确认删除' : '删除指令' }}</button></div>
        <button type="submit" class="save-button" :disabled="saving">{{ saving ? '保存中…' : selectedAction ? '保存修改' : '创建指令' }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { QuickAction, QuickActionInput, WorkspaceSkill } from '../api'

const props = defineProps<{ actions: QuickAction[]; skills: WorkspaceSkill[]; selectedId: string; saving: boolean; message: string }>()
const emit = defineEmits<{ 'update:selectedId':[id:string]; save:[input:QuickActionInput & {id?:string}]; delete:[id:string] }>()
const skillQuery=ref(''); const validationError=ref(''); const confirmingDelete=ref(false)
const form=reactive<QuickActionInput>({name:'',prompt:'',skillIds:[],scenes:['demand-development'],enabled:true})
const selectedAction=computed(()=>props.actions.find(action=>action.id===props.selectedId))
const filteredSkills=computed(()=>{const query=skillQuery.value.trim().toLowerCase();return query?props.skills.filter(skill=>`${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(query)):props.skills})
function isSkillAvailable(skill:WorkspaceSkill):boolean{return skill.status==='available'&&skill.modelInvocable}
function reset(action?:QuickAction):void{form.name=action?.name??'';form.prompt=action?.prompt??'';form.skillIds=[...(action?.skillIds??[])];form.scenes=[...(action?.scenes??['demand-development'])];form.enabled=action?.enabled??true;skillQuery.value='';validationError.value='';confirmingDelete.value=false}
watch(selectedAction,action=>reset(action),{immediate:true})
function selectNew():void{emit('update:selectedId','');reset()}
function submit():void{validationError.value='';if(!form.name.trim()){validationError.value='请输入指令名称。';return}if(!form.prompt.trim()){validationError.value='请输入执行内容。';return}if(!form.scenes.length){validationError.value='至少选择一个应用场景。';return}const unavailable=form.skillIds.filter(id=>!props.skills.some(skill=>skill.id===id&&isSkillAvailable(skill)));if(unavailable.length){validationError.value='有已失效的 Skill，请重新选择。';return}emit('save',{...(selectedAction.value?{id:selectedAction.value.id}:{}),name:form.name.trim(),prompt:form.prompt.trim(),skillIds:[...form.skillIds],scenes:[...form.scenes],enabled:form.enabled})}
function requestDelete():void{if(!selectedAction.value)return;if(!confirmingDelete.value){confirmingDelete.value=true;return}emit('delete',selectedAction.value.id);confirmingDelete.value=false}
</script>

<style scoped>
.quick-settings{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;max-width:1120px;padding:30px 36px 60px;margin:0 auto}.action-list-card,.action-editor{background:#fff;border:1px solid #e3e7ec;border-radius:14px;box-shadow:0 5px 18px rgba(28,38,58,.035)}.action-list-card{align-self:start;overflow:hidden}.action-list-head{display:flex;align-items:center;justify-content:space-between;padding:17px 18px;border-bottom:1px solid #edf0f3}.action-list-head div{display:flex;align-items:baseline;gap:8px}.action-list-head small{color:#9099a7;font-size:10px}.new-button{min-height:44px;padding:7px 12px;color:#315fd0;background:#edf3ff;border:0;border-radius:8px;font-size:11px;font-weight:700}.action-row{display:flex;align-items:center;gap:10px;width:100%;min-height:64px;padding:12px 16px;color:#283244;background:#fff;border:0;border-bottom:1px solid #edf0f3;text-align:left}.action-row:hover,.action-row.active{background:#f5f7ff}.action-row.active{box-shadow:inset 3px 0 #5575e7}.action-row-copy{min-width:0;flex:1}.action-row-copy strong,.action-row-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.action-row-copy small{margin-top:3px;color:#9099a7;font-size:10px}.enabled-dot{width:8px;height:8px;background:#37b77d;border-radius:50%}.invalid-pill{padding:3px 6px;color:#a36819;background:#fff2d4;border-radius:999px;font-size:9px}.action-empty{display:flex;flex-direction:column;align-items:center;padding:45px 24px;color:#8993a3;text-align:center}.action-empty span{font-size:25px}.action-empty strong{margin-top:8px;color:#596474}.action-empty small{margin-top:4px}.action-editor{padding:25px}.editor-head{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:22px}.kicker{color:#8993a3;font-size:9px;font-weight:800;letter-spacing:.15em}.editor-head h2{margin:6px 0 0;font-size:19px}.enabled-toggle{display:flex!important;align-items:center;gap:7px;min-height:44px;padding:0 11px;background:#f4f6f8;border-radius:9px}.action-editor>label,.field-label label{display:block;color:#465160;font-size:11px;font-weight:750}.field-label{display:flex;justify-content:space-between;gap:16px}.field-label span,.field-label small{color:#929cab;font-size:10px;font-weight:500}.field{width:100%;min-height:44px;margin:7px 0 17px;padding:10px 12px;color:#171a22;background:#fff;border:1px solid #cfd6df;border-radius:9px;font:inherit}.field:focus{border-color:#356ff2;outline:3px solid rgba(53,111,242,.12)}.prompt-field{min-height:150px;resize:vertical;line-height:1.65}.skill-search{margin-bottom:8px}.skill-picker{max-height:230px;overflow:auto;border:1px solid #e0e5ec;border-radius:10px}.skill-option{display:flex;align-items:center;gap:10px;min-height:55px;padding:9px 12px;border-bottom:1px solid #edf0f3}.skill-option:last-child{border-bottom:0}.skill-option>span{min-width:0;flex:1}.skill-option strong,.skill-option small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.skill-option strong{font-size:11px}.skill-option small{color:#929cab;font-size:9px}.skill-option em{color:#748299;font-size:9px;font-style:normal}.skill-option.disabled{opacity:.5}.no-results{padding:20px;color:#8993a3;text-align:center}fieldset{padding:14px;margin:18px 0;border:1px solid #e0e5ec;border-radius:10px}legend{padding:0 6px;color:#465160;font-size:11px;font-weight:750}.scene-option{display:flex;align-items:center;gap:10px}.scene-option span{display:block}.scene-option strong,.scene-option small{display:block}.scene-option small{color:#8993a3;font-size:10px}.warning,.form-error,.success-message{padding:10px 12px;border-radius:8px;font-size:11px}.warning,.form-error{color:#9b5e18;background:#fff4dc}.success-message{color:#207b57;background:#eaf8f1}.editor-actions{display:flex;align-items:center;justify-content:space-between;margin-top:22px}.save-button,.delete-button{min-height:44px;padding:8px 15px;border-radius:9px;font-weight:700}.save-button{color:#fff;background:#356ff2;border:1px solid #356ff2}.delete-button{color:#ad4254;background:#fff;border:1px solid #e0b1b9}@media(max-width:900px){.quick-settings{grid-template-columns:1fr;padding:22px}.action-list-card{max-height:270px;overflow:auto}}
.action-list-card,.action-editor,fieldset{min-width:0}
</style>
