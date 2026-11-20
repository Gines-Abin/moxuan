<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton, NInput, NInputNumber, NModal, NSelect, NSpin, NTag, NTooltip,
} from 'naive-ui';
import {
  Braces, CheckCircle2, Download, LibraryBig, Lock, Pencil, Play, Plus,
  Trash2, Upload,
} from 'lucide-vue-next';
import type { AiScene, PromptTemplate } from '../../shared/models';
import { extractDynamicPromptVariables } from '../../shared/utils/promptVars';
import { useAppStore } from '../stores/app';
import { usePromptStore } from '../stores/prompts';
import { dialog, formatDate, message, reportError, unwrap } from '../utils/api';

const store = usePromptStore();
const appStore = useAppStore();
const router = useRouter();
const filter = ref<'all' | AiScene>('all');
const showEditor = ref(false);
const saving = ref(false);
const editing = ref<PromptTemplate | null>(null);
const importing = ref(false);
const lastExportPath = ref('');
const form = reactive<{ name: string; scene: AiScene; content: string; description: string; tags: string; temperature: number; maxTokens: number }>({ name: '', scene: 'continue', content: '', description: '', tags: '', temperature: 0.7, maxTokens: 2048 });
const showUse = ref(false);
const useTemplate = ref<PromptTemplate | null>(null);
const useWorkId = ref<string | null>(null);
const useBusy = ref(false);
const workOptions = computed(() => appStore.works
  .filter((work) => !work.deletedAt && work.status === 'active')
  .map((work) => ({ label: work.title, value: work.workId })));
const sceneMeta: Record<AiScene, { label: string; short: string; description: string }> = {
  continue: { label: '续写', short: '续写正文', description: '顺着既有情节与文风延展章节' },
  polish: { label: '润色', short: '润色文字', description: '改善表达、节奏与文字质感' },
  deai: { label: '自然化', short: '自然化改写', description: '减少模板感，让表达更自然' },
  outline: { label: '大纲', short: '大纲构思', description: '辅助梳理卷章与故事节点' },
  consistency: { label: '一致性', short: '一致性检查', description: '对照设定发现正文细节冲突' },
};
const sceneOptions = Object.entries(sceneMeta).map(([value, meta]) => ({ label: meta.short, value }));
const filtered = computed(() => store.templates.filter((template) => filter.value === 'all' || template.scene === filter.value));
const customCount = computed(() => store.templates.filter((template) => !template.isBuiltin).length);

onMounted(() => { void store.load(); });

function openCreate(scene?: AiScene): void {
  editing.value = null;
  Object.assign(form, { name: '', scene: scene || (filter.value === 'all' ? 'continue' : filter.value), content: '', description: '', tags: '', temperature: 0.7, maxTokens: 2048 });
  showEditor.value = true;
}

function openEdit(template: PromptTemplate): void {
  editing.value = template;
  Object.assign(form, {
    name: template.name, scene: template.scene, content: template.content,
    description: template.description ?? '', tags: (template.tags ?? []).join('，'),
    temperature: template.temperature ?? 0.7, maxTokens: template.maxTokens ?? 2048,
  });
  showEditor.value = true;
}

async function save(): Promise<void> {
  if (!form.name.trim()) { message.warning('请输入模板名称'); return; }
  if (!form.content.trim()) { message.warning('提示词内容不能为空'); return; }
  saving.value = true;
  const result = await store.save({
    templateId: editing.value?.templateId, name: form.name.trim(), scene: form.scene,
    content: form.content.trim(), description: form.description.trim() || undefined,
    tags: form.tags.split(/[,，\s]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 8),
    temperature: form.temperature, maxTokens: form.maxTokens,
  });
  saving.value = false;
  if (result) { showEditor.value = false; message.success(editing.value ? '模板已更新' : '自定义模板已创建'); }
}

function remove(template: PromptTemplate): void {
  if (template.isBuiltin) { message.info('内置模板不可删除，你可以复制内容后创建自定义模板'); return; }
  dialog.warning({
    title: `删除模板“${template.name}”？`,
    content: '删除后，章节编辑器将不再显示此模板。已有正文不会受到影响。',
    positiveText: '确认删除', negativeText: '取消',
    onPositiveClick: async () => { if (await store.remove(template.templateId)) message.success('模板已删除'); },
  });
}

