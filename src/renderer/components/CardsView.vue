<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  NButton, NDrawer, NDrawerContent, NDynamicTags, NInput, NModal, NSelect, NSwitch, NTag, NTooltip,
} from 'naive-ui';
import {
  Archive, ArchiveRestore, BookA, FileStack, Gem, GitBranch, Globe2, Link2, Pencil, Pin, Plus, Search, Trash2, UserRound,
} from 'lucide-vue-next';
import type { Card, CardType } from '../../shared/models';
import { cardReferenceKey } from '../../shared/utils/cardReferences';
import { parseCardImport } from '../../shared/utils/cardImport';
import {
  CHARACTER_FIELDS, emptyCharacterFields, parseCharacterContent, serializeCharacterContent, type CharacterFields,
} from '../../shared/utils/characterCard';
import { useAppStore } from '../stores/app';
import { copyText, dialog, message } from '../utils/api';

const props = defineProps<{ show: boolean; workId: string }>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });
const filter = ref<'all' | CardType>('all');
const keyword = ref('');
const showDeprecated = ref(false);
const showEditor = ref(false);
const saving = ref(false);
const showImport = ref(false);
const importType = ref<CardType>('character');
const importText = ref('');
const importing = ref(false);
const importItems = computed(() => parseCardImport(importText.value));
const editingId = ref<string | null>(null);
const form = reactive<{ type: CardType; title: string; content: string; tags: string[]; pinned: boolean }>({ type: 'character', title: '', content: '', tags: [], pinned: false });
const characterFields = reactive<CharacterFields>(emptyCharacterFields());
const isCharacterForm = computed(() => form.type === 'character');
watch(() => form.type, (type) => {
  if (type === 'character' && !CHARACTER_FIELDS.some((field) => characterFields[field].trim())) {
    Object.assign(characterFields, parseCharacterContent(form.content));
  }
});
const typeMeta: Record<CardType, { label: string; icon: unknown; description: string }> = {
  character: { label: '角色', icon: UserRound, description: '外貌、性格、关系与人物弧光' },
  world: { label: '世界观', icon: Globe2, description: '时代、地域、规则与社会背景' },
  plot: { label: '情节', icon: GitBranch, description: '主线、伏笔、冲突与故事节点' },
  item: { label: '道具', icon: Gem, description: '关键物品、能力与归属变化' },
  term: { label: '术语', icon: BookA, description: '专有名词、概念与统一译法' },
};
const typeOptions = Object.entries(typeMeta).map(([value, meta]) => ({ label: meta.label, value }));
const filteredCards = computed(() => store.cards.filter((card) => {
  if (card.deletedAt) return false;
  if (card.deprecatedAt && !showDeprecated.value) return false;
  if (filter.value !== 'all' && card.type !== filter.value) return false;
  const query = keyword.value.trim().toLowerCase();
  return !query || `${card.title}${card.content}${card.tags.join('')}`.toLowerCase().includes(query);
}));
const activeCards = computed(() => store.cards.filter((card) => !card.deletedAt && !card.deprecatedAt));
const deprecatedCount = computed(() => store.cards.filter((card) => !card.deletedAt && card.deprecatedAt).length);
const counts = computed(() => Object.fromEntries(Object.keys(typeMeta).map((type) => [type, activeCards.value.filter((card) => card.type === type).length])));

function openCreate(type?: CardType): void {
  editingId.value = null;
  Object.assign(form, { type: type || (filter.value === 'all' ? 'character' : filter.value), title: '', content: '', tags: [], pinned: false });
  Object.assign(characterFields, emptyCharacterFields());
  showEditor.value = true;
}

function openEdit(card: Card): void {
  editingId.value = card.cardId;
  Object.assign(form, { type: card.type, title: card.title, content: card.content, tags: [...card.tags], pinned: card.pinned });
  Object.assign(characterFields, card.type === 'character' ? parseCharacterContent(card.content) : emptyCharacterFields());
  showEditor.value = true;
}

async function save(): Promise<void> {
  if (!form.title.trim()) { message.warning('请填写设定卡名称'); return; }
  const content = isCharacterForm.value ? serializeCharacterContent(characterFields) : form.content.trim();
  if (!content) {
    message.warning(isCharacterForm.value ? '请至少填写一个角色字段' : '请填写设定内容，帮助 AI 准确理解');
    return;
  }
  saving.value = true;
  const card = await store.saveCard({
    cardId: editingId.value || undefined, workId: props.workId, type: form.type,
    title: form.title.trim(), content, tags: form.tags, pinned: form.pinned,
  });
  saving.value = false;
  if (card) { showEditor.value = false; message.success(editingId.value ? '设定卡已更新' : '设定卡已创建'); }
}

