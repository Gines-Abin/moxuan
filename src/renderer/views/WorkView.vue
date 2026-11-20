<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton, NDropdown, NInput, NInputNumber, NModal, NSelect, NSpin,
} from 'naive-ui';
import {
  AlignLeft, ArrowDown, ArrowLeft, ArrowUp, BookOpen, ChevronRight, Download, FilePlus2,
  FileStack, FileText, FolderPlus, Layers, Lock, MoreHorizontal, Pencil, Pin, Plus, Search, Trash2, WandSparkles,
} from 'lucide-vue-next';
import type { OutlineNode, OutlineSeason } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { dialog, errorText, message, shortDate, unwrap } from '../utils/api';
import BatchDraftDialog from '../components/BatchDraftDialog.vue';
import CardAutoFill from '../components/CardAutoFill.vue';
import CardsView from '../components/CardsView.vue';
import ExportDialog from '../components/ExportDialog.vue';
import OutlineAssistant from '../components/OutlineAssistant.vue';
import SearchReplaceDialog from '../components/SearchReplaceDialog.vue';
import SeasonPlannerDialog from '../components/SeasonPlannerDialog.vue';

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const workId = computed(() => String(route.params.workId));
const work = computed(() => store.activeWork);
const showCards = ref(false);
const showProfile = ref(false);
const savingProfile = ref(false);
const profileForm = reactive({
  title: '', genre: '', description: '', style: '', targetWords: null as number | null, platform: '', requirements: '',
  visualRatio: '', visualStyle: '', visualNotes: '',
});
const visualRatioOptions = ['9:16', '16:9', '1:1', '4:3'].map((value) => ({ label: value, value }));
const showExport = ref(false);
const showNodeEditor = ref(false);
const saving = ref(false);
const editorMode = ref<'volume' | 'chapter' | 'rename'>('volume');
const editingNode = ref<OutlineNode | null>(null);
const nodeForm = reactive({ title: '', summary: '', parentId: null as string | null, seasonId: null as string | null });
const chapterNodes = computed(() => store.outline.filter((node) => node.level === 2 && !node.deletedAt).sort((a, b) => a.orderIndex - b.orderIndex));
const orphanChapters = computed(() => chapterNodes.value.filter((node) => !node.parentId || !store.volumes.some((volume) => volume.nodeId === node.parentId)));
const exportChapters = computed(() => chapterNodes.value.map((node) => ({ chapterId: node.chapterId, title: node.title })));
const continueNode = computed(() => chapterNodes.value[chapterNodes.value.length - 1] || null);
const showMasterEditor = ref(false);
const showOutlineAssistant = ref(false);
const showCardAutoFill = ref(false);
const showBatchDraft = ref(false);
const generatingChapterOutline = ref<string | null>(null);
const showSeasonPlanner = ref(false);
const seasonVolume = ref<OutlineNode | null>(null);
const showSearchReplace = ref(false);
const showMoveDialog = ref(false);
const movingNode = ref<OutlineNode | null>(null);
const moveTargetId = ref<string | null>(null);
const moveBusy = ref(false);
const chapterLockMap = computed(() => new Map(store.chapters.map((chapter) => [chapter.chapterId, chapter.locked === true])));
const masterForm = ref('');
const savingMaster = ref(false);
const masterPreview = computed(() => {
  const content = store.masterOutline.content;
  if (!content) return '';
  return content.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) || '';
});
const moveVolumeOptions = computed(() => store.volumes
  .filter((volume) => volume.nodeId !== movingNode.value?.parentId)
  .map((volume) => ({ label: volume.title, value: volume.nodeId })));

function openProfile(): void {
  if (!work.value) return;
  Object.assign(profileForm, {
    title: work.value.title,
    genre: work.value.genre,
    description: work.value.description,
    style: work.value.style ?? '',
    targetWords: work.value.targetWords || null,
    platform: work.value.platform ?? '',
    requirements: work.value.requirements ?? '',
    visualRatio: work.value.visualRatio ?? '',
    visualStyle: work.value.visualStyle ?? '',
    visualNotes: work.value.visualNotes ?? '',
  });
  showProfile.value = true;
}

async function saveProfile(): Promise<void> {
  if (!work.value) return;
  if (!profileForm.title.trim()) {
    message.warning('作品名称不能为空');
    return;
  }
  savingProfile.value = true;
  const updated = await store.updateWork(work.value.workId, {
    title: profileForm.title.trim(),
    genre: profileForm.genre.trim(),
    description: profileForm.description.trim(),
    style: profileForm.style.trim(),
    targetWords: profileForm.targetWords ?? 0,
    platform: profileForm.platform.trim(),
    requirements: profileForm.requirements.trim(),
    visualRatio: profileForm.visualRatio,
    visualStyle: profileForm.visualStyle.trim(),
    visualNotes: profileForm.visualNotes.trim(),
  });
  savingProfile.value = false;
  if (updated) {
    showProfile.value = false;
    message.success('作品资料已更新');
  }
}

