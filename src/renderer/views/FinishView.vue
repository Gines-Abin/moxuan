<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NButton, NProgress, NSpin, NTag } from 'naive-ui';
import {
  AlertCircle, ArrowLeft, BookOpenCheck, CheckCircle2, Download, FileText, ListChecks, LoaderCircle, ScanSearch,
} from 'lucide-vue-next';
import type { BookConsistencyIssue } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { reportError, unwrap } from '../utils/api';
import ExportDialog from '../components/ExportDialog.vue';

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const workId = computed(() => String(route.params.workId || ''));
const work = computed(() => store.activeWork);
const showExport = ref(false);
const showRead = ref(false);
const readLoading = ref(false);
const readItems = ref<{ title: string; content: string }[]>([]);
const checking = ref(false);
const checkedOnce = ref(false);
const checkedChapters = ref(0);
const bookIssues = ref<BookConsistencyIssue[]>([]);

const chapterNodes = computed(() => store.outline.filter((node) => node.level === 2).sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt)));
const chapterMap = computed(() => new Map(store.chapters.map((chapter) => [chapter.chapterId, chapter])));
const orderedChapters = computed(() => chapterNodes.value.flatMap((node) => {
  const chapter = chapterMap.value.get(node.chapterId);
  return chapter ? [{ node, chapter }] : [];
}));
const totalChapters = computed(() => orderedChapters.value.length);
const writtenChapters = computed(() => orderedChapters.value.filter((item) => item.chapter.wordCount > 0).length);
const totalWords = computed(() => orderedChapters.value.reduce((sum, item) => sum + item.chapter.wordCount, 0));
const completionRate = computed(() => totalChapters.value ? Math.round((writtenChapters.value / totalChapters.value) * 100) : 0);
const chapterOptions = computed(() => chapterNodes.value.map((node) => ({ chapterId: node.chapterId, title: node.title })));

const volumeStats = computed(() => store.volumes.map((volume) => {
  const items = orderedChapters.value.filter((item) => item.node.parentId === volume.nodeId);
  return {
    volume,
    seasons: store.seasons.filter((season) => season.volumeId === volume.nodeId).length,
    total: items.length,
    written: items.filter((item) => item.chapter.wordCount > 0).length,
    words: items.reduce((sum, item) => sum + item.chapter.wordCount, 0),
  };
}));

onMounted(async () => {
  if (!store.works.some((item) => item.workId === workId.value)) await store.loadWorks();
  if (store.activeWorkId !== workId.value) await store.activateWork(workId.value);
});

async function openReadThrough(): Promise<void> {
  showRead.value = true;
  if (readItems.value.length) return;
  readLoading.value = true;
  try {
    const items: { title: string; content: string }[] = [];
    for (const item of orderedChapters.value) {
      if (!item.chapter.wordCount) continue;
      const result = unwrap(await window.inkforge.chapter.get(workId.value, item.chapter.chapterId));
      items.push({ title: item.node.title, content: result.content });
    }
    readItems.value = items;
  } catch (error) {
    reportError(error);
  } finally {
    readLoading.value = false;
  }
}

