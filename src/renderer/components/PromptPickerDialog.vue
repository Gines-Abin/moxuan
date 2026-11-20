<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NInput, NModal, NTag } from 'naive-ui';
import { Check, Flame, Search, Sparkles } from 'lucide-vue-next';
import type { AiScene, PromptTemplate } from '../../shared/models';
import { extractDynamicPromptVariables, extractSystemPromptVariables } from '../../shared/utils/promptVars';
import { usePromptStore } from '../stores/prompts';
import { formatDate } from '../utils/api';

const props = defineProps<{ show: boolean; scene: AiScene; selectedId?: string | null }>();
const emit = defineEmits<{ 'update:show': [boolean]; select: [PromptTemplate] }>();

const store = usePromptStore();
const keyword = ref('');
const scope = ref<'all' | 'mine' | 'builtin'>('all');
const sort = ref<'default' | 'hot' | 'new'>('default');
const pickedId = ref<string | null>(null);

const sceneLabels: Record<AiScene, string> = {
  continue: '续写', polish: '润色', deai: '自然化', outline: '大纲', consistency: '一致性',
};
const sceneTemplates = computed(() => store.templates.filter((template) => template.scene === props.scene));
const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  const list = sceneTemplates.value.filter((template) => {
    if (scope.value === 'mine' && template.isBuiltin) return false;
    if (scope.value === 'builtin' && !template.isBuiltin) return false;
    return !query || `${template.name}${template.description ?? ''}${(template.tags ?? []).join(' ')}${template.content}`.toLowerCase().includes(query);
  });
  return [...list].sort((a, b) => {
    if (sort.value === 'hot') return (b.usageCount ?? 0) - (a.usageCount ?? 0) || b.updatedAt.localeCompare(a.updatedAt);
    if (sort.value === 'new') return b.updatedAt.localeCompare(a.updatedAt);
    return Number(b.isBuiltin) - Number(a.isBuiltin) || (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name);
  });
});
const picked = computed(() => filtered.value.find((template) => template.templateId === pickedId.value) ?? filtered.value[0] ?? null);
const systemVariables = computed(() => (picked.value ? extractSystemPromptVariables(picked.value.content) : []));
const dynamicVariables = computed(() => (picked.value ? extractDynamicPromptVariables(picked.value.content) : []));

function snippet(content: string): string {
  return content.replace(/\s+/g, ' ').slice(0, 90);
}

watch(() => props.show, (visible) => {
  if (!visible) return;
  void store.load();
  keyword.value = '';
  const list = sceneTemplates.value;
  const selected = props.selectedId && list.find((template) => template.templateId === props.selectedId);
  pickedId.value = selected ? selected.templateId : (list.find((template) => template.isBuiltin) ?? list[0])?.templateId ?? null;
});

async function confirm(): Promise<void> {
  if (!picked.value) return;
  await store.markUsed(picked.value.templateId);
  emit('select', picked.value);
  emit('update:show', false);
}
</script>

<template>
  <n-modal :show="show" preset="card" title="选择提示词" class="prompt-picker" :mask-closable="true" @update:show="emit('update:show', $event)">
    <div class="picker-toolbar">
      <n-input v-model:value="keyword" clearable placeholder="搜索标题或内容，例如：续写、快节奏、强冲突">
        <template #prefix><search :size="14" /></template>
      </n-input>
      <div class="picker-switches">
        <div class="picker-group"><button :class="{ active: scope === 'all' }" @click="scope = 'all'">全部</button><button :class="{ active: scope === 'mine' }" @click="scope = 'mine'">我的</button><button :class="{ active: scope === 'builtin' }" @click="scope = 'builtin'">系统</button></div>
        <div class="picker-group"><button :class="{ active: sort === 'default' }" @click="sort = 'default'">默认</button><button :class="{ active: sort === 'hot' }" @click="sort = 'hot'"><flame :size="11" />热门</button><button :class="{ active: sort === 'new' }" @click="sort = 'new'">最新</button></div>
      </div>
    </div>

    <div v-if="filtered.length" class="picker-body">
      <div class="picker-list">
        <button v-for="template in filtered" :key="template.templateId" type="button" class="picker-card" :class="{ active: picked?.templateId === template.templateId }" @click="pickedId = template.templateId">
          <div class="picker-card-head"><strong>{{ template.name }}</strong><check v-if="picked?.templateId === template.templateId" :size="14" class="picked-check" /></div>
          <p>{{ snippet(template.content) }}</p>
          <div class="picker-card-meta">
            <n-tag size="small" :bordered="false" :type="template.isBuiltin ? 'default' : 'info'">{{ template.isBuiltin ? '系统默认' : '我的' }}</n-tag>
            <span>待填 {{ extractDynamicPromptVariables(template.content).length }}</span>
            <span v-if="template.usageCount">使用 {{ template.usageCount }} 次</span>
            <span>{{ formatDate(template.updatedAt) }}</span>
          </div>
        </button>
      </div>

      <aside class="picker-preview">
        <span class="preview-eyebrow"><sparkles :size="12" />{{ sceneLabels[scene] }}提示词预览</span>
        <h3>{{ picked?.name }}</h3>
        <div class="preview-tags"><n-tag size="small" :bordered="false" :type="picked?.isBuiltin ? 'default' : 'info'">{{ picked?.isBuiltin ? '系统默认' : '我的模板' }}</n-tag><span v-if="picked?.usageCount">已使用 {{ picked.usageCount }} 次</span></div>
        <pre class="preview-content">{{ picked?.content }}</pre>
        <div v-if="systemVariables.length" class="preview-vars"><span>自动填充 {{ systemVariables.length }}</span><code v-for="name in systemVariables" :key="name">{{ name }}</code></div>
        <div v-if="dynamicVariables.length" class="preview-vars"><span class="needs-input">使用时填写 {{ dynamicVariables.length }}</span><code v-for="name in dynamicVariables" :key="name">{{ name }}</code></div>
        <p class="preview-note">系统变量由当前作品、章节与设定自动填充；自定义参数在选择后到右侧助手填写，留空会按空值生成。想稳定先用“系统默认”，想更快出结果可在热门里挑描述最接近需求的。</p>
      </aside>
    </div>

    <div v-else class="picker-empty">
      <sparkles :size="26" />
      <strong>没有匹配的提示词</strong>
      <p>换个关键词，或把范围切回“全部”；也可以先到提示词库创建一条{{ sceneLabels[scene] }}模板。</p>
    </div>

    <template #footer>
      <div class="picker-footer"><span>共 {{ filtered.length }} 条{{ sceneLabels[scene] }}提示词</span><div><n-button @click="emit('update:show', false)">取消</n-button><n-button type="primary" :disabled="!picked" @click="confirm">确认选择</n-button></div></div>
    </template>
  </n-modal>