function openMasterEditor(): void {
  masterForm.value = store.masterOutline.content;
  showMasterEditor.value = true;
}

async function saveMaster(): Promise<void> {
  savingMaster.value = true;
  const saved = await store.saveMasterOutline(workId.value, masterForm.value.trim());
  savingMaster.value = false;
  if (saved) {
    showMasterEditor.value = false;
    message.success('总纲已保存');
  }
}

watch(workId, async (id) => {
  if (!store.works.length) await store.loadWorks();
  await store.activateWork(id);
}, { immediate: true });

function chaptersOf(volumeId: string): OutlineNode[] {
  return chapterNodes.value.filter((node) => node.parentId === volumeId);
}

function seasonsOf(volumeId: string): OutlineSeason[] {
  return store.seasons.filter((season) => season.volumeId === volumeId).sort((a, b) => a.orderIndex - b.orderIndex);
}

function chaptersOfSeason(volumeId: string, seasonId: string): OutlineNode[] {
  return chaptersOf(volumeId).filter((node) => node.seasonId === seasonId);
}

function unseasonedChapters(volumeId: string): OutlineNode[] {
  const ids = new Set(seasonsOf(volumeId).map((season) => season.seasonId));
  return chaptersOf(volumeId).filter((node) => !node.seasonId || !ids.has(node.seasonId));
}

function chapterLocked(chapterId: string): boolean {
  return chapterLockMap.value.get(chapterId) === true;
}

function openNodeEditor(mode: 'volume' | 'chapter', volumeId?: string, seasonId?: string | null): void {
  editorMode.value = mode;
  editingNode.value = null;
  Object.assign(nodeForm, { title: '', summary: '', parentId: volumeId || store.volumes[0]?.nodeId || null, seasonId: seasonId ?? null });
  if (mode === 'chapter' && !store.volumes.length) {
    message.info('请先创建一卷，再在卷下添加章节');
    editorMode.value = 'volume';
  }
  showNodeEditor.value = true;
}

function openRename(node: OutlineNode): void {
  editorMode.value = 'rename';
  editingNode.value = node;
  Object.assign(nodeForm, { title: node.title, summary: node.summary, parentId: node.parentId });
  showNodeEditor.value = true;
}

async function saveNode(): Promise<void> {
  if (!nodeForm.title.trim()) { message.warning('请输入卷章名称'); return; }
  saving.value = true;
  if (editorMode.value === 'rename' && editingNode.value) {
    const result = await store.updateOutline(workId.value, editingNode.value.nodeId, { title: nodeForm.title.trim(), summary: nodeForm.summary.trim() });
    if (result) { showNodeEditor.value = false; message.success('卷章信息已更新'); }
  } else {
    const level = editorMode.value === 'volume' ? 1 : 2;
    if (level === 2 && !nodeForm.parentId) { saving.value = false; message.warning('请选择所属分卷'); return; }
    const node = await store.createOutline({ workId: workId.value, title: nodeForm.title.trim(), summary: nodeForm.summary.trim(), level, parentId: level === 1 ? null : nodeForm.parentId, seasonId: level === 2 ? nodeForm.seasonId : null });
    if (node) {
      showNodeEditor.value = false;
      message.success(level === 1 ? '分卷已创建' : '章节已创建');
      if (level === 2) await router.push(`/work/${workId.value}/chapter/${node.chapterId}`);
    }
  }
  saving.value = false;
}

function openChapter(node: OutlineNode): void {
  void router.push(`/work/${workId.value}/chapter/${node.chapterId}`);
}

async function moveNode(node: OutlineNode, direction: -1 | 1): Promise<void> {
  const siblings = node.level === 1
    ? store.volumes
    : chapterNodes.value.filter((item) => item.parentId === node.parentId);
  const index = siblings.findIndex((item) => item.nodeId === node.nodeId);
  const target = siblings[index + direction];
  if (!target) return;
  const ordered = [...store.outline].sort((a, b) => a.orderIndex - b.orderIndex);
  const ids = ordered.map((item) => item.nodeId);
  const from = ids.indexOf(node.nodeId);
  const to = ids.indexOf(target.nodeId);
  [ids[from], ids[to]] = [ids[to], ids[from]];
  await store.reorderOutline(workId.value, ids);
}

function removeNode(node: OutlineNode): void {
  const isVolume = node.level === 1;
  dialog.warning({
    title: `删除${isVolume ? '分卷' : '章节'}“${node.title}”？`,
    content: isVolume ? '删除分卷可能影响卷内章节，请确认其中内容已妥善处理。该操作会调用后端删除流程。' : '章节正文将随大纲节点进入删除流程。建议先手动创建快照或导出重要内容。',
    positiveText: '确认删除', negativeText: '取消',
    onPositiveClick: async () => { if (await store.deleteOutline(workId.value, node.nodeId)) message.success(`${isVolume ? '分卷' : '章节'}已删除`); },
  });
}

