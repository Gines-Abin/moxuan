<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NCheckbox, NInput, NInputNumber, NModal, NSpin, NTag } from 'naive-ui';
import { FileText, RefreshCw, Sparkles, WandSparkles } from 'lucide-vue-next';
import type { GeneratedChapterDraft } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { countText, message } from '../utils/api';

const props = defineProps<{ show: boolean; workId: string }>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });

type DraftMode = 'golden-three' | 'continue';
const chapterNodes = computed(() => store.outline
  .filter((node) => node.level === 2 && !node.deletedAt)
  .sort((a, b) => a.orderIndex - b.orderIndex));
const mode = ref<DraftMode>('golden-three');
const selectedIds = ref<string[]>([]);
const instruction = ref('');
const targetChars = ref(2000);
const generating = ref(false);
const saving = ref(false);
const drafts = ref<GeneratedChapterDraft[]>([]);

const modeOptions: { label: string; value: DraftMode; description: string }[] = [
  { label: '黄金三章开篇', value: 'golden-three', description: '强化首章目标、核心悬念与第一次有效冲突，适合全书开篇。' },
  { label: '批量续写', value: 'continue', description: '按章纲与前文顺序推进，适合已有开篇后的连续更新。' },
];
const activeMode = computed(() => modeOptions.find((item) => item.value === mode.value) || modeOptions[0]);
const totalChars = computed(() => drafts.value.reduce((sum, draft) => sum + countText(draft.text), 0));
const lockedIds = computed(() => new Set(store.chapters.filter((chapter) => chapter.locked).map((chapter) => chapter.chapterId)));

watch(() => props.show, (value) => {
  if (!value) return;
  drafts.value = [];
  instruction.value = '';
  mode.value = 'golden-three';
  selectedIds.value = chapterNodes.value.filter((node) => !lockedIds.value.has(node.chapterId)).slice(0, 3).map((node) => node.chapterId);
});

function toggleChapter(chapterId: string): void {
  if (lockedIds.value.has(chapterId)) { message.warning('该章节已锁定，解锁后才能批量生成'); return; }
  if (selectedIds.value.includes(chapterId)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== chapterId);
    return;
  }
  if (selectedIds.value.length >= 5) { message.warning('单次最多批量生成 5 章'); return; }
  selectedIds.value = [...selectedIds.value, chapterId];
}

async function generate(): Promise<void> {
  if (generating.value) return;
  if (!selectedIds.value.length) { message.warning('请至少选择一章'); return; }
  const orderedIds = chapterNodes.value
    .filter((node) => selectedIds.value.includes(node.chapterId))
    .map((node) => node.chapterId);
  generating.value = true;
  try {
    const result = await store.generateDrafts({
      workId: props.workId,
      mode: mode.value,
      chapterIds: orderedIds,
      instruction: instruction.value.trim() || undefined,
      targetChars: targetChars.value,
    });
    if (result) {
      drafts.value = result;
      message.success(`已生成 ${result.length} 章正文，请逐章检查后再保存`);
    }
  } finally {
    generating.value = false;
  }
}

