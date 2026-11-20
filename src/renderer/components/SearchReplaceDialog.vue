<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NCheckbox, NInput, NModal, NSpin, NTag } from 'naive-ui';
import { Replace, Search as SearchIcon } from 'lucide-vue-next';
import type { SearchReplaceResult } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { dialog, message } from '../utils/api';

const props = defineProps<{ show: boolean; workId: string }>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });
const keyword = ref('');
const replacement = ref('');
const caseSensitive = ref(true);
const result = ref<SearchReplaceResult | null>(null);
const searching = ref(false);
const replacing = ref(false);

watch(() => props.show, (show) => {
  if (!show) return;
  result.value = null;
  searching.value = false;
  replacing.value = false;
});

watch([keyword, replacement, caseSensitive], () => { result.value = null; });

async function search(): Promise<void> {
  if (!keyword.value.trim()) {
    message.warning('请输入要查找的内容');
    return;
  }
  searching.value = true;
  try {
    const found = await store.searchReplace({
      workId: props.workId, keyword: keyword.value, caseSensitive: caseSensitive.value,
    });
    if (!found) return;
    result.value = found;
    if (!found.totalCount) message.info('没有找到匹配内容');
  } finally {
    searching.value = false;
  }
}

function confirmReplace(): void {
  const found = result.value;
  if (!found?.totalCount) {
    message.warning('请先查找确认要替换的内容');
    return;
  }
  if (keyword.value === replacement.value) {
    message.warning('查找内容与替换内容相同，无需替换');
    return;
  }
  dialog.warning({
    title: '确认全局替换？',
    content: `将把「${keyword.value}」替换为「${replacement.value || '空'}」，共涉及 ${found.totalCount} 处。锁定章节会被跳过；每次替换前会自动创建快照。`,
    positiveText: '开始替换',
    negativeText: '取消',
    onPositiveClick: async () => {
      replacing.value = true;
      try {
        const replaced = await store.searchReplace({
          workId: props.workId, keyword: keyword.value, replacement: replacement.value,
          caseSensitive: caseSensitive.value,
        });
        if (!replaced) return false;
        result.value = replaced;
        message.success(
          `已替换 ${replaced.replacedChapters} 个章节${replaced.skippedLocked ? `，跳过 ${replaced.skippedLocked} 个锁定章节` : ''}`,
        );
        return true;
      } finally {
        replacing.value = false;
      }
    },
  });
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="全局查找替换" class="replace-modal" :mask-closable="!searching && !replacing">
    <p class="replace-note">在当前作品的全部章节正文中查找，可按需批量替换。替换前会自动为每个被修改的章节创建快照；锁定章节只统计、不替换。</p>
    <div class="replace-form">
      <div>
        <label class="form-label">查找内容</label>
        <n-input v-model:value="keyword" maxlength="200" placeholder="输入要查找的文字" :disabled="searching || replacing" @keydown.enter="search" />
      </div>
      <div>
        <label class="form-label">替换为</label>
        <n-input v-model:value="replacement" maxlength="200" placeholder="留空表示删除匹配内容" :disabled="searching || replacing" />
      </div>
      <n-checkbox v-model:checked="caseSensitive" :disabled="searching || replacing">区分大小写</n-checkbox>
    </div>
    <div class="replace-actions">
      <n-button type="primary" secondary :loading="searching" :disabled="replacing" @click="search">
        <template #icon><search-icon :size="15" /></template>查找
      </n-button>
      <n-button type="error" :loading="replacing" :disabled="searching || !result?.totalCount" @click="confirmReplace">
        <template #icon><replace :size="15" /></template>全部替换
      </n-button>
      <n-tag v-if="result" size="small" :bordered="false" :type="result.totalCount ? 'success' : 'default'">
        {{ result.totalCount }} 处 / {{ result.hits.length }} 章
      </n-tag>
    </div>

    <n-spin :show="searching">
      <div v-if="result" class="replace-results">
        <n-alert v-if="!result.totalCount" type="info" :bordered="false">没有找到「{{ result.keyword }}」，可以调整关键字或关闭区分大小写后重试。</n-alert>
        <article v-for="hit in result.hits" :key="hit.chapterId" class="hit-row">
          <div class="hit-head">
            <strong>{{ hit.chapterTitle }}</strong>
            <div>
              <n-tag v-if="hit.locked" size="tiny" :bordered="false" type="warning">已锁定 · 跳过替换</n-tag>
              <span class="hit-count">{{ hit.count }} 处</span>
            </div>
          </div>
          <p v-for="(preview, index) in hit.previews" :key="index" class="hit-preview">{{ preview }}</p>
        </article>
      </div>
      <div v-else class="replace-empty">
        <search-icon :size="30" :stroke-width="1.3" />
        <p>输入关键字后点击“查找”，结果会按章节列出命中位置。</p>
      </div>
    </n-spin>

    <div class="modal-footer">
      <n-button :disabled="searching || replacing" @click="visible = false">关闭</n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.replace-modal { width: 680px; }
.replace-note { margin: 0 0 14px; color: #8b9a91; font-size: 10px; line-height: 1.7; }
.replace-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: end; }
.replace-form > div:last-of-type { display: flex; align-items: center; min-height: 30px; }
.replace-actions { display: flex; align-items: center; gap: 8px; padding: 13px 0; margin-top: 13px; border-top: 1px solid #e9ede8; }
.replace-results { max-height: 360px; overflow-y: auto; }
.hit-row { padding: 10px 11px; margin-bottom: 8px; background: #f8faf6; border: 1px solid #e8ede7; border-radius: 7px; }
.hit-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hit-head strong { overflow: hidden; color: #43594e; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.hit-head > div { display: flex; align-items: center; gap: 7px; }
.hit-count { color: #7f9388; font-size: 9px; white-space: nowrap; }
.hit-preview { margin: 6px 0 0; padding-left: 9px; overflow: hidden; color: #7d8d84; border-left: 2px solid #dbe5dc; font-size: 10px; line-height: 1.7; text-overflow: ellipsis; white-space: nowrap; }
.replace-empty { padding: 46px 10px; color: #9aa79f; text-align: center; }
.replace-empty p { margin: 9px 0 0; font-size: 10px; }
</style>
