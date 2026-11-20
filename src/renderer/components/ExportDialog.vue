<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NCheckbox, NInput, NModal, NRadioButton, NRadioGroup, NSelect } from 'naive-ui';
import { CheckCircle2, Download, FileCode2, FileText, ShieldCheck } from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { reportError, unwrap } from '../utils/api';

export interface ExportChapterOption { chapterId: string; title: string }

const props = defineProps<{
  show: boolean;
  workId: string;
  chapterId?: string;
  chapters: ExportChapterOption[];
}>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });
const scope = ref<'chapter' | 'book'>('book');
const format = ref<'txt' | 'md' | 'html' | 'adaptation'>('md');
const selectedChapter = ref<string | null>(null);
const adaptationChapterIds = ref<string[]>([]);
const includeChapterText = ref(false);
const accepted = ref(true);
const suppressFuture = ref(false);
const exporting = ref(false);
const exportedPath = ref('');
const exportedWords = ref(0);
const chapterOptions = computed(() => props.chapters.map((chapter) => ({ label: chapter.title, value: chapter.chapterId })));

watch(format, (value) => {
  if (value === 'adaptation') scope.value = 'book';
});

watch(() => props.show, (show) => {
  if (!show) return;
  scope.value = props.chapterId ? 'chapter' : 'book';
  selectedChapter.value = props.chapterId || props.chapters[0]?.chapterId || null;
  adaptationChapterIds.value = props.chapters.map((chapter) => chapter.chapterId);
  includeChapterText.value = false;
  format.value = 'md';
  accepted.value = !store.showExportCompliance;
  suppressFuture.value = false;
  exportedPath.value = '';
  exportedWords.value = 0;
});