function openImport(): void {
  importType.value = filter.value === 'all' ? 'character' : filter.value;
  importText.value = '';
  showImport.value = true;
}

async function batchImport(): Promise<void> {
  if (!importItems.value.length) { message.warning('未识别到可导入的设定卡'); return; }
  importing.value = true;
  const created = await store.batchCreateCards({ workId: props.workId, type: importType.value, items: importItems.value });
  importing.value = false;
  if (!created) return;
  showImport.value = false;
  importText.value = '';
  message.success(`已导入 ${created.length} 张设定卡`);
}

async function togglePin(card: Card): Promise<void> {
  const result = await store.saveCard({ ...card, pinned: !card.pinned });
  if (result) message.success(result.pinned ? '已置顶，将作为 AI 默认参考设定' : '已取消置顶注入');
}

async function toggleDeprecated(card: Card): Promise<void> {
  const result = await store.saveCard({ ...card, deprecatedAt: card.deprecatedAt ? null : new Date().toISOString() });
  if (result) {
    message.success(result.deprecatedAt ? '已弃用，AI 将不再引用这张设定卡' : '设定卡已恢复启用');
  }
}

async function copyReference(card: Card): Promise<void> {
  const key = cardReferenceKey(card);
  await copyText(key);
  message.success(`已复制引用 ${key}`);
}

function remove(card: Card): void {
  dialog.warning({
    title: `删除设定卡“${card.title}”？`,
    content: '删除后将不再用于 AI 上下文注入，此操作需要谨慎确认。',
    positiveText: '确认删除', negativeText: '取消',
    onPositiveClick: async () => { if (await store.deleteCard(props.workId, card.cardId)) message.success('设定卡已删除'); },
  });
}
</script>

