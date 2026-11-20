<script setup lang="ts">
import { NButton, NInput } from 'naive-ui';
import { Plus, Trash2 } from 'lucide-vue-next';
import type { OutlineChapterDraft, OutlineVolumeDraft } from '../../shared/models';

const props = defineProps<{ volumes: OutlineVolumeDraft[] }>();
const emit = defineEmits<{ 'update:volumes': [value: OutlineVolumeDraft[]] }>();

function patchVolume(index: number, patch: Partial<OutlineVolumeDraft>): void {
  emit('update:volumes', props.volumes.map((volume, current) => current === index ? { ...volume, ...patch } : volume));
}

function patchChapter(volumeIndex: number, chapterIndex: number, patch: Partial<OutlineChapterDraft>): void {
  emit('update:volumes', props.volumes.map((volume, current) => current === volumeIndex
    ? { ...volume, chapters: volume.chapters.map((chapter, position) => position === chapterIndex ? { ...chapter, ...patch } : chapter) }
    : volume));
}

function addChapter(volumeIndex: number): void {
  const volume = props.volumes[volumeIndex];
  if (!volume) return;
  patchVolume(volumeIndex, {
    chapters: [...volume.chapters, { title: `第${volume.chapters.length + 1}章`, summary: '' }],
  });
}

function removeChapter(volumeIndex: number, chapterIndex: number): void {
  const volume = props.volumes[volumeIndex];
  if (!volume) return;
  patchVolume(volumeIndex, { chapters: volume.chapters.filter((_chapter, position) => position !== chapterIndex) });
}

function removeVolume(volumeIndex: number): void {
  emit('update:volumes', props.volumes.filter((_volume, position) => position !== volumeIndex));
}
</script>

<template>
  <div class="draft-volumes">
    <article v-for="(volume, volumeIndex) in volumes" :key="volumeIndex" class="draft-volume">
      <div class="draft-volume-head">
        <span class="draft-mark">{{ String(volumeIndex + 1).padStart(2, '0') }}</span>
        <n-input :value="volume.title" size="small" maxlength="80" placeholder="分卷名称，例如：第一卷 · 风起" @update:value="patchVolume(volumeIndex, { title: $event })" />
        <n-button text size="tiny" :disabled="volumes.length <= 1" @click="removeVolume(volumeIndex)"><template #icon><trash2 :size="13" /></template></n-button>
      </div>
      <n-input
        :value="volume.summary"
        type="textarea"
        :rows="2"
        size="small"
        maxlength="600"
        placeholder="本卷核心冲突、推进与卷末钩子……"
        @update:value="patchVolume(volumeIndex, { summary: $event })"
      />
      <div class="draft-chapters">
        <div v-for="(chapter, chapterIndex) in volume.chapters" :key="chapterIndex" class="draft-chapter">
          <n-input :value="chapter.title" size="tiny" maxlength="120" placeholder="章节名称" @update:value="patchChapter(volumeIndex, chapterIndex, { title: $event })" />
          <n-input :value="chapter.summary" type="textarea" :rows="2" size="tiny" maxlength="400" placeholder="本章事件、冲突与结尾钩子……" @update:value="patchChapter(volumeIndex, chapterIndex, { summary: $event })" />
          <button class="draft-remove" title="删除本章" @click="removeChapter(volumeIndex, chapterIndex)"><trash2 :size="12" /></button>
        </div>
        <n-button size="tiny" quaternary @click="addChapter(volumeIndex)"><template #icon><plus :size="12" /></template>添加章节</n-button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.draft-volumes { display: flex; flex-direction: column; gap: 12px; }
.draft-volume { padding: 13px 14px; background: #f8faf7; border: 1px solid #e4eae3; border-radius: 9px; }
.draft-volume-head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
.draft-mark { display: grid; flex: 0 0 25px; height: 25px; place-items: center; color: #6f8d7c; background: #e9f0ea; border-radius: 6px; font-size: 10px; }
.draft-chapters { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 4px 17px; margin: 10px 0 0 11px; border-left: 1px solid #e0e8e1; }
.draft-chapter { position: relative; display: flex; flex-direction: column; gap: 5px; padding-right: 22px; }
.draft-remove { position: absolute; top: 2px; right: 0; display: grid; width: 20px; height: 20px; place-items: center; color: #a2ada6; cursor: pointer; background: transparent; border: 0; border-radius: 4px; }
.draft-remove:hover { color: #b44e49; background: #fbefee; }
</style>