function nodeOptions(level: 1 | 2): { label: string; key: string }[] {
  return [
    ...(level === 1 ? [{ label: 'AI 生成季规划', key: 'seasons' }] : []),
    ...(level === 2 ? [{ label: '生成章纲', key: 'outline' }, { label: '移动到分卷', key: 'move' }] : []),
    { label: '重命名', key: 'rename' },
    { label: '向上移动', key: 'up' },
    { label: '向下移动', key: 'down' },
    { label: '删除', key: 'delete' },
  ];
}

function openSeasonPlanner(volume: OutlineNode): void {
  seasonVolume.value = volume;
  showSeasonPlanner.value = true;
}

function removeSeason(season: OutlineSeason): void {
  dialog.warning({
    title: `删除季「${season.title}」？`,
    content: '只解除季与章节的归属关系，不会删除章节或正文。',
    positiveText: '确认删除', negativeText: '取消',
    onPositiveClick: async () => {
      if (await store.deleteSeason(workId.value, season.seasonId)) message.success('季已删除，章节已保留');
    },
  });
}

async function generateChapterOutline(node: OutlineNode): Promise<void> {
  if (generatingChapterOutline.value) return;
  const currentWork = work.value;
  if (!currentWork) return;
  const volume = store.volumes.find((item) => item.nodeId === node.parentId);
  generatingChapterOutline.value = node.nodeId;
  try {
    const draft = unwrap(await window.inkforge.outline.generate({
      level: 'chapter',
      brief: currentWork.description.trim() || currentWork.title,
      title: currentWork.title,
      genre: currentWork.genre,
      master: store.masterOutline.content,
      volumeTitle: volume?.title,
      chapterTitle: node.title,
    }));
    if (!draft.chapter) return;
    const updated = await store.updateOutline(workId.value, node.nodeId, { summary: draft.chapter.summary });
    if (updated) message.success(`「${node.title}」章纲已生成`);
  } catch (error) {
    message.error(errorText(error));
  } finally {
    generatingChapterOutline.value = null;
  }
}

function openMoveDialog(node: OutlineNode): void {
  if (!store.volumes.length) {
    message.info('还没有其他分卷可供移动');
    return;
  }
  movingNode.value = node;
  moveTargetId.value = null;
  showMoveDialog.value = true;
}

function formatWholeBook(): void {
  dialog.warning({
    title: '对全书执行智能排版？',
    content: '会清理每章的行尾空格、行首全角缩进和连续空行，不修改文字内容；锁定章节会跳过。每个被修改的章节会先自动创建快照。',
    positiveText: '开始排版',
    negativeText: '取消',
    onPositiveClick: async () => {
      const result = await store.formatWork(workId.value);
      if (!result) return false;
      message.success(result.changedChapters
        ? `排版完成：修改 ${result.changedChapters} 章${result.skippedLocked ? `，跳过 ${result.skippedLocked} 个锁定章节` : ''}`
        : `没有需要排版的章节${result.skippedLocked ? `（${result.skippedLocked} 个锁定章节已跳过）` : ''}`);
      return true;
    },
  });
}

async function confirmMove(): Promise<void> {
  if (!movingNode.value || !moveTargetId.value) {
    message.warning('请选择目标分卷');
    return;
  }
  moveBusy.value = true;
  try {
    const node = await store.moveOutlineNode({
      workId: workId.value, nodeId: movingNode.value.nodeId, targetParentId: moveTargetId.value,
    });
    if (!node) return;
    showMoveDialog.value = false;
    message.success(`「${node.title}」已移动到目标分卷`);
  } finally {
    moveBusy.value = false;
  }
}

function onNodeAction(node: OutlineNode, key: string): void {
  if (key === 'seasons') openSeasonPlanner(node);
  if (key === 'outline') void generateChapterOutline(node);
  if (key === 'move') openMoveDialog(node);
  if (key === 'rename') openRename(node);
  if (key === 'up') void moveNode(node, -1);
  if (key === 'down') void moveNode(node, 1);
  if (key === 'delete') removeNode(node);
}
</script>