<template>
  <n-drawer v-model:show="visible" :width="720" placement="right">
    <n-drawer-content closable>
      <template #header><div class="cards-title"><file-stack :size="19" /><span>作品设定库</span><small>{{ activeCards.length }} 张设定卡</small></div></template>
      <div class="cards-intro">把稳定的事实交给设定卡。置顶卡片会优先用于 AI 写作上下文，让角色与世界规则始终一致。</div>
      <div class="cards-toolbar">
        <n-input v-model:value="keyword" size="small" clearable placeholder="搜索设定内容或标签"><template #prefix><search :size="15" /></template></n-input>
        <n-button size="small" @click="openImport"><template #icon><file-stack :size="15" /></template>批量导入</n-button>
        <n-button type="primary" size="small" @click="openCreate()"><template #icon><plus :size="15" /></template>新建设定卡</n-button>
      </div>
      <div class="card-filters">
        <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部 <span>{{ activeCards.length }}</span></button>
        <button v-for="(meta, type) in typeMeta" :key="type" :class="{ active: filter === type }" @click="filter = type"><component :is="meta.icon" :size="14" />{{ meta.label }}<span>{{ counts[type] }}</span></button>
        <button class="deprecated-toggle" :class="{ active: showDeprecated }" @click="showDeprecated = !showDeprecated"><archive :size="13" />{{ showDeprecated ? '隐藏弃用' : '显示弃用' }}<span v-if="deprecatedCount">{{ deprecatedCount }}</span></button>
      </div>
      <div v-if="filteredCards.length" class="cards-list">
        <article v-for="card in filteredCards" :key="card.cardId" class="setting-card" :class="{ pinned: card.pinned, deprecated: card.deprecatedAt }">
          <div class="setting-card-head"><div class="setting-type"><component :is="typeMeta[card.type].icon" :size="16" /><span>{{ typeMeta[card.type].label }}</span></div><n-tag v-if="card.deprecatedAt" size="small" type="warning" :bordered="false"><template #icon><archive :size="11" /></template>已弃用</n-tag><n-tag v-if="card.pinned" size="small" type="success" :bordered="false"><template #icon><pin :size="11" /></template>置顶注入</n-tag></div>
          <h3>{{ card.title }}</h3><p>{{ card.content }}</p>
          <div v-if="card.tags.length" class="setting-tags"><span v-for="tag in card.tags" :key="tag"># {{ tag }}</span></div>
          <div class="setting-card-footer"><span>{{ card.content.length }} 字</span><div><n-tooltip><template #trigger><button :class="{ active: card.pinned }" :aria-label="card.pinned ? '取消置顶' : '置顶注入'" @click="togglePin(card)"><pin :size="14" /></button></template>{{ card.pinned ? '取消置顶' : '置顶注入' }}</n-tooltip><n-tooltip><template #trigger><button :aria-label="`复制引用 ${cardReferenceKey(card)}`" @click="copyReference(card)"><link2 :size="14" /></button></template>复制提示词引用</n-tooltip><n-tooltip><template #trigger><button :class="{ active: card.deprecatedAt }" :aria-label="card.deprecatedAt ? '恢复启用' : '弃用'" @click="toggleDeprecated(card)"><archive-restore v-if="card.deprecatedAt" :size="14" /><archive v-else :size="14" /></button></template>{{ card.deprecatedAt ? '恢复启用' : '弃用（不再注入 AI）' }}</n-tooltip><n-tooltip><template #trigger><button aria-label="编辑设定卡" @click="openEdit(card)"><pencil :size="14" /></button></template>编辑</n-tooltip><n-tooltip><template #trigger><button class="danger" aria-label="删除设定卡" @click="remove(card)"><trash2 :size="14" /></button></template>删除</n-tooltip></div></div>
        </article>
      </div>
      <div v-else class="empty-wrap"><div class="empty-icon"><file-stack :size="27" /></div><h3>{{ keyword ? '没有匹配的设定卡' : '为故事建立第一张设定卡' }}</h3><p>{{ keyword ? '换个关键词，或切换设定类型再试试。' : '记录角色小传、世界规则、重要伏笔。AI 生成时可以选择这些设定作为可靠参考。' }}</p><n-button v-if="!keyword" type="primary" @click="openCreate()"><template #icon><plus :size="15" /></template>新建设定卡</n-button><n-button v-else @click="keyword = ''; filter = 'all'">清除筛选</n-button></div>
      <template #footer><div class="drawer-note"><pin :size="13" />当前 {{ store.pinnedCards.length }} 张卡片已置顶注入<span v-if="deprecatedCount"> · {{ deprecatedCount }} 张已弃用</span></div></template>
    </n-drawer-content>
  </n-drawer>

  <n-modal v-model:show="showEditor" preset="card" :title="editingId ? '编辑设定卡' : '新建设定卡'" class="card-editor-modal" :mask-closable="!saving">
    <div class="card-form-row"><div><label class="form-label required">设定类型</label><n-select v-model:value="form.type" :options="typeOptions" /></div><div class="pin-field"><label class="form-label">AI 上下文</label><n-switch v-model:value="form.pinned"><template #checked>置顶注入</template><template #unchecked>按需选择</template></n-switch></div></div>
    <p class="form-tip type-description">{{ typeMeta[form.type].description }}</p>
    <label class="form-label required field-gap">设定名称</label><n-input v-model:value="form.title" maxlength="100" placeholder="例如：沈砚 · 主角小传" />
    <template v-if="isCharacterForm">
      <label class="form-label field-gap">角色字段 <small class="label-hint">按「标签：正文」保存，便于 AI 精确引用</small></label>
      <div class="character-fields">
        <div v-for="field in CHARACTER_FIELDS" :key="field" class="character-field">
          <span>{{ field }}</span>
          <n-input v-model:value="characterFields[field]" type="textarea" :rows="2" maxlength="800" :placeholder="field === '关系' ? '与主要人物的关系与张力' : `填写${field}相关的具体事实`" />
        </div>
      </div>
    </template>
    <template v-else>
      <label class="form-label required field-gap">设定内容</label><n-input v-model:value="form.content" type="textarea" :rows="9" maxlength="12000" show-count placeholder="具体、明确地记录设定事实、限制与变化。避免只有抽象评价……" />
    </template>
    <label class="form-label field-gap">标签</label><n-dynamic-tags v-model:value="form.tags" :max="8" />
    <div class="modal-footer"><n-button @click="showEditor = false">取消</n-button><n-button type="primary" :loading="saving" @click="save">保存设定卡</n-button></div>
  </n-modal>

  <n-modal v-model:show="showImport" preset="card" title="批量导入设定资料" class="card-import-modal" :mask-closable="!importing">
    <p class="form-tip">每张卡之间用单独一行 <code>---</code> 分隔；每块第一行作为标题，其余行作为内容。一次最多 100 张。</p>
    <label class="form-label required">统一设定类型</label>
    <n-select v-model:value="importType" :options="typeOptions" />
    <label class="form-label field-gap">粘贴设定资料</label>
    <n-input v-model:value="importText" type="textarea" :rows="11" placeholder="沈砚&#10;身份：主角，嗅觉异常敏锐&#10;性格：克制、敏锐&#10;---&#10;林晚&#10;身份：灯塔守夜人&#10;关系：与沈砚互相试探" />
    <div class="import-preview"><span>识别到 <strong>{{ importItems.length }}</strong> 张卡</span><span v-if="importItems.length" class="import-titles">{{ importItems.slice(0, 4).map((item) => item.title).join('、') }}{{ importItems.length > 4 ? '…' : '' }}</span></div>
    <div class="modal-footer"><n-button :disabled="importing" @click="showImport = false">取消</n-button><n-button type="primary" :loading="importing" :disabled="!importItems.length" @click="batchImport">导入 {{ importItems.length }} 张</n-button></div>
  </n-modal>