</template>

<style scoped>
.prompt-picker { width: 880px; max-width: 94vw; }
.picker-toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.picker-switches { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.picker-group { display: flex; gap: 3px; padding: 3px; background: #f3f6f1; border-radius: 7px; }
.picker-group button { display: flex; align-items: center; gap: 4px; padding: 5px 11px; color: #7d8e83; font-size: 10px; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }
.picker-group button.active { color: #2d6754; background: #fff; box-shadow: 0 1px 4px rgba(43,72,56,.08); }
.picker-body { display: grid; grid-template-columns: 1.08fr .92fr; gap: 14px; }
.picker-list { display: flex; flex-direction: column; gap: 8px; max-height: 52vh; padding-right: 4px; overflow-y: auto; }
.picker-card { padding: 12px 13px; text-align: left; cursor: pointer; background: #fbfcfa; border: 1px solid #e6ece5; border-radius: 9px; transition: border-color .15s, background .15s; }
.picker-card:hover { background: #f7faf6; border-color: #cddbd0; }
.picker-card.active { background: #f2f8f2; border-color: #82a993; box-shadow: inset 0 0 0 1px #b7cfbd; }
.picker-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.picker-card-head strong { overflow: hidden; color: #335045; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.picked-check { flex: 0 0 auto; color: #4e836b; }
.picker-card p { display: -webkit-box; margin: 6px 0 8px; overflow: hidden; color: #8a988f; font-size: 10px; line-height: 1.7; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.picker-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: #a0aba4; font-size: 9px; }
.picker-preview { display: flex; flex-direction: column; min-height: 320px; padding: 15px; background: #f8faf6; border: 1px solid #e7eee6; border-radius: 10px; }
.preview-eyebrow { display: flex; align-items: center; gap: 5px; color: #7f9788; font-size: 9px; letter-spacing: .04em; }
.picker-preview h3 { margin: 8px 0 7px; color: #31503f; font-size: 14px; }
.preview-tags { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; color: #96a29a; font-size: 9px; }
.preview-content { flex: 1; max-height: 30vh; padding: 11px 12px; margin: 0; overflow-y: auto; color: #5f7268; font-family: inherit; font-size: 10px; line-height: 1.85; white-space: pre-wrap; background: #fff; border: 1px solid #e9efe8; border-radius: 7px; }
.preview-vars { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 9px; color: #8e9c93; font-size: 9px; }
.preview-vars code { padding: 2px 6px; color: #4f7561; background: #eaf2ec; border-radius: 4px; font-size: 9px; }.preview-vars .needs-input { color: #a9773f; }.preview-vars .needs-input ~ code { color: #8c6234; background: #f7efe2; }
.preview-note { margin: 9px 0 0; color: #9ba69f; font-size: 9px; line-height: 1.7; }
.picker-empty { display: flex; min-height: 260px; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: #9aa9a0; background: #fafbf9; border: 1px dashed #dbe4da; border-radius: 10px; }
.picker-empty strong { color: #52695c; font-size: 12px; }
.picker-empty p { max-width: 330px; margin: 0; font-size: 10px; line-height: 1.7; text-align: center; }
.picker-footer { display: flex; align-items: center; justify-content: space-between; }
.picker-footer > span { color: #9aa69e; font-size: 10px; }
.picker-footer > div { display: flex; gap: 8px; }
</style>
