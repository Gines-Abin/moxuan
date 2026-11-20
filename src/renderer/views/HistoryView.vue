<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NInput, NSelect, NSpin, NTag } from 'naive-ui';
import {
  ChartColumn, ChevronDown, ChevronUp, Copy, Eraser, History, RefreshCw, Search, Trash2,
} from 'lucide-vue-next';
import type { GenerationKind, GenerationRecord } from '../../shared/models';
import { summarizeUsage } from '../../shared/utils/usageStats';
import { dialog, copyText, formatDate, message, reportError, unwrap } from '../utils/api';

const router = useRouter();
const records = ref<GenerationRecord[]>([]);
const loading = ref(false);
const keyword = ref('');
const kindFilter = ref<'all' | GenerationKind>('all');
const modelFilter = ref<string | null>(null);
const expandedIds = ref<string[]>([]);

const kindMeta: Record<GenerationKind, { label: string; type: 'success' | 'warning' | 'default' }> = {
  continue: { label: '续写', type: 'success' },
  polish: { label: '润色', type: 'default' },
  deai: { label: '自然化', type: 'warning' },
};
const kindFilters: Array<'all' | GenerationKind> = ['all', 'continue', 'polish', 'deai'];

const kindCounts = computed<Record<'all' | GenerationKind, number>>(() => ({
  all: records.value.length,
  continue: records.value.filter((record) => record.kind === 'continue').length,
  polish: records.value.filter((record) => record.kind === 'polish').length,
  deai: records.value.filter((record) => record.kind === 'deai').length,
}));
const modelOptions = computed(() => [...new Set(records.value.map((record) => record.model).filter(Boolean))]
  .map((model) => ({ label: model, value: model })));
const totalPromptTokens = computed(() => records.value.reduce((sum, record) => sum + (record.promptTokens ?? 0), 0));
const totalCompletionTokens = computed(() => records.value.reduce((sum, record) => sum + (record.completionTokens ?? 0), 0));
const todayUsage = computed(() => summarizeUsage(records.value, { days: 1 }));
const weekUsage = computed(() => summarizeUsage(records.value, { days: 7 }));
const monthUsage = computed(() => summarizeUsage(records.value, { days: 30 }));
const maxWeekTokens = computed(() => Math.max(1, ...weekUsage.value.days.map((day) => day.totalTokens)));

function formatTokens(value: number): string {
  return value.toLocaleString('zh-CN');
}

function barHeight(value: number): string {
  return `${value ? Math.max(6, Math.round((value / maxWeekTokens.value) * 100)) : 2}%`;
}

function modelShare(value: number): string {
  if (!monthUsage.value.totalTokens) return '0%';
  return `${Math.max(2, Math.round((value / monthUsage.value.totalTokens) * 100))}%`;
}
const filtered = computed(() => {
  const term = keyword.value.trim().toLowerCase();
  return records.value.filter((record) => {
    if (kindFilter.value !== 'all' && record.kind !== kindFilter.value) return false;
    if (modelFilter.value && record.model !== modelFilter.value) return false;
    if (!term) return true;
    return [record.workTitle, record.chapterTitle, record.promptName, record.model, record.content]
      .some((value) => value.toLowerCase().includes(term));
  });
});
const hasFilter = computed(() => kindFilter.value !== 'all' || Boolean(modelFilter.value) || Boolean(keyword.value.trim()));

onMounted(() => { void load(); });

async function load(): Promise<void> {
  loading.value = true;
  try {
    records.value = unwrap(await window.inkforge.history.list());
  } catch (error) {
    reportError(error);
  } finally {
    loading.value = false;
  }
}

function resetFilters(): void {
  kindFilter.value = 'all';
  modelFilter.value = null;
  keyword.value = '';
}

async function copyContent(record: GenerationRecord): Promise<void> {
  await copyText(record.content);
  message.success('已复制生成内容');
}

function removeRecord(record: GenerationRecord): void {
  dialog.warning({
    title: '删除这条生成记录？',
    content: '只会删除本机保存的这条记录，作品正文、章节与提示词模板都不会受影响。',
    positiveText: '确认删除', negativeText: '取消',
    onPositiveClick: async () => {
      try {
        unwrap(await window.inkforge.history.delete(record.generationId));
        records.value = records.value.filter((item) => item.generationId !== record.generationId);
        message.success('生成记录已删除');
      } catch (error) {
        reportError(error);
      }
    },
  });
}