</template>

<style scoped>
.cards-title { display: flex; align-items: center; gap: 8px; color: #315246; }.cards-title small { margin-left: 4px; color: #96a29b; font-size: 10px; font-weight: 400; }.cards-intro { padding: 12px 14px; margin-bottom: 16px; color: #71867a; background: #f0f5f0; border: 1px solid #e3ebe4; border-radius: 8px; font-size: 11px; line-height: 1.8; }.cards-toolbar { display: flex; gap: 10px; }.cards-toolbar .n-input { flex: 1; }.card-filters { display: flex; gap: 4px; padding: 15px 0; overflow-x: auto; }.card-filters button { display: flex; align-items: center; gap: 5px; padding: 7px 9px; color: #7d8c83; white-space: nowrap; cursor: pointer; background: transparent; border: 0; border-radius: 6px; font-size: 11px; }.card-filters button span { color: #a0aaa4; font-size: 9px; }.card-filters button.active { color: #2c6654; background: #eaf2ec; }.cards-list { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }.setting-card { display: flex; min-height: 208px; flex-direction: column; padding: 14px; background: #fff; border: 1px solid #e1e7e1; border-radius: 10px; }.setting-card.pinned { border-color: #bfd4c5; box-shadow: inset 0 2px #7da28e; }.setting-card.deprecated { background: #fbfbf9; border-style: dashed; opacity: .72; }.card-filters .deprecated-toggle { margin-left: auto; }.setting-card-head { display: flex; align-items: center; justify-content: space-between; }.setting-type { display: flex; align-items: center; gap: 6px; color: #688174; font-size: 10px; }.setting-card h3 { margin: 13px 0 7px; color: #344b41; font-size: 14px; font-weight: 600; }.setting-card > p { display: -webkit-box; margin: 0 0 10px; overflow: hidden; color: #7e8c84; font-size: 11px; line-height: 1.75; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }.setting-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }.setting-tags span { color: #739080; font-size: 9px; }.setting-card-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 9px; margin-top: auto; border-top: 1px solid #edf0ed; }.setting-card-footer > span { color: #a0aaa4; font-size: 9px; }.setting-card-footer > div { display: flex; }.setting-card-footer button { display: grid; width: 26px; height: 25px; place-items: center; color: #8c9991; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.setting-card-footer button:hover, .setting-card-footer button.active { color: #2c6b56; background: #edf4ef; }.setting-card-footer button.danger:hover { color: #b44f49; background: #fbefee; }.drawer-note { display: flex; align-items: center; gap: 6px; color: #788a80; font-size: 11px; }.card-editor-modal { width: 600px; }.card-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }.pin-field { padding-left: 10px; }.type-description { margin-left: 2px; }.field-gap { margin-top: 17px; }
.label-hint { margin-left: 4px; color: #9aa79f; font-size: 9px; font-weight: 400; }
.character-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 9px 12px; margin-top: 6px; }
.character-field { display: flex; flex-direction: column; gap: 4px; }
.character-field > span { color: #6f8779; font-size: 10px; }
.card-import-modal { width: 620px; }
.import-preview { display: flex; align-items: center; gap: 10px; margin-top: 10px; color: #7d8c83; font-size: 10px; }
.import-preview strong { color: #2f6b55; }
.import-titles { overflow: hidden; color: #9aa79f; text-overflow: ellipsis; white-space: nowrap; }
</style>
