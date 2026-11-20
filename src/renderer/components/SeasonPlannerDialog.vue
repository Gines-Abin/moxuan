<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NButton, NInput, NInputNumber, NModal, NSpin, NTag } from 'naive-ui';
import { Plus, Sparkles, Trash2 } from 'lucide-vue-next';
import type { OutlineSeasonDraft } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { message } from '../utils/api';

const props = defineProps<{
  show: boolean;
  workId: string;
  volumeId: string;
  volumeTitle: string;
  workTitle: string;
  genre: string;
  brief: string;
  master: string;
  volumeChapterCount: number;
}>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });
const chapterCount = ref(6);
const instruction = ref('');
const generating = ref(false);
const saving = ref(false);
const seasons = ref<OutlineSeasonDraft[]>([]);
const totalChapters = computed(() => seasons.value.reduce((sum, season) => sum + season.chapters.length, 0));

watch(() => props.show, (value) => {
  if (!value) return;
  seasons.value = [];
  instruction.value = '';
  chapterCount.value = Math.min(12, Math.max(3, Math.round((props.volumeChapterCount || 18) / 3)));
});

async function generate(): Promise<void> {
  if (generating.value) return;
  generating.value = true;
  try {
    const drafts = await store.generateSeasons({
      workId: props.workId,
      volumeId: props.volumeId,
      brief: props.brief.trim() || props.workTitle,
      instruction: instruction.value.trim() || undefined,
      chapterCount: chapterCount.value,
    });
    if (drafts) {
      seasons.value = drafts;
      message.success(`已生成 ${drafts.length} 季规划，可修改后应用到分卷`);
    }
  } finally {
    generating.value = false;
  }
}

function addSeason(): void {
  if (seasons.value.length >= 8) { message.warning('最多 8 季'); return; }
  seasons.value.push({ title: `第${seasons.value.length + 1}季 · 未命名`, summary: '', chapters: [] });
}

function addChapter(season: OutlineSeasonDraft): void {
  if (season.chapters.length >= 12) { message.warning('每季最多 12 章'); return; }
  season.chapters.push({ title: `第${totalChapters.value + 1}章 · 未命名`, summary: '' });
}

async function apply(): Promise<void> {
  if (saving.value) return;
  if (!seasons.value.length) { message.warning('请先生成或添加季'); return; }
  if (!totalChapters.value) { message.warning('每季至少需要一章'); return; }
  saving.value = true;
  const applied = await store.applySeasons(props.workId, props.volumeId, seasons.value);
  saving.value = false;
  if (applied) {
    message.success('季规划已应用；原有章节已按顺序复用，未覆盖正文');
    visible.value = false;
  }
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="AI 生成季规划" class="season-modal" :mask-closable="!generating && !saving">
    <p class="season-note">为「{{ volumeTitle }}」设计季结构与章节安排。应用时会按顺序复用该卷现有章节，只更新标题、摘要与归属，不覆盖正文；不足的章节会补建，多余章节保留为未分季。</p>

    <template v-if="!seasons.length">
      <div class="season-form-grid">
        <div>
          <label class="form-label">每季章节数参考</label>
          <n-input-number v-model:value="chapterCount" :min="3" :max="12" :step="1" size="small" />
        </div>
        <div class="season-mode-hint"><sparkles :size="13" />建议每季 3-6 章，整卷 2-4 季。</div>
      </div>
      <label class="form-label field-gap">补充要求（可选）</label>
      <n-input v-model:value="instruction" type="textarea" :rows="3" maxlength="500" placeholder="例如：第一季铺垫潮汐城的规则，第二季揭开姐姐失踪真相；每季结尾留一个反转。" />
      <div class="season-actions">
        <n-button type="primary" :loading="generating" @click="generate"><template #icon><sparkles :size="15" /></template>生成季规划</n-button>
      </div>
    </template>

    <template v-else>
      <div class="season-review-head"><strong>季规划草稿</strong><n-tag size="small" :bordered="false" type="success">{{ seasons.length }} 季 · {{ totalChapters }} 章</n-tag></div>
      <n-spin :show="generating || saving">
        <div class="season-list">
          <article v-for="(season, seasonIndex) in seasons" :key="seasonIndex" class="season-card">
            <div class="season-card-head">
              <span class="season-index">第 {{ seasonIndex + 1 }} 季</span>
              <n-button size="tiny" quaternary type="error" @click="seasons.splice(seasonIndex, 1)"><template #icon><trash2 :size="12" /></template>移除</n-button>
            </div>
            <n-input v-model:value="season.title" size="small" maxlength="60" placeholder="季标题" />
            <n-input v-model:value="season.summary" type="textarea" :rows="2" maxlength="300" placeholder="本季阶段目标、主要冲突与季末转折" class="season-summary-input" />
            <div class="season-chapters">
              <div v-for="(chapter, chapterIndex) in season.chapters" :key="chapterIndex" class="season-chapter">
                <n-input v-model:value="chapter.title" size="tiny" maxlength="80" placeholder="章节标题" />
                <n-input v-model:value="chapter.summary" size="tiny" maxlength="300" placeholder="本章摘要" />
                <button class="season-chapter-remove" title="移除本章" @click="season.chapters.splice(chapterIndex, 1)"><trash2 :size="11" /></button>
              </div>
            </div>
            <button class="season-add-chapter" @click="addChapter(season)"><plus :size="12" />添加章节</button>
          </article>
          <button class="season-add" @click="addSeason"><plus :size="14" />添加一季</button>
        </div>
      </n-spin>
      <div class="season-actions">
        <n-button secondary :disabled="generating || saving" @click="generate"><template #icon><sparkles :size="14" /></template>重新生成</n-button>
        <n-button type="primary" :loading="saving" :disabled="generating" @click="apply">应用到分卷</n-button>
      </div>
    </template>

    <div class="modal-footer"><n-button @click="visible = false">取消</n-button></div>
  </n-modal>
</template>

<style scoped>
.season-modal { width: 760px; }
.season-note { margin: 0 0 14px; color: #7e8f85; font-size: 11px; line-height: 1.8; }
.season-form-grid { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; }
.season-form-grid :deep(.n-input-number) { width: 130px; }
.season-mode-hint { display: flex; align-items: center; gap: 5px; color: #8b9a91; font-size: 10px; }
.season-actions { display: flex; align-items: center; gap: 9px; margin-top: 16px; }
.season-review-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; color: #3f5b4d; font-size: 11px; }
.season-list { display: flex; max-height: 56vh; flex-direction: column; gap: 10px; padding-right: 4px; overflow-y: auto; }
.season-card { padding: 11px; background: #fbfcfa; border: 1px solid #e2e9e2; border-radius: 9px; }
.season-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }
.season-index { color: #6f8c7c; font-size: 9px; font-weight: 600; letter-spacing: .5px; }
.season-summary-input { margin-top: 6px; }
.season-chapters { display: flex; flex-direction: column; gap: 5px; margin-top: 7px; }
.season-chapter { display: grid; grid-template-columns: 1.1fr 1.9fr 20px; align-items: center; gap: 5px; }
.season-chapter-remove { display: grid; height: 22px; place-items: center; color: #a1897f; cursor: pointer; background: transparent; border: 0; }
.season-add-chapter, .season-add { display: flex; align-items: center; justify-content: center; gap: 4px; color: #69907d; cursor: pointer; background: transparent; border: 1px dashed #d7e2d9; border-radius: 6px; font-size: 9px; }
.season-add-chapter { margin-top: 7px; padding: 5px; width: 100%; }
.season-add { padding: 9px; }
</style>
