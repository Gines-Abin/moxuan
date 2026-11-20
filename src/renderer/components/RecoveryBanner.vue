<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NButton } from 'naive-ui';
import { FileClock, RotateCcw, Trash2, X } from 'lucide-vue-next';
import type { RecoveryItem } from '../../shared/models';
import { formatDate, message, reportError, unwrap } from '../utils/api';

const items = ref<RecoveryItem[]>([]);
const busy = ref(false);
const dismissed = ref(false);
const current = computed(() => items.value[0] || null);

async function load(): Promise<void> {
  try {
    items.value = unwrap(await window.inkforge.recovery.list());
  } catch (error) {
    reportError(error);
  }
}

async function restore(): Promise<void> {
  if (!current.value) return;
  busy.value = true;
  try {
    unwrap(await window.inkforge.recovery.restore(current.value.id));
    items.value.shift();
    message.success('临时草稿已恢复到对应章节');
  } catch (error) {
    reportError(error);
  } finally {
    busy.value = false;
  }
}

async function discard(): Promise<void> {
  if (!current.value) return;
  busy.value = true;
  try {
    unwrap(await window.inkforge.recovery.discard(current.value.id));
    items.value.shift();
    message.success('已丢弃该临时草稿');
  } catch (error) {
    reportError(error);
  } finally {
    busy.value = false;
  }
}

onMounted(() => { void load(); });
</script>

<template>
  <div v-if="current && !dismissed" class="recovery-banner">
    <div class="recovery-icon"><file-clock :size="19" /></div>
    <div class="recovery-copy">
      <strong>发现未恢复的临时草稿 <span v-if="items.length > 1">（共 {{ items.length }} 份）</span></strong>
      <span>{{ current.filePath }} · 最后修改于 {{ formatDate(current.modifiedAt) }}</span>
    </div>
    <n-button size="small" type="primary" :loading="busy" @click="restore"><template #icon><rotate-ccw :size="14" /></template>恢复草稿</n-button>
    <n-button size="small" quaternary :disabled="busy" @click="discard"><template #icon><trash2 :size="14" /></template>丢弃</n-button>
    <button class="recovery-close" aria-label="暂时关闭恢复提示" @click="dismissed = true"><x :size="16" /></button>
  </div>
</template>

<style scoped>
.recovery-banner { display: flex; flex: 0 0 auto; align-items: center; gap: 11px; padding: 10px 24px; color: #725426; background: #fff8e9; border-bottom: 1px solid #ecdfbe; }
.recovery-icon { display: grid; width: 32px; height: 32px; place-items: center; color: #a6752f; background: #f8edcf; border-radius: 8px; }
.recovery-copy { flex: 1; min-width: 0; }
.recovery-copy strong, .recovery-copy span { display: block; }
.recovery-copy strong { margin-bottom: 3px; font-size: 12px; font-weight: 600; }
.recovery-copy > span { overflow: hidden; color: #9a8056; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.recovery-close { display: grid; padding: 5px; place-items: center; color: #a18b64; cursor: pointer; background: transparent; border: 0; }
</style>