async function exportDocument(): Promise<void> {
  const chapterId = scope.value === 'chapter' ? selectedChapter.value || undefined : undefined;
  if (scope.value === 'chapter' && !chapterId) return;
  exporting.value = true;
  try {
    const result = unwrap(await window.inkforge.export.document({
      workId: props.workId, chapterId, format: format.value,
      chapterIds: format.value === 'adaptation' ? [...adaptationChapterIds.value] : undefined,
      includeChapterText: format.value === 'adaptation' ? includeChapterText.value : undefined,
    }));
    if (result) {
      exportedPath.value = result.filePath;
      exportedWords.value = result.wordCount;
      if (suppressFuture.value) await store.setExportCompliance(false);
    }
  } catch (error) {
    reportError(error);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="导出作品" class="export-modal" :mask-closable="!exporting">
    <div class="export-intro"><div class="export-icon"><download :size="21" /></div><div><strong>把故事带到墨轩之外</strong><p>导出为通用文本格式，或生成可直接分享的离线阅读页。</p></div></div>
    <label class="form-label">导出范围</label>
    <n-radio-group v-model:value="scope" class="full-radio" :disabled="exporting || format === 'adaptation'">
      <n-radio-button value="book">整部作品</n-radio-button>
      <n-radio-button value="chapter" :disabled="!chapters.length">单个章节</n-radio-button>
    </n-radio-group>
    <template v-if="scope === 'chapter'">
      <label class="form-label field-gap">选择章节</label>
      <n-select v-model:value="selectedChapter" :options="chapterOptions" placeholder="请选择要导出的章节" :disabled="exporting" />
    </template>
    <label class="form-label field-gap">文件格式</label>
    <n-radio-group v-model:value="format" class="format-options" :disabled="exporting">
      <n-radio-button value="md"><file-text :size="15" />Markdown</n-radio-button>
      <n-radio-button value="txt"><file-text :size="15" />纯文本</n-radio-button>
      <n-radio-button value="html"><file-code2 :size="15" />阅读页</n-radio-button>
      <n-radio-button value="adaptation"><file-text :size="15" />资料包</n-radio-button>
    </n-radio-group>
    <p v-if="format === 'html'" class="adaptation-tip">生成一个可离线打开的静态阅读页，适合发给朋友阅读；不包含账号、邀请码、访问统计或邀请奖励。</p>
    <p v-if="format === 'adaptation'" class="adaptation-tip">资料包包含统一的短剧改编提示词、作品信息、视觉设定、故事总纲、资产与选中章节清单；可附带正文，不含分镜图或视频。同一项目建议固定使用同一条提示词。</p>
    <template v-if="format === 'adaptation'">
      <div class="adaptation-toolbar">
        <label class="form-label">参与改编的章节</label>
        <span>已选 {{ adaptationChapterIds.length }} 章</span>
        <button type="button" @click="adaptationChapterIds = chapters.map((chapter) => chapter.chapterId)">全选</button>
        <button type="button" @click="adaptationChapterIds = []">清空</button>
      </div>
      <n-select v-model:value="adaptationChapterIds" multiple :options="chapterOptions" :max-tag-count="3" placeholder="不选章节时只导出资料与提示词" :disabled="exporting" />
      <n-checkbox v-model:checked="includeChapterText" class="adaptation-include" :disabled="exporting">附带所选章节正文，便于直接交给短剧改编提示词</n-checkbox>
    </template>
    <n-alert v-if="store.showExportCompliance" type="warning" :bordered="false" class="compliance-alert">
      <template #icon><shield-check :size="18" /></template>
      <strong>发布前请确认内容合规</strong>
      <p>AI 生成内容仅供参考。请人工审校事实、版权与表达，遵守发布平台关于 AI 内容的标识要求，不用于违法违规或侵权用途。</p>
      <n-checkbox v-model:checked="accepted" :disabled="exporting">我已了解，并会对导出内容进行人工审校</n-checkbox>
      <n-checkbox v-model:checked="suppressFuture" class="suppress-compliance" :disabled="exporting">以后不再显示此提示（可在设置中恢复）</n-checkbox>
    </n-alert>
    <div v-if="exportedPath" class="export-result">
      <div><check-circle2 :size="18" /><strong>导出完成</strong><span>共 {{ exportedWords }} 字</span></div>
      <n-input :value="exportedPath" readonly size="small" class="mono" />
    </div>
    <div class="modal-footer"><n-button @click="visible = false">关闭</n-button><n-button type="primary" :loading="exporting" :disabled="(store.showExportCompliance && !accepted) || (scope === 'chapter' && !selectedChapter)" @click="exportDocument"><template #icon><download :size="15" /></template>选择位置并导出</n-button></div>
  </n-modal>
</template>

<style scoped>
.export-modal { width: 540px; }.export-intro { display: flex; align-items: center; gap: 12px; padding: 13px; margin: -3px 0 20px; background: #f3f7f3; border-radius: 9px; }.export-icon { display: grid; width: 40px; height: 40px; place-items: center; color: #3e725e; background: #e2eee5; border-radius: 9px; }.export-intro strong { color: #365246; font-size: 12px; }.export-intro p { margin: 4px 0 0; color: #85938b; font-size: 10px; }.full-radio, .format-options { display: flex; width: 100%; }.full-radio :deep(.n-radio-button), .format-options :deep(.n-radio-button) { flex: 1; text-align: center; }.format-options :deep(.n-radio-button) { font-size: 10px; }.format-options :deep(.n-radio-button__label) { display: flex; align-items: center; justify-content: center; gap: 5px; }.adaptation-tip { margin: 8px 0 0; color: #8a9077; font-size: 9px; line-height: 1.7; }.adaptation-toolbar { display: flex; align-items: center; gap: 7px; margin-top: 14px; }.adaptation-toolbar .form-label { margin: 0; white-space: nowrap; }.adaptation-toolbar span { margin-left: auto; color: #8b978f; font-size: 9px; }.adaptation-toolbar button { padding: 2px 7px; color: #4f7665; cursor: pointer; background: #f2f7f3; border: 1px solid #e0e9e2; border-radius: 5px; font-size: 9px; }.adaptation-toolbar button:hover { background: #e8f2ea; }.adaptation-include { display: flex; margin-top: 9px; color: #718176; font-size: 10px; }.field-gap { margin-top: 17px; }.compliance-alert { margin-top: 19px; }.compliance-alert strong { font-size: 11px; }.compliance-alert p { margin: 5px 0 9px; font-size: 10px; line-height: 1.7; }.compliance-alert .n-checkbox { display: flex; margin-top: 6px; }.compliance-alert .suppress-compliance { color: #8b8068; font-size: 9px; }.export-result { padding: 11px; margin-top: 15px; background: #f0f7f1; border: 1px solid #dce9de; border-radius: 8px; }.export-result > div { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: #367158; }.export-result strong { font-size: 11px; }.export-result span { margin-left: auto; color: #779082; font-size: 10px; }
</style>