async function saveAll(): Promise<void> {
  if (saving.value) return;
  const payload = drafts.value
    .filter((draft) => draft.text.trim())
    .map((draft) => ({ chapterId: draft.chapterId, text: draft.text.trim() }));
  if (!payload.length) { message.warning('没有可保存的正文'); return; }
  saving.value = true;
  const saved = await store.applyDrafts(props.workId, payload);
  saving.value = false;
  if (saved) {
    message.success(`已保存 ${saved.length} 章正文，并创建历史快照`);
    visible.value = false;
  }
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="批量生成与审批" class="batch-modal" :mask-closable="!generating && !saving">
    <p class="batch-note">按章纲与设定逐章生成正文。生成结果先进入审批区，可逐章修改；确认保存时会写入正文并创建历史快照。</p>

    <template v-if="!drafts.length">
      <label class="form-label">生成模式</label>
      <div class="mode-row">
        <button
          v-for="item in modeOptions"
          :key="item.value"
          class="mode-chip"
          :class="{ active: mode === item.value }"
          @click="mode = item.value"
        >
          <strong>{{ item.label }}</strong>
          <small>{{ item.description }}</small>
        </button>
      </div>

      <div class="batch-options">
        <div>
          <label class="form-label">目标字数 / 章</label>
          <n-input-number v-model:value="targetChars" :min="600" :max="6000" :step="200" size="small" />
        </div>
        <div class="batch-hint"><wand-sparkles :size="13" />{{ activeMode.description }}</div>
      </div>

      <label class="form-label field-gap">选择章节（最多 5 章）</label>
      <div v-if="chapterNodes.length" class="chapter-picker">
        <label v-for="node in chapterNodes" :key="node.nodeId" class="chapter-option" :class="{ active: selectedIds.includes(node.chapterId), locked: lockedIds.has(node.chapterId) }">
          <n-checkbox :checked="selectedIds.includes(node.chapterId)" :disabled="lockedIds.has(node.chapterId)" @update:checked="toggleChapter(node.chapterId)" />
          <span class="chapter-name">{{ node.title }}</span>
          <n-tag v-if="lockedIds.has(node.chapterId)" size="tiny" :bordered="false" type="warning">已锁定</n-tag>
          <small v-if="node.summary">{{ node.summary }}</small>
        </label>
      </div>
      <div v-else class="batch-empty">
        <file-text :size="28" :stroke-width="1.3" />
        <h3>还没有章节</h3>
        <p>先在故事大纲中创建章节与章纲，再来批量生成正文。</p>
      </div>

      <label class="form-label field-gap">补充要求（可选）</label>
      <n-input v-model:value="instruction" type="textarea" :rows="2" maxlength="500" placeholder="例如：保持第一人称，节奏更快，每章结尾留悬念。" />

      <div class="batch-actions">
        <n-button type="primary" :loading="generating" :disabled="!selectedIds.length" @click="generate">
          <template #icon><sparkles :size="15" /></template>开始批量生成
        </n-button>
        <span class="batch-selected">已选 {{ selectedIds.length }} 章</span>
      </div>
    </template>

    <template v-else>
      <div class="review-head">
        <div><strong>待审批正文</strong><n-tag size="small" :bordered="false" type="success">{{ drafts.length }} 章 · 约 {{ totalChars }} 字</n-tag></div>
        <n-button size="small" secondary :disabled="generating || saving" @click="drafts = []">
          <template #icon><refresh-cw :size="13" /></template>重新选择章节
        </n-button>
      </div>
      <n-spin :show="generating">
        <div class="draft-list">
          <article v-for="draft in drafts" :key="draft.chapterId" class="draft-item">
            <div class="draft-item-head"><strong>{{ draft.title }}</strong><span>{{ countText(draft.text) }} 字</span></div>
            <div v-if="draft.continuity" class="draft-continuity" :class="{ low: draft.continuity.score < 4 }">接力 {{ draft.continuity.score }}/10 · {{ draft.continuity.message }}</div>
            <n-input v-model:value="draft.text" type="textarea" :rows="9" maxlength="30000" show-count />
          </article>
        </div>
      </n-spin>
    </template>

    <div class="modal-footer">
      <n-button @click="visible = false">取消</n-button>
      <n-button v-if="drafts.length" type="primary" :loading="saving" :disabled="generating" @click="saveAll">保存到章节</n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.batch-modal { width: 780px; }
.batch-note { margin: 0 0 14px; color: #7e8f85; font-size: 11px; line-height: 1.8; }
.mode-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
.mode-chip { padding: 11px 13px; text-align: left; cursor: pointer; background: #fbfcfa; border: 1px solid #e2e9e2; border-radius: 8px; }
.mode-chip.active { background: #f1f6f1; border-color: #5f8b74; }
.mode-chip strong { display: block; margin-bottom: 4px; color: #3c584a; font-size: 12px; }
.mode-chip small { color: #8b9a91; font-size: 10px; line-height: 1.6; }
.batch-options { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-top: 14px; }
.batch-options :deep(.n-input-number) { width: 130px; }
.batch-hint { display: flex; align-items: center; gap: 5px; max-width: 420px; color: #8b9a91; font-size: 10px; line-height: 1.6; }
.field-gap { margin-top: 15px; }
.chapter-picker { display: flex; flex-direction: column; gap: 5px; max-height: 240px; padding: 4px 5px 4px 0; margin-top: 6px; overflow-y: auto; }
.chapter-option { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; border: 1px solid #e6ece5; border-radius: 7px; }
.chapter-option.active { background: #f1f6f1; border-color: #b7ccbd; }
.chapter-name { flex: 0 0 auto; color: #496055; font-size: 11px; }
.chapter-option small { overflow: hidden; color: #99a49e; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.chapter-option.locked { cursor: not-allowed; background: #fbf7ee; border-color: #ecdfc4; opacity: .8; }
.chapter-option.locked .chapter-name { color: #96815a; }
.draft-continuity { padding: 4px 7px; margin-bottom: 7px; color: #3f7259; background: #edf5ef; border-radius: 5px; font-size: 9px; }
.draft-continuity.low { color: #9a6a2c; background: #fff6e5; }
.batch-empty { display: flex; min-height: 150px; flex-direction: column; align-items: center; justify-content: center; color: #9aa89f; text-align: center; }
.batch-empty h3 { margin: 8px 0 5px; color: #52685c; font-size: 13px; }
.batch-empty p { margin: 0; font-size: 10px; }
.batch-actions { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.batch-selected { color: #8b9a91; font-size: 10px; }
.review-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.review-head > div { display: flex; align-items: center; gap: 8px; color: #3f5b4d; font-size: 11px; }
.draft-list { display: flex; max-height: 470px; flex-direction: column; gap: 12px; padding-right: 5px; overflow-y: auto; }
.draft-item { padding: 12px; background: #fbfcfa; border: 1px solid #e2e9e2; border-radius: 9px; }
.draft-item-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.draft-item-head strong { color: #40574c; font-size: 11px; font-weight: 600; }
.draft-item-head span { color: #9aa79f; font-size: 9px; }
</style>