function clearAll(): void {
  dialog.warning({
    title: '清空全部生成历史？',
    content: '本机保存的生成记录会全部删除且不可恢复；作品正文、章节与提示词模板不受影响。',
    positiveText: '清空历史', negativeText: '取消',
    onPositiveClick: async () => {
      try {
        unwrap(await window.inkforge.history.clear());
        records.value = [];
        message.success('生成历史已清空');
      } catch (error) {
        reportError(error);
      }
    },
  });
}

function toggleExpanded(record: GenerationRecord): void {
  expandedIds.value = expandedIds.value.includes(record.generationId)
    ? expandedIds.value.filter((id) => id !== record.generationId)
    : [...expandedIds.value, record.generationId];
}

function isLongContent(record: GenerationRecord): boolean {
  return record.content.length > 90 || record.content.includes('\n');
}
</script>

<template>
  <div class="page history-page">
    <div class="page-header">
      <div>
        <h2>生成历史</h2>
        <p>找回编辑器里生成过的内容，查看每次调用在本机记录的 token 用量。</p>
      </div>
      <div class="header-actions">
        <n-button secondary :loading="loading" @click="load"><template #icon><refresh-cw :size="15" /></template>刷新</n-button>
        <n-button secondary :disabled="!records.length" @click="clearAll"><template #icon><eraser :size="15" /></template>清空历史</n-button>
      </div>
    </div>

    <div class="history-overview paper-card">
      <div class="overview-copy">
        <strong>生成记录只保存在本机</strong>
        <p>这里只统计编辑器续写、润色与自然化时模型返回的 token 用量，不包含云端费用或账单对账；清理应用数据后记录会丢失。</p>
      </div>
      <div class="overview-stat"><span>{{ records.length }}</span><small>生成次数</small></div>
      <i />
      <div class="overview-stat"><span>{{ totalPromptTokens }}</span><small>输入 tokens</small></div>
      <i />
      <div class="overview-stat"><span>{{ totalCompletionTokens }}</span><small>输出 tokens</small></div>
      <i />
      <div class="overview-stat"><span>{{ modelOptions.length }}</span><small>使用模型</small></div>
    </div>

    <section class="usage-panel paper-card">
      <div class="usage-panel-head">
        <div class="usage-panel-title">
          <chart-column :size="17" />
          <div>
            <strong>Token 用量趋势</strong>
            <p>按本机生成历史统计，不代表服务商账单；应用内不提供充值、会员或订单。</p>
          </div>
        </div>
        <span class="usage-local-badge">本地统计</span>
      </div>
      <div class="usage-panel-body">
        <div class="usage-tiles">
          <div><span>今日</span><strong>{{ formatTokens(todayUsage.totalTokens) }}</strong><small>{{ todayUsage.calls }} 次生成</small></div>
          <div><span>近 7 天</span><strong>{{ formatTokens(weekUsage.totalTokens) }}</strong><small>输入 {{ formatTokens(weekUsage.promptTokens) }} · 输出 {{ formatTokens(weekUsage.completionTokens) }}</small></div>
          <div><span>近 30 天</span><strong>{{ formatTokens(monthUsage.totalTokens) }}</strong><small>{{ monthUsage.calls }} 次生成</small></div>
        </div>
        <div class="usage-week">
          <div class="usage-subtitle"><span>近 7 天走势</span><small>单位：tokens</small></div>
          <div class="week-bars">
            <div v-for="day in weekUsage.days" :key="day.day" class="week-bar">
              <div class="bar-track">
                <i :style="{ height: barHeight(day.totalTokens) }" :title="`${day.label} · ${formatTokens(day.totalTokens)} tokens`" />
              </div>
              <span>{{ day.label }}</span>
            </div>
          </div>
        </div>
        <div class="usage-models">
          <div class="usage-subtitle"><span>按模型</span><small>近 30 天</small></div>
          <div v-if="monthUsage.models.length" class="model-list">
            <div v-for="model in monthUsage.models.slice(0, 4)" :key="model.model" class="model-row">
              <div class="model-name"><strong>{{ model.model }}</strong><span>{{ model.calls }} 次</span></div>
              <div class="model-share"><i :style="{ width: modelShare(model.totalTokens) }" /></div>
              <span class="model-tokens">{{ formatTokens(model.totalTokens) }}</span>
            </div>
          </div>
          <p v-else class="model-empty">近 30 天还没有生成记录。</p>
        </div>
      </div>
    </section>

    <div class="history-toolbar">
      <div class="kind-filters">
        <button
          v-for="kind in kindFilters"
          :key="kind"
          :class="{ active: kindFilter === kind }"
          @click="kindFilter = kind"
        >
          {{ kind === 'all' ? '全部' : kindMeta[kind].label }}<span>{{ kindCounts[kind] }}</span>
        </button>
      </div>
      <div class="toolbar-right">
        <n-select
          v-model:value="modelFilter"
          class="model-select"
          :options="modelOptions"
          clearable
          placeholder="全部模型"
        />
        <n-input v-model:value="keyword" class="search-input" clearable placeholder="搜索作品、章节、提示词或内容">
          <template #prefix><search :size="14" /></template>
        </n-input>
      </div>
    </div>

    <n-spin :show="loading">
      <div v-if="filtered.length" class="history-list">
        <article v-for="record in filtered" :key="record.generationId" class="history-card paper-card">
          <div class="history-card-head">
            <n-tag size="small" :type="kindMeta[record.kind].type" :bordered="false">{{ kindMeta[record.kind].label }}</n-tag>
            <span class="history-time">{{ formatDate(record.createdAt) }}</span>
            <span class="history-model">{{ record.model || '未知模型' }}</span>
          </div>
          <h3>{{ record.workTitle }}<i>·</i>{{ record.chapterTitle }}</h3>
          <div class="history-meta">
            <span>提示词：{{ record.promptName }}</span>
            <span>输入 {{ record.promptTokens ?? 0 }} tokens</span>
            <span>输出 {{ record.completionTokens ?? 0 }} tokens</span>
          </div>
          <p class="history-content" :class="{ expanded: expandedIds.includes(record.generationId) }">{{ record.content }}</p>
          <div class="history-card-footer">
            <button v-if="isLongContent(record)" class="expand-button" @click="toggleExpanded(record)">
              <component :is="expandedIds.includes(record.generationId) ? ChevronUp : ChevronDown" :size="13" />
              {{ expandedIds.includes(record.generationId) ? '收起' : '展开全文' }}
            </button>
            <span v-else />
            <div class="card-actions">
              <button class="copy-button" @click="copyContent(record)"><copy :size="13" />复制内容</button>
              <button class="delete-button" @click="removeRecord(record)"><trash2 :size="13" />删除</button>
            </div>
          </div>
        </article>
      </div>
      <div v-else-if="!records.length" class="paper-card empty-wrap">
        <div class="empty-icon"><history :size="28" /></div>
        <h3>还没有生成记录</h3>
        <p>在章节编辑器里完成一次续写、润色或自然化后，生成内容与 token 用量会自动记录在这里。</p>
        <n-button type="primary" @click="router.push('/')">去工作台开始写作</n-button>
      </div>
      <div v-else class="paper-card empty-wrap">
        <div class="empty-icon"><search :size="28" /></div>
        <h3>没有匹配的生成记录</h3>
        <p>当前筛选条件下没有记录。可以更换关键词或模型，也可以清空筛选后查看全部记录。</p>
        <n-button v-if="hasFilter" secondary @click="resetFilters">清空筛选条件</n-button>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.history-overview { display: flex; align-items: center; gap: 14px; padding: 18px 21px; margin-bottom: 18px; background: linear-gradient(110deg, #f8faf6, #eef4ee); }
.overview-copy { flex: 1; }
.overview-copy strong { color: #3b574a; font-size: 13px; }
.overview-copy p { max-width: 640px; margin: 5px 0 0; color: #829087; font-size: 10px; line-height: 1.7; }
.overview-stat { min-width: 68px; text-align: center; }
.overview-stat span, .overview-stat small { display: block; }
.overview-stat span { color: #3d5c4e; font-size: 21px; font-weight: 600; }
.overview-stat small { margin-top: 2px; color: #95a198; font-size: 9px; }
.history-overview > i { width: 1px; height: 28px; margin: 0 7px; background: #dae4db; }
.usage-panel { padding: 18px 21px; margin-bottom: 18px; }
.usage-panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.usage-panel-title { display: flex; gap: 9px; color: #4c6f5e; }
.usage-panel-title > div > strong { display: block; color: #365244; font-size: 13px; }
.usage-panel-title p { margin: 5px 0 0; color: #8b9990; font-size: 9px; }
.usage-local-badge { padding: 4px 8px; color: #698373; background: #f0f5f0; border: 1px solid #e2eae2; border-radius: 20px; font-size: 8px; white-space: nowrap; }
.usage-panel-body { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: 15px; }
.usage-tiles { display: flex; flex-direction: column; gap: 7px; }
.usage-tiles > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 9px 11px; background: #f7f9f6; border: 1px solid #edf1ec; border-radius: 8px; }
.usage-tiles span { color: #85948b; font-size: 9px; }
.usage-tiles strong { color: #2e5848; font-size: 15px; font-weight: 650; }
.usage-tiles small { color: #9ca8a0; font-size: 8px; text-align: right; }
.usage-subtitle { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; color: #6b8175; font-size: 9px; font-weight: 600; }
.usage-subtitle small { color: #a1aca5; font-size: 8px; font-weight: 400; }
.week-bars { display: flex; align-items: flex-end; justify-content: space-between; gap: 6px; height: 88px; padding: 0 2px; }
.week-bar { display: flex; flex: 1; flex-direction: column; align-items: center; gap: 6px; height: 100%; }
.bar-track { display: flex; flex: 1; align-items: flex-end; width: 100%; max-width: 20px; }
.bar-track i { display: block; width: 100%; min-height: 2px; background: linear-gradient(180deg, #7eb09b, #3f7561); border-radius: 4px 4px 2px 2px; transition: height .25s ease; }
.week-bar span { color: #9aa69f; font-size: 7px; white-space: nowrap; }
.model-list { display: flex; flex-direction: column; gap: 8px; }
.model-row { display: grid; grid-template-columns: minmax(60px, 1fr) minmax(40px, .8fr) auto; align-items: center; gap: 8px; }
.model-name { min-width: 0; }
.model-name strong { display: block; overflow: hidden; color: #54695e; font-size: 9px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.model-name span { color: #a0aaa4; font-size: 8px; }
.model-share { height: 5px; overflow: hidden; background: #edf1ed; border-radius: 5px; }
.model-share i { display: block; height: 100%; background: #8db5a3; border-radius: 5px; }
.model-tokens { color: #6e8276; font-size: 8px; text-align: right; white-space: nowrap; }
.model-empty { margin: 0; color: #a3ada7; font-size: 9px; line-height: 1.7; }
.history-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 15px; flex-wrap: wrap; }
.kind-filters { display: flex; gap: 5px; }
.kind-filters button { display: flex; align-items: center; gap: 7px; padding: 8px 12px; color: #7c8d83; cursor: pointer; background: transparent; border: 1px solid transparent; border-radius: 7px; font-size: 11px; }
.kind-filters button span { color: #a0aaa4; font-size: 9px; }
.kind-filters button.active { color: #2d6754; background: #fff; border-color: #dce6dd; box-shadow: 0 2px 5px rgba(40, 70, 53, .03); }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.model-select { width: 160px; }
.search-input { width: 260px; }
.history-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.history-card { display: flex; flex-direction: column; min-height: 210px; padding: 17px; }
.history-card-head { display: flex; align-items: center; gap: 9px; }
.history-time { color: #9aa89f; font-size: 9px; }
.history-model { margin-left: auto; padding: 2px 7px; color: #71877a; background: #f0f4ef; border-radius: 4px; font-size: 9px; }
.history-card h3 { margin: 12px 0 7px; color: #354e42; font-size: 14px; font-weight: 600; }
.history-card h3 i { margin: 0 6px; color: #b3beb6; font-style: normal; }
.history-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: #8d9b92; font-size: 9px; }
.history-content { display: -webkit-box; margin: 12px 0 0; overflow: hidden; color: #6d7e74; font-size: 11px; line-height: 1.85; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
.history-content.expanded { display: block; -webkit-line-clamp: unset; }
.history-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 12px; margin-top: auto; }
.expand-button { display: inline-flex; align-items: center; gap: 4px; padding: 0; color: #7e9186; cursor: pointer; background: none; border: 0; font-size: 10px; }
.expand-button:hover { color: #2f6b55; }
.card-actions { display: flex; gap: 4px; }
.card-actions button { display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; color: #6f8579; cursor: pointer; background: transparent; border: 1px solid #e3eae3; border-radius: 6px; font-size: 10px; }
.card-actions button:hover { color: #2f6b55; background: #edf3ee; border-color: #d6e3d8; }
.card-actions button.delete-button:hover { color: #b54f49; background: #fbefed; border-color: #f0dcd9; }
@media (max-width: 1250px) {
  .history-list { grid-template-columns: 1fr; }
  .overview-copy p { max-width: 420px; }
  .usage-panel-body { grid-template-columns: 1fr 1fr; }
  .usage-tiles { grid-column: 1 / -1; flex-direction: row; }
  .usage-tiles > div { flex: 1; }
}
</style>