<template>
  <div class="page work-page">
    <n-spin :show="store.loadingWork">
      <template v-if="work">
        <div class="work-header">
          <div class="work-heading"><button class="back-button" @click="router.push('/')"><arrow-left :size="17" /></button><div><div class="work-breadcrumb">我的作品 <chevron-right :size="11" /> {{ work.genre || '未分类' }}</div><h2>{{ work.title }}</h2><p>{{ work.description || '为这部作品添加简介，记录最初想要讲述的故事。' }}</p><button class="profile-edit" @click="openProfile"><pencil :size="11" />作品资料</button></div></div>
          <div class="header-actions"><n-button secondary @click="showCards = true"><template #icon><file-stack :size="16" /></template>设定卡 <span class="button-count">{{ store.cards.length }}</span></n-button><n-button secondary :disabled="!chapterNodes.length" @click="showBatchDraft = true"><template #icon><wand-sparkles :size="16" /></template>AI 批量写作</n-button><n-button secondary :disabled="!chapterNodes.length" @click="showExport = true"><template #icon><download :size="16" /></template>导出</n-button><n-button secondary :disabled="!chapterNodes.length" @click="showSearchReplace = true"><template #icon><search :size="16" /></template>查找替换</n-button><n-button secondary :disabled="!chapterNodes.length" @click="formatWholeBook"><template #icon><align-left :size="16" /></template>整书排版</n-button><n-button secondary @click="router.push(`/work/${workId}/finish`)"><template #icon><book-open :size="16" /></template>完结</n-button><n-button type="primary" @click="continueNode ? openChapter(continueNode) : openNodeEditor('chapter')"><template #icon><file-text :size="16" /></template>{{ continueNode ? '继续写作' : '写下第一章' }}</n-button></div>
        </div>

        <div class="work-summary-row"><div><book-open :size="15" /><span>{{ store.volumes.length }} 个分卷</span></div><i /><div><layers :size="15" /><span>{{ store.seasons.length }} 季</span></div><i /><div><file-text :size="15" /><span>{{ chapterNodes.length }} 个章节</span></div><i /><div><file-stack :size="15" /><span>{{ store.cards.length }} 张设定卡</span></div><i /><div><pin :size="14" /><span>{{ store.pinnedCards.length }} 张置顶注入</span></div><span class="updated-at">更新于 {{ shortDate(work.updatedAt) }}</span></div>

        <div class="work-layout">
          <section class="outline-panel paper-card">
            <div class="panel-heading"><div><h3>故事大纲</h3><p>总纲 · 卷纲 · 章纲，三层组织叙事脉络</p></div><n-dropdown trigger="click" :options="[{ label: '新建分卷', key: 'volume' }, { label: '新建章节', key: 'chapter' }]" @select="openNodeEditor($event as 'volume' | 'chapter')"><n-button size="small" type="primary" secondary><template #icon><plus :size="15" /></template>新建</n-button></n-dropdown></div>
            <div class="master-block">
              <div class="master-head"><div class="master-title"><layers :size="14" /><strong>总纲</strong><span v-if="store.masterOutline.updatedAt">更新于 {{ shortDate(store.masterOutline.updatedAt) }}</span></div><div class="master-actions"><button @click="openMasterEditor"><pencil :size="12" />{{ store.masterOutline.content ? '编辑' : '填写' }}</button><button @click="showOutlineAssistant = true"><wand-sparkles :size="12" />AI 生成卷章大纲</button></div></div>
              <p v-if="masterPreview" class="master-preview">{{ masterPreview }}</p>
              <p v-else class="master-empty">还没有总纲。先写一段全书主线，或让 AI 依据总纲拆出分卷与章节。</p>
            </div>
            <div v-if="store.outline.length" class="outline-tree">
              <div v-for="volume in store.volumes" :key="volume.nodeId" class="volume-group">
                <div class="volume-row"><div class="volume-label"><span class="volume-mark" /><strong>{{ volume.title }}</strong><small>{{ chaptersOf(volume.nodeId).length }} 章</small></div><div class="node-actions"><button title="新建章节" @click="openNodeEditor('chapter', volume.nodeId)"><plus :size="14" /></button><button title="向上移动" @click="moveNode(volume, -1)"><arrow-up :size="13" /></button><button title="向下移动" @click="moveNode(volume, 1)"><arrow-down :size="13" /></button><n-dropdown trigger="click" :options="nodeOptions(1)" @select="onNodeAction(volume, $event)"><button><more-horizontal :size="15" /></button></n-dropdown></div></div>
                <div class="chapter-children">
                  <template v-for="season in seasonsOf(volume.nodeId)" :key="season.seasonId">
                    <div class="season-row"><div class="season-label"><layers :size="12" /><strong>{{ season.title }}</strong><small>{{ chaptersOfSeason(volume.nodeId, season.seasonId).length }} 章</small></div><div class="node-actions"><button title="在本季添加章节" @click="openNodeEditor('chapter', volume.nodeId, season.seasonId)"><plus :size="13" /></button><button title="删除季（保留章节）" @click="removeSeason(season)"><trash2 :size="12" /></button></div></div>
                    <p v-if="season.summary" class="season-summary">{{ season.summary }}</p>
                    <div v-for="chapter in chaptersOfSeason(volume.nodeId, season.seasonId)" :key="chapter.nodeId" class="chapter-row" @dblclick="openChapter(chapter)"><button class="chapter-open" @click="openChapter(chapter)"><file-text :size="14" /><span class="chapter-copy"><span>{{ chapter.title }}</span><small v-if="chapter.summary">{{ chapter.summary }}</small></span></button><lock v-if="chapterLocked(chapter.chapterId)" :size="11" class="chapter-lock" /><div class="node-actions chapter-actions"><button title="向上移动" @click="moveNode(chapter, -1)"><arrow-up :size="12" /></button><button title="向下移动" @click="moveNode(chapter, 1)"><arrow-down :size="12" /></button><n-dropdown trigger="click" :options="nodeOptions(2)" @select="onNodeAction(chapter, $event)"><button><more-horizontal :size="14" /></button></n-dropdown></div></div>
                  </template>
                  <template v-for="chapter in unseasonedChapters(volume.nodeId)" :key="chapter.nodeId">
                    <div class="chapter-row" @dblclick="openChapter(chapter)"><button class="chapter-open" @click="openChapter(chapter)"><file-text :size="14" /><span class="chapter-copy"><span>{{ chapter.title }}</span><small v-if="chapter.summary">{{ chapter.summary }}</small></span></button><lock v-if="chapterLocked(chapter.chapterId)" :size="11" class="chapter-lock" /><div class="node-actions chapter-actions"><button title="向上移动" @click="moveNode(chapter, -1)"><arrow-up :size="12" /></button><button title="向下移动" @click="moveNode(chapter, 1)"><arrow-down :size="12" /></button><n-dropdown trigger="click" :options="nodeOptions(2)" @select="onNodeAction(chapter, $event)"><button><more-horizontal :size="14" /></button></n-dropdown></div></div>
                  </template>
                  <button class="add-chapter-inline" @click="openNodeEditor('chapter', volume.nodeId)"><plus :size="12" />添加章节</button>
                </div>
              </div>
              <div v-if="orphanChapters.length" class="orphan-group"><div class="orphan-title">未分卷章节</div><div v-for="chapter in orphanChapters" :key="chapter.nodeId" class="chapter-row"><button class="chapter-open" @click="openChapter(chapter)"><file-text :size="14" /><span>{{ chapter.title }}</span></button><lock v-if="chapterLocked(chapter.chapterId)" :size="11" class="chapter-lock" /><n-dropdown trigger="click" :options="nodeOptions(2)" @select="onNodeAction(chapter, $event)"><button class="plain-icon"><more-horizontal :size="14" /></button></n-dropdown></div></div>
              <button class="add-volume-inline" @click="openNodeEditor('volume')"><folder-plus :size="14" />新建分卷</button>
            </div>
            <div v-else class="outline-empty"><div class="empty-icon"><folder-plus :size="26" /></div><h3>先搭建故事的骨架</h3><p>创建一个分卷，再逐章展开情节。也可以直接新建第一章。</p><div><n-button size="small" secondary @click="openNodeEditor('volume')"><template #icon><folder-plus :size="14" /></template>新建分卷</n-button><n-button size="small" type="primary" @click="openNodeEditor('chapter')"><template #icon><file-plus2 :size="14" /></template>新建章节</n-button></div></div>
          </section>

          <aside class="work-side">
            <section class="paper-card writing-entry"><span class="entry-kicker">WRITING DESK</span><h3>让下一章，从此刻开始。</h3><p>{{ continueNode ? `上次写到「${continueNode.title}」，继续推进故事，或从大纲选择其他章节。` : '正文编辑器支持自动保存、AI 续写润色与历史快照，让每次落笔都安心。' }}</p><n-button type="primary" block @click="continueNode ? openChapter(continueNode) : openNodeEditor('chapter')">{{ continueNode ? '进入最近章节' : '开始写作' }}<template #icon><file-text :size="15" /></template></n-button></section>
            <section class="paper-card cards-overview"><div class="section-title"><h3><file-stack :size="16" />设定速览</h3><div class="section-actions"><button class="text-button" @click="showCardAutoFill = true">AI 补齐</button><button class="text-button" @click="showCards = true">管理全部 <chevron-right :size="12" /></button></div></div><div v-if="store.cards.length" class="overview-list"><div v-for="card in store.cards.slice(0, 4)" :key="card.cardId"><span class="overview-card-icon"><file-stack :size="14" /></span><div><strong>{{ card.title }}</strong><span>{{ card.type === 'character' ? '角色' : card.type === 'world' ? '世界观' : card.type === 'plot' ? '情节' : card.type === 'item' ? '道具' : '术语' }}</span></div><pin v-if="card.pinned" :size="12" class="pin-icon" /></div></div><div v-else class="cards-empty"><file-stack :size="23" /><p>还没有设定卡</p><button @click="showCards = true">记录角色与世界规则</button></div></section>
          </aside>
        </div>
      </template>
      <div v-else-if="!store.loadingWork" class="paper-card empty-wrap"><div class="empty-icon"><book-open :size="28" /></div><h3>没有找到这部作品</h3><p>作品可能已被删除，或当前工作区尚未载入。请返回工作台重新选择。</p><n-button type="primary" @click="router.push('/')">返回工作台</n-button></div>
    </n-spin>

    <n-modal v-model:show="showNodeEditor" preset="card" :title="editorMode === 'rename' ? '编辑卷章信息' : editorMode === 'volume' ? '新建分卷' : '新建章节'" class="node-modal" :mask-closable="!saving">
      <template v-if="editorMode === 'chapter'"><label class="form-label required">所属分卷</label><n-select v-model:value="nodeForm.parentId" :options="store.volumes.map(v => ({ label: v.title, value: v.nodeId }))" placeholder="选择分卷" /></template>
      <label class="form-label required" :class="{ 'field-gap': editorMode === 'chapter' }">{{ editorMode === 'volume' ? '分卷名称' : editorMode === 'chapter' ? '章节名称' : '名称' }}</label><n-input v-model:value="nodeForm.title" maxlength="120" :placeholder="editorMode === 'volume' ? '例如：第一卷 · 风起' : '例如：第一章 · 雨夜来客'" @keydown.enter="saveNode" />
      <label class="form-label field-gap">内容提要</label><n-input v-model:value="nodeForm.summary" type="textarea" :rows="4" maxlength="1000" show-count placeholder="简要记录本卷或本章的核心事件、冲突与目标……" />
      <div class="modal-footer"><n-button @click="showNodeEditor = false">取消</n-button><n-button type="primary" :loading="saving" @click="saveNode">{{ editorMode === 'rename' ? '保存修改' : editorMode === 'volume' ? '创建分卷' : '创建并开始写作' }}</n-button></div>
    </n-modal>
    <n-modal v-model:show="showProfile" preset="card" title="作品资料" class="node-modal profile-modal" :mask-closable="!savingProfile">
      <p class="modal-note">这些基础信息会写入 AI 提示词，帮助续写、设定生成与大纲保持同一方向；留空的项不会参与生成。</p>
      <label class="form-label required">作品名称</label><n-input v-model:value="profileForm.title" maxlength="80" show-count />
      <label class="form-label field-gap">作品分类</label><n-input v-model:value="profileForm.genre" maxlength="40" placeholder="例如：长篇小说" />
      <label class="form-label field-gap">作品简介</label><n-input v-model:value="profileForm.description" type="textarea" :rows="3" maxlength="500" show-count />
      <label class="form-label field-gap">文风</label><n-input v-model:value="profileForm.style" maxlength="80" placeholder="例如：轻松幽默、快节奏、第一人称限知" />
      <div class="profile-grid">
        <div><label class="form-label field-gap">目标字数</label><n-input-number v-model:value="profileForm.targetWords" :min="0" :max="10000000" :step="10000" :show-button="false" placeholder="例如 200000"><template #suffix>字</template></n-input-number></div>
        <div><label class="form-label field-gap">发布平台</label><n-input v-model:value="profileForm.platform" maxlength="60" placeholder="选填" /></div>
      </div>
      <label class="form-label field-gap">补充要求</label><n-input v-model:value="profileForm.requirements" type="textarea" :rows="3" maxlength="500" show-count placeholder="例如：不要新增设定、每章结尾留钩子、避免大段说明……" />
      <div class="profile-grid">
        <div><label class="form-label field-gap">画幅比例</label><n-select v-model:value="profileForm.visualRatio" :options="visualRatioOptions" clearable placeholder="选填，例如 9:16" /></div>
        <div><label class="form-label field-gap">画风预设</label><n-input v-model:value="profileForm.visualStyle" maxlength="60" placeholder="例如：国风厚涂、日系赛璐璐" /></div>
      </div>
      <label class="form-label field-gap">视觉备注</label><n-input v-model:value="profileForm.visualNotes" type="textarea" :rows="2" maxlength="200" show-count placeholder="例如：冷色调、雨夜、低饱和；主角常穿深色雨衣" />
      <p class="modal-note visual-note">画幅、画风与视觉备注会写入“从本章提取资产”的提示词，帮助角色、场景与道具的外观描述保持一致。</p>
      <div class="modal-footer"><n-button @click="showProfile = false">取消</n-button><n-button type="primary" :loading="savingProfile" @click="saveProfile">保存资料</n-button></div>
    </n-modal>
    <CardsView v-model:show="showCards" :work-id="workId" />
    <SearchReplaceDialog v-model:show="showSearchReplace" :work-id="workId" />
    <n-modal v-model:show="showMoveDialog" preset="card" title="移动章节到其他分卷" class="node-modal" :mask-closable="!moveBusy">
      <p class="modal-note">移动后章节会排在目标分卷末尾，原季归属会被清除；正文与锁定状态保持不变。</p>
      <label class="form-label">目标分卷</label>
      <n-select v-model:value="moveTargetId" :options="moveVolumeOptions" placeholder="选择要移动到的分卷" :disabled="moveBusy || !moveVolumeOptions.length" />
      <p class="modal-note move-current">当前章节：{{ movingNode?.title }}</p>
      <div class="modal-footer"><n-button :disabled="moveBusy" @click="showMoveDialog = false">取消</n-button><n-button type="primary" :loading="moveBusy" :disabled="!moveTargetId" @click="confirmMove">确认移动</n-button></div>
    </n-modal>
    <ExportDialog v-model:show="showExport" :work-id="workId" :chapters="exportChapters" />
    <n-modal v-model:show="showMasterEditor" preset="card" title="编辑故事总纲" class="master-modal" :mask-closable="!savingMaster">
      <p class="modal-note">总纲是三级大纲的第一层，会作为生成卷纲与章纲的依据，也会帮助你判断每一章是否偏离主线。</p>
      <n-input v-model:value="masterForm" type="textarea" :rows="16" maxlength="20000" show-count placeholder="写清故事内核、主线阶段、主要人物、世界规则与伏笔……" />
      <div class="modal-footer"><n-button @click="showMasterEditor = false">取消</n-button><n-button type="primary" :loading="savingMaster" @click="saveMaster">保存总纲</n-button></div>
    </n-modal>
    <OutlineAssistant
      v-model:show="showOutlineAssistant"
      :work-id="workId"
      :work-title="work?.title || ''"
      :genre="work?.genre || ''"
      :brief="work?.description || ''"
      :master="store.masterOutline.content"
    />
    <CardAutoFill v-model:show="showCardAutoFill" :work-id="workId" />
    <BatchDraftDialog v-model:show="showBatchDraft" :work-id="workId" />
    <SeasonPlannerDialog
      v-model:show="showSeasonPlanner"
      :work-id="workId"
      :volume-id="seasonVolume?.nodeId || ''"
      :volume-title="seasonVolume?.title || ''"
      :work-title="work?.title || ''"
      :genre="work?.genre || ''"
      :brief="work?.description || ''"
      :master="store.masterOutline.content"
      :volume-chapter-count="seasonVolume ? chaptersOf(seasonVolume.nodeId).length : 0"
    />
  </div>