async function runBookCheck(): Promise<void> {
  if (checking.value) return;
  checking.value = true;
  try {
    const result = unwrap(await window.inkforge.consistency.checkBook({ workId: workId.value }));
    bookIssues.value = result.issues;
    checkedChapters.value = result.checkedChapters;
    checkedOnce.value = true;
  } catch (error) {
    reportError(error);
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="page finish-page">
    <div class="finish-header">
      <button class="back-link" @click="router.push(`/work/${workId}`)"><arrow-left :size="15" />返回作品空间</button>
      <div class="finish-title"><div class="finish-icon"><book-open-check :size="24" /></div><div><h2>{{ work?.title || '作品' }} · 完结检查</h2><p>确认章节完整、通读全书，并在交付前做一次全书一致性检查。</p></div></div>
      <div class="finish-actions">
        <n-button secondary :disabled="!totalChapters" @click="openReadThrough"><template #icon><file-text :size="15" /></template>通读全书</n-button>
        <n-button secondary :disabled="!totalChapters" @click="showExport = true"><template #icon><download :size="15" /></template>导出整书</n-button>
        <n-button type="primary" :loading="checking" :disabled="!writtenChapters" @click="runBookCheck"><template #icon><scan-search :size="15" /></template>全书一致性检查</n-button>
      </div>
    </div>

    <section class="progress-grid">
      <div class="paper-card progress-card"><span>分卷 / 季</span><strong>{{ volumeStats.length }} / {{ store.seasons.length }}</strong><small>结构层级</small></div>
      <div class="paper-card progress-card"><span>章节完成</span><strong>{{ writtenChapters }} / {{ totalChapters }}</strong><small>已写正文的章节</small></div>
      <div class="paper-card progress-card"><span>全书字数</span><strong>{{ totalWords.toLocaleString() }}</strong><small>按可见字符统计</small></div>
      <div class="paper-card progress-card rate"><span>完成度</span><strong>{{ completionRate }}%</strong><n-progress type="line" :percentage="completionRate" :show-indicator="false" :height="6" color="#6f9c84" rail-color="#eaf0ea" /><small>以有正文的章节计算</small></div>
    </section>

    <section class="paper-card volume-progress">
      <div class="section-head"><div><list-checks :size="16" /><strong>分卷进度</strong></div><span>逐卷确认章节与字数</span></div>
      <div v-for="item in volumeStats" :key="item.volume.nodeId" class="volume-row">
        <div class="volume-copy"><strong>{{ item.volume.title }}</strong><span>{{ item.seasons }} 季 · {{ item.written }}/{{ item.total }} 章 · {{ item.words.toLocaleString() }} 字</span></div>
        <n-progress type="line" :percentage="item.total ? Math.round((item.written / item.total) * 100) : 0" :height="7" :show-indicator="false" color="#7da890" rail-color="#edf2ed" />
        <n-tag size="small" :bordered="false" :type="item.total && item.written === item.total ? 'success' : 'default'">{{ item.total && item.written === item.total ? '章节齐全' : '待完成' }}</n-tag>
      </div>
      <div v-if="!volumeStats.length" class="empty-line">还没有分卷与章节，先回到作品空间建立结构。</div>
    </section>

    <section class="paper-card check-panel">
      <div class="section-head"><div><scan-search :size="16" /><strong>全书一致性检查</strong></div><span v-if="checkedOnce">已检查 {{ checkedChapters }} 章</span></div>
      <template v-if="!checkedOnce">
        <p class="check-hint">将按章节顺序读取正文，结合设定卡检查人物、世界规则与时间线冲突。单章失败不会中断整体检查，结果仅作为人工修订参考。</p>
      </template>
      <template v-else-if="!bookIssues.length">
        <div class="check-empty"><check-circle2 :size="22" /><strong>本次检查未发现明显冲突</strong><span>仍建议通读关键章节，确认伏笔、称谓与时间线。</span></div>
      </template>
      <div v-else class="issue-list">
        <article v-for="issue in bookIssues" :key="issue.id" class="issue-item">
          <div class="issue-head"><n-tag size="tiny" :bordered="false" type="warning">{{ issue.issueType }}</n-tag><span class="issue-chapter">{{ issue.chapterTitle }}</span><span v-if="issue.cardTitle" class="issue-card">对照：{{ issue.cardTitle }}</span></div>
          <p class="issue-paragraph">“{{ issue.paragraph }}”</p>
          <p class="issue-explain">{{ issue.explanation }}</p>
          <p v-if="issue.suggestion" class="issue-suggestion">建议：{{ issue.suggestion }}</p>
        </article>
      </div>
      <div v-if="checkedOnce" class="check-footer"><n-button size="small" :loading="checking" secondary @click="runBookCheck"><template #icon><loader-circle :size="14" /></template>重新检查</n-button></div>
    </section>

    <n-modal v-model:show="showRead" preset="card" title="通读全书" class="read-modal">
      <n-spin :show="readLoading">
        <div v-if="!readItems.length && !readLoading" class="empty-line"><alert-circle :size="15" />还没有已写正文的章节。</div>
        <div class="read-body">
          <article v-for="(item, index) in readItems" :key="index" class="read-chapter"><h4>{{ item.title }}</h4><p>{{ item.content }}</p></article>
        </div>
      </n-spin>
      <div class="modal-footer"><n-button @click="showRead = false">关闭</n-button></div>
    </n-modal>

    <ExportDialog v-model:show="showExport" :work-id="workId" :chapters="chapterOptions" />
  </div>
</template>

<style scoped>
.finish-page { max-width: 1180px; }
.finish-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.back-link { display: flex; align-items: center; gap: 4px; padding: 0; color: #7d9187; font-size: 10px; cursor: pointer; background: transparent; border: 0; }
.finish-title { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.finish-icon { display: grid; width: 48px; height: 48px; place-items: center; color: #3e725e; background: #e8f1ea; border-radius: 10px; }
.finish-title h2 { margin: 0; color: #2c473b; font-family: "STSong", "SimSun", serif; font-size: 22px; font-weight: 600; }
.finish-title p { margin: 5px 0 0; color: #88968e; font-size: 10px; }
.finish-actions { display: flex; align-items: center; gap: 8px; }
.progress-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 15px; }
.progress-card { display: flex; flex-direction: column; gap: 4px; padding: 16px; }
.progress-card span { color: #86948c; font-size: 10px; }
.progress-card strong { color: #2f4a3e; font-size: 22px; font-weight: 600; }
.progress-card small { color: #9ba69f; font-size: 9px; }
.progress-card.rate { gap: 7px; }
.progress-card.rate :deep(.n-progress) { margin: 1px 0; }
.volume-progress, .check-panel { padding: 17px 18px; margin-bottom: 15px; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
.section-head > div { display: flex; align-items: center; gap: 6px; color: #476a58; }
.section-head strong { font-size: 12px; }
.section-head > span { color: #98a49d; font-size: 9px; }
.volume-row { display: grid; grid-template-columns: 1.3fr 2fr auto; align-items: center; gap: 14px; padding: 10px 0; border-top: 1px solid #f0f3ef; }
.volume-row:first-of-type { border-top: 0; }
.volume-copy { display: flex; flex-direction: column; gap: 3px; }
.volume-copy strong { color: #3c5549; font-size: 11px; }
.volume-copy span { color: #96a29a; font-size: 9px; }
.empty-line { display: flex; align-items: center; gap: 6px; padding: 12px 0; color: #97a39b; font-size: 10px; }
.check-hint { margin: 0; color: #8c9a92; font-size: 10px; line-height: 1.9; }
.check-empty { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 18px 0; color: #4d866c; }
.check-empty strong { font-size: 12px; }
.check-empty span { color: #96a39b; font-size: 9px; }
.issue-list { display: flex; flex-direction: column; gap: 9px; }
.issue-item { padding: 10px 12px; background: #fffdf6; border: 1px solid #f0e6cd; border-radius: 8px; }
.issue-head { display: flex; align-items: center; gap: 7px; }
.issue-chapter { color: #6b7d72; font-size: 9px; font-weight: 600; }
.issue-card { color: #a08b62; font-size: 9px; }
.issue-paragraph { margin: 7px 0 0; color: #5e5342; font-size: 10px; line-height: 1.75; }
.issue-explain { margin: 5px 0 0; color: #8b7d65; font-size: 10px; line-height: 1.7; }
.issue-suggestion { margin: 4px 0 0; color: #4f7a62; font-size: 10px; line-height: 1.7; }
.check-footer { display: flex; justify-content: flex-end; margin-top: 12px; }
.read-modal { width: 860px; }
.read-body { max-height: 64vh; padding-right: 6px; overflow-y: auto; }
.read-chapter { padding: 12px 0; border-bottom: 1px solid #eef1ed; }
.read-chapter:last-child { border-bottom: 0; }
.read-chapter h4 { margin: 0 0 7px; color: #385144; font-family: "STSong", "SimSun", serif; font-size: 15px; }
.read-chapter p { margin: 0; color: #5f6d65; font-size: 12px; line-height: 2; white-space: pre-wrap; }
@media (max-width: 1180px) { .progress-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.finish-header { flex-wrap: wrap; }.finish-actions { width: 100%; justify-content: flex-end; } }
</style>