async function importJson(): Promise<void> {
  importing.value = true;
  const imported = await store.importTemplates();
  importing.value = false;
  if (imported) message.success('提示词模板已导入');
}

async function exportJson(): Promise<void> {
  const path = await store.exportTemplates();
  if (path) { lastExportPath.value = path; message.success('模板已导出为 JSON 文件'); }
}

function openUse(template: PromptTemplate): void {
  if (!['continue', 'polish', 'deai'].includes(template.scene)) {
    message.info('大纲与一致性模板请在对应页面内使用');
    return;
  }
  useTemplate.value = template;
  useWorkId.value = null;
  showUse.value = true;
  void appStore.loadWorks().then(() => {
    useWorkId.value = workOptions.value[0]?.value ?? null;
  });
}

async function confirmUse(): Promise<void> {
  if (!useTemplate.value || !useWorkId.value || useBusy.value) return;
  useBusy.value = true;
  try {
    const chapters = unwrap(await window.inkforge.chapter.list(useWorkId.value));
    const latest = [...chapters].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!latest) {
      message.warning('这部作品还没有章节，请先在大纲中创建章节');
      return;
    }
    await store.markUsed(useTemplate.value.templateId);
    showUse.value = false;
    await router.push({ path: `/work/${useWorkId.value}/chapter/${latest.chapterId}`, query: { prompt: useTemplate.value.templateId } });
  } catch (error) {
    reportError(error);
  } finally {
    useBusy.value = false;
  }
}
</script>