</template>

<style scoped>
.work-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin-bottom: 19px; }.work-heading { display: flex; align-items: flex-start; gap: 13px; min-width: 0; }.back-button { display: grid; flex: 0 0 34px; height: 34px; margin-top: 20px; place-items: center; color: #73867b; cursor: pointer; background: #fff; border: 1px solid #dfe6df; border-radius: 8px; }.back-button:hover { color: #2b6754; border-color: #b9cec0; }.work-breadcrumb { display: flex; align-items: center; gap: 5px; margin-bottom: 5px; color: #91a097; font-size: 9px; }.work-heading h2 { margin: 0 0 6px; color: #293f36; font-family: "STSong", "SimSun", serif; font-size: 25px; font-weight: 600; letter-spacing: .5px; }.work-heading p { max-width: 590px; margin: 0; overflow: hidden; color: #819088; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.button-count { padding-left: 5px; color: #789184; font-size: 10px; }.work-summary-row { display: flex; align-items: center; gap: 15px; padding: 11px 15px; margin-bottom: 17px; color: #7f9086; background: rgba(255,255,255,.55); border: 1px solid #e3e8e2; border-radius: 9px; font-size: 10px; }.work-summary-row > div { display: flex; align-items: center; gap: 6px; }.work-summary-row > i { width: 1px; height: 11px; background: #dce3dd; }.updated-at { margin-left: auto; color: #9aa59f; }.work-layout { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(285px, .8fr); gap: 17px; align-items: start; }.outline-panel { min-height: 485px; padding: 19px; }.panel-heading { display: flex; align-items: center; justify-content: space-between; padding-bottom: 14px; border-bottom: 1px solid #e9ede8; }.panel-heading h3 { margin: 0 0 4px; color: #334b40; font-size: 14px; font-weight: 600; }.panel-heading p { margin: 0; color: #99a49e; font-size: 9px; }.outline-tree { padding-top: 10px; }.volume-group { margin-bottom: 8px; }.volume-row, .chapter-row { display: flex; align-items: center; justify-content: space-between; border-radius: 7px; }.volume-row { min-height: 39px; padding: 0 8px; background: #f5f8f4; }.volume-label { display: flex; align-items: center; gap: 8px; min-width: 0; }.volume-mark { width: 3px; height: 15px; background: #6d9481; border-radius: 2px; }.volume-label strong { overflow: hidden; color: #40574c; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.volume-label small { color: #99a69f; font-size: 9px; white-space: nowrap; }.node-actions { display: flex; align-items: center; opacity: .45; transition: opacity .15s; }.volume-row:hover .node-actions, .chapter-row:hover .node-actions { opacity: 1; }.node-actions button, .plain-icon { display: grid; width: 25px; height: 25px; place-items: center; color: #788b80; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.node-actions button:hover, .plain-icon:hover { color: #2f6b56; background: #e7efe8; }.chapter-children { position: relative; padding: 4px 0 2px 16px; margin-left: 9px; border-left: 1px solid #e1e8e1; }.chapter-row { min-height: 35px; padding: 0 5px 0 8px; }.chapter-row:hover { background: #f7faf6; }.chapter-open { display: flex; flex: 1; align-items: center; gap: 8px; min-width: 0; height: 33px; padding: 0; color: #71877a; text-align: left; cursor: pointer; background: transparent; border: 0; }.chapter-open span { overflow: hidden; color: #53695d; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.chapter-open:hover span { color: #25634f; }.add-chapter-inline, .add-volume-inline { display: flex; align-items: center; gap: 5px; color: #91a198; cursor: pointer; background: transparent; border: 0; font-size: 10px; }.add-chapter-inline { padding: 7px 8px; }.add-chapter-inline:hover, .add-volume-inline:hover { color: #2b6b55; }.add-volume-inline { width: 100%; justify-content: center; padding: 10px; margin-top: 7px; border: 1px dashed #d7e0d8; border-radius: 7px; }.orphan-group { margin-top: 15px; }.orphan-title { padding: 7px; color: #9b917d; font-size: 10px; }.outline-empty { display: flex; min-height: 370px; flex-direction: column; align-items: center; justify-content: center; text-align: center; }.outline-empty h3 { margin: 0 0 7px; color: #496055; font-size: 14px; }.outline-empty p { max-width: 300px; margin: 0 0 18px; color: #95a199; font-size: 11px; line-height: 1.7; }.outline-empty > div:last-child { display: flex; gap: 8px; }.work-side { display: flex; flex-direction: column; gap: 15px; }.writing-entry { padding: 23px 20px; background: linear-gradient(145deg, #eef4ee, #f8faf6); }.entry-kicker { color: #8aa294; font-size: 8px; font-weight: 600; letter-spacing: 1.8px; }.writing-entry h3 { margin: 10px 0 9px; color: #345246; font-family: "STSong", "SimSun", serif; font-size: 18px; font-weight: 600; }.writing-entry p { min-height: 51px; margin: 0 0 17px; color: #7b8e83; font-size: 11px; line-height: 1.8; }.cards-overview { padding: 17px; }.overview-list > div { display: flex; align-items: center; gap: 9px; padding: 10px 0; border-bottom: 1px solid #edf0ec; }.overview-list > div:last-child { border: 0; }.overview-card-icon { display: grid; width: 30px; height: 31px; place-items: center; color: #729080; background: #eff4ef; border-radius: 7px; }.overview-list > div > div { flex: 1; min-width: 0; }.overview-list strong, .overview-list span { display: block; }.overview-list strong { overflow: hidden; color: #50665a; font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }.overview-list div > div > span { margin-top: 3px; color: #99a49e; font-size: 9px; }.pin-icon { color: #6c9480; }.cards-empty { padding: 23px 0 12px; color: #9aa89f; text-align: center; }.cards-empty p { margin: 7px 0; font-size: 11px; }.cards-empty button { color: #39705b; cursor: pointer; background: none; border: 0; font-size: 10px; }.node-modal { width: 510px; }.field-gap { margin-top: 17px; }.move-current { margin: 12px 0 0; }
.master-block { padding: 11px 12px; margin-top: 12px; background: linear-gradient(135deg, #f4f8f3, #fbfcfa); border: 1px solid #e6ece5; border-radius: 8px; }
.master-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.master-title { display: flex; align-items: center; gap: 7px; color: #4c705e; }
.master-title strong { color: #3c584a; font-size: 11px; font-weight: 600; }
.master-title span { color: #9daaa2; font-size: 9px; }
.master-actions { display: flex; gap: 4px; }
.master-actions button { display: flex; align-items: center; gap: 4px; padding: 4px 7px; color: #547b68; cursor: pointer; background: #fff; border: 1px solid #dfe8e0; border-radius: 5px; font-size: 9px; }
.master-actions button:hover { color: #25634f; border-color: #b9cec0; }
.master-preview { margin: 8px 0 0; overflow: hidden; color: #7c8d83; font-size: 10px; line-height: 1.7; text-overflow: ellipsis; white-space: nowrap; }
.master-empty { margin: 8px 0 0; color: #9daaa2; font-size: 10px; }
.chapter-open .chapter-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; white-space: normal; }
.chapter-copy small { overflow: hidden; color: #9aa79f; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.chapter-lock { flex: 0 0 auto; margin-right: 4px; color: #b08a45; }
.season-row { display: flex; align-items: center; justify-content: space-between; min-height: 29px; padding: 0 8px 0 6px; margin-top: 6px; background: #f7f9f3; border-radius: 6px; }
.season-label { display: flex; align-items: center; gap: 5px; min-width: 0; color: #7b8e64; }
.season-label strong { overflow: hidden; color: #596b48; font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.season-label small { color: #9aa58c; font-size: 8px; white-space: nowrap; }
.season-summary { margin: 3px 0 2px 21px; overflow: hidden; color: #9aa592; font-size: 9px; line-height: 1.6; text-overflow: ellipsis; white-space: nowrap; }
.master-modal { width: 680px; }
.modal-note { margin: 0 0 12px; color: #8b9a91; font-size: 10px; line-height: 1.7; }
.section-actions { display: flex; align-items: center; gap: 10px; }
.profile-edit { display: inline-flex; align-items: center; gap: 4px; padding: 0; margin-top: 6px; color: #7d9285; font-size: 10px; cursor: pointer; background: none; border: 0; }
.profile-edit:hover { color: #2a6854; }
.profile-modal { width: 560px; max-height: 88vh; overflow-y: auto; }
.profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
</style>
