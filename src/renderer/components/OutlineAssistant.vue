<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NInputNumber, NModal, NSpin, NTag } from 'naive-ui';
import { Network, RefreshCw, WandSparkles } from 'lucide-vue-next';
import type { OutlineVolumeDraft } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { errorText, message, unwrap } from '../utils/api';
import VolumeDraftEditor from './VolumeDraftEditor.vue';

const props = defineProps<{
  show: boolean;
  workId: string;
  workTitle: string;
  genre: string;
  brief: string;
  master: string;
}>();
const emit = defineEmits<{ 'update:show': [value: boolean]; applied: [] }>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });
const volumes = ref<OutlineVolumeDraft[]>([]);
const volumeCount = ref(3);
const chapterCount = ref(8);
const generating = ref(false);
const applying = ref(false);
const error = ref('');
const hasMaster = computed(() => Boolean(props.master.trim()));

watch(() => props.show, (show) => {
  if (!show) return;
  volumes.value = [];
  error.value = '';
  generating.value = false;
  applying.value = false;
});

async function generate(): Promise<void> {
  if (generating.value) return;
  generating.value = true;
  error.value = '';
  try {
    const draft = unwrap(await window.inkforge.outline.generate({
      level: 'volume',
      brief: props.brief || `为《${props.workTitle}》规划分卷与章节。`,
      title: props.workTitle,
      genre: props.genre,
      master: props.master,
      volumeCount: volumeCount.value,
      chapterCount: chapterCount.value,
    }));
    volumes.value = draft.volumes;
    message.success(`已生成 ${draft.volumes.length} 卷大纲，请检查后应用`);
  } catch (generateError) {
    error.value = errorText(generateError);
  } finally {
    generating.value = false;
  }
}

async function apply(): Promise<void> {
  if (!volumes.value.length) {
    message.warning('请先生成分卷大纲');
    return;
  }
  applying.value = true;
  try {
    const nodes = await store.applyOutlineDraft(props.workId, volumes.value);
    if (!nodes) return;
    message.success(`已写入 ${nodes.length} 个大纲节点`);
    emit('applied');
    visible.value = false;
  } finally {
    applying.value = false;
  }
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" title="AI 生成卷章大纲" class="outline-assistant" :mask-closable="!generating && !applying">
    <div class="assistant-intro">
      <div class="assistant-icon"><network :size="20" /></div>
      <div>
        <strong>把总纲拆成可写的卷与章</strong>
        <p>AI 会沿用当前总纲与作品信息，生成分卷摘要和章纲。结果只写入大纲节点，不会改动已有章节正文。</p>
      </div>
    </div>

    <n-alert v-if="!hasMaster" type="warning" :bordered="false" class="assistant-tip">
      当前还没有总纲，生成结果会主要依据作品简介。建议先在作品空间补充总纲，结构会更稳定。
    </n-alert>

    <div class="assistant-controls">
      <label>分卷数量<n-input-number v-model:value="volumeCount" :min="1" :max="12" size="small" /></label>
      <label>每卷章节<n-input-number v-model:value="chapterCount" :min="1" :max="40" size="small" /></label>
      <n-button type="primary" :loading="generating" @click="generate">
        <template #icon><wand-sparkles :size="15" /></template>{{ volumes.length ? '重新生成' : '开始生成' }}
      </n-button>
      <n-tag v-if="volumes.length" size="small" :bordered="false" type="success">{{ volumes.length }} 卷 / {{ volumes.reduce((sum, volume) => sum + volume.chapters.length, 0) }} 章</n-tag>
    </div>

    <n-alert v-if="error && !generating" type="error" :bordered="false" class="assistant-error">
      <strong>生成未完成</strong><p>{{ error }}</p>
      <n-button size="small" secondary @click="generate"><template #icon><refresh-cw :size="13" /></template>重试</n-button>
    </n-alert>

    <n-spin :show="generating">
      <div v-if="volumes.length" class="assistant-preview">
        <volume-draft-editor v-model:volumes="volumes" />
      </div>
      <div v-else-if="!generating && !error" class="assistant-empty">
        <network :size="34" :stroke-width="1.3" />
        <h3>还没有生成卷章大纲</h3>
        <p>设置卷数与每卷章节数后开始生成，结果会先出现在这里供你修改，确认后才写入作品。</p>
      </div>
    </n-spin>

    <div class="modal-footer">
      <n-button :disabled="generating || applying" @click="visible = false">取消</n-button>
      <n-button type="primary" :disabled="!volumes.length" :loading="applying" @click="apply">应用到作品</n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.outline-assistant { width: 780px; }
.assistant-intro { display: flex; gap: 12px; padding: 13px 14px; margin-bottom: 14px; background: #f1f5f0; border-radius: 9px; }
.assistant-icon { display: grid; flex: 0 0 38px; height: 38px; place-items: center; color: #4e7a67; background: #e4ede6; border-radius: 8px; }
.assistant-intro strong { display: block; margin-bottom: 4px; color: #3d594d; font-size: 12px; }
.assistant-intro p { margin: 0; color: #7f9187; font-size: 10px; line-height: 1.7; }
.assistant-tip { margin-bottom: 12px; }
.assistant-controls { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.assistant-controls label { display: flex; align-items: center; gap: 7px; color: #7b8d82; font-size: 10px; }
.assistant-controls :deep(.n-input-number) { width: 84px; }
.assistant-error { margin-bottom: 12px; }
.assistant-error p { margin: 4px 0 8px; font-size: 11px; }
.assistant-preview { max-height: 430px; padding-right: 5px; overflow-y: auto; }
.assistant-empty { display: flex; min-height: 190px; flex-direction: column; align-items: center; justify-content: center; color: #9aa89f; text-align: center; }
.assistant-empty h3 { margin: 9px 0 6px; color: #52685c; font-size: 13px; }
.assistant-empty p { max-width: 390px; margin: 0; font-size: 10px; line-height: 1.75; }
</style>