<template>
  <div class="page prompts-page">
    <div class="page-header"><div><h2>提示词库</h2><p>把有效的写作方法沉淀为模板，在不同章节中重复使用。</p></div><div class="header-actions"><n-button secondary :loading="importing" @click="importJson"><template #icon><upload :size="15" /></template>导入 JSON</n-button><n-button secondary :disabled="!store.templates.length" @click="exportJson"><template #icon><download :size="15" /></template>导出 JSON</n-button><n-button type="primary" @click="openCreate()"><template #icon><plus :size="16" /></template>新建模板</n-button></div></div>
    <div class="prompt-overview paper-card"><div class="prompt-overview-icon"><library-big :size="24" /></div><div><strong>让 AI 更懂你的写作意图</strong><p>模板可为不同任务定义指令、温度与输出长度。内置模板提供基础能力，自定义模板更贴近你的个人方法。</p></div><div class="prompt-count"><span>{{ store.templates.length }}</span><small>全部模板</small></div><i /><div class="prompt-count"><span>{{ customCount }}</span><small>我的模板</small></div></div>
    <div v-if="lastExportPath" class="export-path"><check-circle2 :size="15" /><span>最近导出：</span><code>{{ lastExportPath }}</code><button @click="lastExportPath = ''">关闭</button></div>
    <div class="prompt-filters"><button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部场景<span>{{ store.templates.length }}</span></button><button v-for="(meta, scene) in sceneMeta" :key="scene" :class="{ active: filter === scene }" @click="filter = scene">{{ meta.short }}<span>{{ store.templates.filter(t => t.scene === scene).length }}</span></button></div>
    <n-spin :show="store.loading">
      <div v-if="filtered.length" class="prompt-grid">
        <article v-for="template in filtered" :key="template.templateId" class="prompt-card paper-card">
          <div class="prompt-card-head"><n-tag size="small" :type="template.scene === 'continue' ? 'success' : template.scene === 'deai' ? 'warning' : 'default'" :bordered="false">{{ sceneMeta[template.scene].short }}</n-tag><n-tag v-if="template.isBuiltin" size="small" :bordered="false" class="builtin-tag"><template #icon><lock :size="10" /></template>系统默认</n-tag><n-tag v-else size="small" type="info" :bordered="false">我的</n-tag></div>
          <h3>{{ template.name }}</h3><p class="scene-description">{{ template.description || sceneMeta[template.scene].description }}</p><div v-if="template.tags?.length" class="prompt-tags"><span v-for="tag in template.tags" :key="tag">{{ tag }}</span></div><div class="prompt-content">{{ template.content }}</div>
          <div class="prompt-params"><span>待填 <strong>{{ extractDynamicPromptVariables(template.content).length }}</strong></span><i /><span>温度 <strong>{{ template.temperature ?? '默认' }}</strong></span><i /><span>使用 <strong>{{ template.usageCount ?? 0 }}</strong> 次</span></div>
          <div class="prompt-card-footer"><span>{{ formatDate(template.updatedAt) }}</span><div><n-tooltip><template #trigger><button class="use-button" aria-label="使用模板" @click="openUse(template)"><play :size="13" /></button></template>使用模板</n-tooltip><n-tooltip><template #trigger><button @click="openEdit(template)"><pencil :size="14" /></button></template>编辑模板</n-tooltip><n-tooltip><template #trigger><button :disabled="template.isBuiltin" :class="{ danger: !template.isBuiltin }" @click="remove(template)"><trash2 :size="14" /></button></template>{{ template.isBuiltin ? '内置模板不可删除' : '删除模板' }}</n-tooltip></div></div>
        </article>
        <button class="new-prompt-card" @click="openCreate()"><plus :size="24" /><strong>创建自定义模板</strong><span>沉淀你的写作方法</span></button>
      </div>
      <div v-else class="paper-card empty-wrap"><div class="empty-icon"><braces :size="28" /></div><h3>{{ filter === 'all' ? '还没有提示词模板' : `暂无${sceneMeta[filter].short}模板` }}</h3><p>{{ filter === 'all' ? '创建一个模板，写下清晰的任务目标、风格要求和输出约束。' : '可以切回“全部场景”查看其他分类，或为当前场景新建一条模板。' }}</p><n-button type="primary" @click="openCreate()"><template #icon><plus :size="15" /></template>新建模板</n-button></div>
    </n-spin>
    <n-modal v-model:show="showEditor" preset="card" :title="editing ? '编辑提示词模板' : '新建提示词模板'" class="prompt-modal" :mask-closable="!saving">
      <div class="prompt-form-row"><div><label class="form-label required">模板名称</label><n-input v-model:value="form.name" maxlength="100" placeholder="例如：细腻场景续写" /></div><div><label class="form-label required">使用场景</label><n-select v-model:value="form.scene" :options="sceneOptions" /></div></div>
      <div class="prompt-form-row field-gap"><div><label class="form-label">模板描述</label><n-input v-model:value="form.description" maxlength="200" placeholder="适用：第 N 章续写；不适用：从 0 开篇" /></div><div><label class="form-label">标签</label><n-input v-model:value="form.tags" maxlength="100" placeholder="都市，爽文，快节奏（逗号分隔）" /></div></div>
      <label class="form-label required field-gap">提示词内容</label><n-input v-model:value="form.content" type="textarea" :rows="10" maxlength="20000" show-count placeholder="写明任务目标、需要遵循的风格与限制、期望的输出结构。正文与设定卡会由墨轩按任务自动提供……" /><p class="form-tip">用 <code v-pre>{{workTitle}}</code> 这类系统变量引用作品资料；用 <code v-pre>{{文风偏好}}</code> 这类自定义变量做使用时填写的参数；用 <code v-pre>@设定-角色-沈砚</code> 单独一行引用本作品的同名设定卡，未命中会写成“待补全”。</p>
      <div class="prompt-form-row field-gap"><div><label class="form-label">温度</label><n-input-number v-model:value="form.temperature" :min="0" :max="2" :step="0.1" :precision="1" /></div><div><label class="form-label">最大输出 Tokens</label><n-input-number v-model:value="form.maxTokens" :min="128" :max="32768" :step="256" /></div></div>
      <div class="modal-footer"><n-button @click="showEditor = false">取消</n-button><n-button type="primary" :loading="saving" @click="save">保存模板</n-button></div>
    </n-modal>
    <n-modal v-model:show="showUse" preset="card" title="使用提示词" class="use-modal">
      <p class="use-hint">选择作品后会打开最近编辑的章节，并在 AI 助手中预选「{{ useTemplate?.name }}」。</p>
      <label class="form-label required">作品</label>
      <n-select v-model:value="useWorkId" :options="workOptions" filterable placeholder="选择要写入的作品" />
      <p v-if="!workOptions.length" class="form-tip">还没有可用的作品，请先在工作台新建作品或恢复归档作品。</p>
      <div class="modal-footer"><n-button @click="showUse = false">取消</n-button><n-button type="primary" :loading="useBusy" :disabled="!useWorkId" @click="confirmUse">打开章节</n-button></div>
    </n-modal>
  </div>
</template>

<style scoped>
.prompt-overview { display: flex; align-items: center; gap: 14px; padding: 18px 21px; margin-bottom: 18px; background: linear-gradient(110deg,#f8faf6,#eef4ee); }.prompt-overview-icon { display: grid; width: 45px; height: 46px; place-items: center; color: #5a806d; background: #e3eee5; border-radius: 10px; }.prompt-overview > div:nth-child(2) { flex: 1; }.prompt-overview strong { color: #3b574a; font-size: 13px; }.prompt-overview p { margin: 5px 0 0; color: #829087; font-size: 10px; line-height: 1.7; }.prompt-overview > i { width: 1px; height: 28px; margin: 0 9px; background: #dae4db; }.prompt-count { min-width: 55px; text-align: center; }.prompt-count span,.prompt-count small { display: block; }.prompt-count span { color: #3d5c4e; font-size: 21px; font-weight: 600; }.prompt-count small { margin-top: 2px; color: #95a198; font-size: 9px; }.export-path { display: flex; align-items: center; gap: 6px; padding: 9px 12px; margin-bottom: 15px; color: #4e7a65; background: #edf5ee; border: 1px solid #dce9de; border-radius: 7px; font-size: 10px; }.export-path code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.export-path button { color: #6b8777; cursor: pointer; background: none; border: 0; }.prompt-filters { display: flex; gap: 5px; margin-bottom: 15px; }.prompt-filters button { display: flex; align-items: center; gap: 7px; padding: 8px 12px; color: #7c8d83; cursor: pointer; background: transparent; border: 1px solid transparent; border-radius: 7px; font-size: 11px; }.prompt-filters button span { color: #a0aaa4; font-size: 9px; }.prompt-filters button.active { color: #2d6754; background: #fff; border-color: #dce6dd; box-shadow: 0 2px 5px rgba(40,70,53,.03); }.prompt-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 14px; }.prompt-card { display: flex; min-height: 290px; flex-direction: column; padding: 17px; }.prompt-card-head { display: flex; gap: 6px; }.builtin-tag { color: #7d8981; background: #f0f2ef; }.prompt-card h3 { margin: 14px 0 5px; color: #354e42; font-size: 14px; font-weight: 600; }.scene-description { margin: 0 0 12px; color: #94a097; font-size: 9px; }.prompt-content { display: -webkit-box; min-height: 69px; overflow: hidden; color: #74847a; font-size: 10px; line-height: 1.8; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }.prompt-params { display: flex; align-items: center; gap: 11px; padding: 10px 0; margin-top: 12px; color: #96a199; border-top: 1px solid #edf0ec; font-size: 9px; }.prompt-params strong { margin-left: 3px; color: #6a7d71; font-weight: 500; }.prompt-params i { width: 1px; height: 9px; background: #dfe5df; }.prompt-card-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 9px; margin-top: auto; }.prompt-card-footer > span { color: #abb4ae; font-size: 8px; }.prompt-card-footer > div { display: flex; gap: 3px; }.prompt-card-footer button { display: grid; width: 27px; height: 26px; place-items: center; color: #7f8f85; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.prompt-card-footer button:hover { color: #2f6b55; background: #edf3ee; }.prompt-card-footer button.danger:hover { color: #b54f49; background: #fbefed; }.prompt-card-footer button:disabled { color: #c1c8c2; cursor: not-allowed; background: transparent; }.new-prompt-card { display: flex; min-height: 290px; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: #8ca294; cursor: pointer; background: rgba(255,255,255,.35); border: 1px dashed #c9d5cb; border-radius: 12px; }.new-prompt-card:hover { color: #3c735e; background: #f9fbf7; border-color: #96b09f; }.new-prompt-card strong { margin-top: 3px; font-size: 12px; }.new-prompt-card span { color: #a0aca4; font-size: 9px; }.prompt-modal { width: 650px; }.prompt-form-row { display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; }.prompt-form-row .n-input-number { width: 100%; }.field-gap { margin-top: 17px; }
.prompt-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: -5px 0 10px; }.prompt-tags span { padding: 2px 6px; color: #6d8b79; background: #eef4ee; border-radius: 4px; font-size: 8px; }.prompt-card-footer button.use-button { color: #3f7a61; }.prompt-card-footer button.use-button:hover { color: #fff; background: #4e836b; }.use-modal { width: 430px; }.use-hint { margin: 0 0 16px; color: #7d8f83; font-size: 10px; line-height: 1.7; }
@media(max-width:1250px){.prompt-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.prompt-overview p{max-width:520px;}}
</style>
