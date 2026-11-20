<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { diffLines } from 'diff';
import {
  NButton, NInput, NInputNumber, NPopover, NSelect, NSpin, NTabPane, NTabs, NTooltip,
} from 'naive-ui';
import {
  AlertCircle, AlignLeft, ArrowLeft, Bold, Check, CheckCheck, ChevronRight, Cloud,
  ChevronDown, Download, FileClock, Heading2, History, Italic, List, ListOrdered, LoaderCircle, Lock,
  Maximize2, Minimize2, Plus, Quote, Redo2, RotateCcw, ScanSearch, Sparkles, Square, Strikethrough,
  Type, Undo2, Unlock, WandSparkles, X,
} from 'lucide-vue-next';
import type { AiChunk, AiDone, AiFailure, Chapter, ConsistencyIssue, ContinuityScore, PromptTemplate, SnapshotInfo } from '../../shared/models';
import { stripMarkdown } from '../../shared/utils/countVisibleChars';
import { formatManuscript } from '../../shared/utils/manuscript';
import { extractDynamicPromptVariables } from '../../shared/utils/promptVars';
import { useAppStore } from '../stores/app';
import { usePromptStore } from '../stores/prompts';
import { countText, createRequestId, dialog, formatDate, message, reportError, unwrap } from '../utils/api';
import CardAutoFill from '../components/CardAutoFill.vue';
import ConsistencyDrawer from '../components/ConsistencyDrawer.vue';
import ExportDialog from '../components/ExportDialog.vue';
import PromptPickerDialog from '../components/PromptPickerDialog.vue';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type AiStatus = 'idle' | 'streaming' | 'done' | 'error';
type AiScene = 'continue' | 'polish' | 'deai';
type MarkdownStorage = { markdown: { getMarkdown: () => string } };
type AiTarget = {
  chapterId: string;
  originalContent: string;
  mode: 'append' | 'document' | 'selection';
  from: number;
  to: number;
  selectedText: string;
  scene: AiScene;
  templateId: string;
};

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const promptStore = usePromptStore();
const workId = computed(() => String(route.params.workId));
const chapterId = computed(() => String(route.params.chapterId));
const chapter = ref<Chapter | null>(null);
const title = ref('');
const loadedContent = ref('');
const localWords = ref(0);
const loadingChapter = ref(true);
const loadError = ref('');
const dirty = ref(false);
const saveState = ref<SaveState>('saved');
const focusMode = ref(false);
const showExport = ref(false);
const showConsistency = ref(false);
const snapshots = ref<SnapshotInfo[]>([]);
const loadingSnapshots = ref(false);
const creatingSnapshot = ref(false);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let activeSave: Promise<boolean> | null = null;

const aiScene = ref<AiScene>('continue');
const targetChars = ref(800);
const strategy = ref<'natural' | 'short' | 'colloquial' | 'voice'>('natural');
const aiInstruction = ref('');
const selectedCardIds = ref<string[]>([]);
const templateId = ref<string | null>(null);
const candidate = ref('');
const aiStatus = ref<AiStatus>('idle');
const aiError = ref('');
const acceptBusy = ref(false);
const rollbackBusy = ref(false);
const lockBusy = ref(false);
const continuity = ref<ContinuityScore | null>(null);
const currentRequestId = ref('');
const aiTarget = ref<AiTarget | null>(null);
const preservedPartial = ref('');
const selectionText = ref('');
const removingListeners: Array<() => void> = [];
const aiSceneOptions = [
  { label: '续写正文', value: 'continue' }, { label: '润色全文', value: 'polish' }, { label: '自然化改写', value: 'deai' },
];
const strategyOptions = [
  { label: '自然流畅', value: 'natural' }, { label: '简洁凝练', value: 'short' },
  { label: '口语生动', value: 'colloquial' }, { label: '贴近原文声线', value: 'voice' },
];
const cardOptions = computed(() => store.cards.filter((card) => !card.deprecatedAt).map((card) => ({ label: card.title, value: card.cardId })));
const showPromptPicker = ref(false);
const showCardAutoFill = ref(false);
const selectedTemplate = computed(() => promptStore.templates.find((template) => template.templateId === templateId.value) ?? null);
const selectedTemplateName = computed(() => selectedTemplate.value?.name || '使用系统默认模板');
const dynamicVarNames = computed(() => (selectedTemplate.value ? extractDynamicPromptVariables(selectedTemplate.value.content) : []));
const dynamicValues = reactive<Record<string, string>>({});
watch(dynamicVarNames, (names) => {
  for (const name of names) if (dynamicValues[name] === undefined) dynamicValues[name] = '';
  for (const key of Object.keys(dynamicValues)) if (!names.includes(key)) delete dynamicValues[key];
}, { immediate: true });
const PROMPT_PICKS_KEY = 'inkforge.prompt-picks';

function readPromptPicks(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PROMPT_PICKS_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

/** 记住每个场景最后选择的提示词，下次进入自动沿用。 */
function rememberPromptPick(templateIdValue: string, scene: PromptTemplate['scene']): void {
  const picks = readPromptPicks();
  picks[scene] = templateIdValue;
  localStorage.setItem(PROMPT_PICKS_KEY, JSON.stringify(picks));
}

function restorePromptPick(scene: AiScene): void {
  const picked = readPromptPicks()[scene];
  templateId.value = picked && promptStore.templates.some((template) => template.templateId === picked && template.scene === scene) ? picked : null;
}

function selectPrompt(template: PromptTemplate): void {
  templateId.value = template.templateId;
  rememberPromptPick(template.templateId, template.scene);
}
const proposedContent = computed(() => {
  if (aiTarget.value?.mode !== 'append') return candidate.value;
  const original = getMarkdown().trimEnd();
  if (!original) return candidate.value;
  return `${original}\n\n${candidate.value.trimStart()}`;
});
const diffOriginal = computed(() => aiTarget.value?.mode === 'selection' ? aiTarget.value.selectedText : getMarkdown());
const diffParts = computed(() => diffLines(diffOriginal.value, proposedContent.value));
const exportChapters = computed(() => chapter.value ? [{ chapterId: chapter.value.chapterId, title: title.value }] : []);
const saveLabel = computed(() => ({ saved: '所有更改已保存', dirty: '有未保存更改', saving: '正在保存…', error: '保存失败，请重试' })[saveState.value]);
const sceneName = computed(() => {
  const scene = aiTarget.value?.scene ?? aiScene.value;
  if (aiTarget.value?.mode === 'selection') return scene === 'polish' ? '选区润色' : '选区自然化';
  return aiSceneOptions.find((option) => option.value === scene)?.label || 'AI 生成';
});
const candidateHint = computed(() => {
  if (aiTarget.value?.mode === 'selection') return '仅替换生成时的原选区';
  return aiTarget.value?.mode === 'append' ? '续写将追加到正文末尾' : '候选全文将替换当前正文';
});
const isLocked = computed(() => chapter.value?.locked === true);

type EditorTheme = 'paper' | 'sepia' | 'green' | 'night';
const EDITOR_PREFS_KEY = 'inkforge.editor-prefs';
const editorPrefs = reactive<{ fontFamily: 'system' | 'song' | 'kai' | 'hei'; fontSize: number; theme: EditorTheme }>({
  fontFamily: 'system', fontSize: 15, theme: 'paper',
});
const editorFontOptions = [
  { label: '系统默认', value: 'system' }, { label: '宋体', value: 'song' },
  { label: '楷体', value: 'kai' }, { label: '黑体', value: 'hei' },
];
const editorThemeOptions: Array<{ label: string; value: EditorTheme; color: string }> = [
  { label: '纸白', value: 'paper', color: '#fffefb' },
  { label: '米黄', value: 'sepia', color: '#f7efdf' },
  { label: '护眼绿', value: 'green', color: '#e7f0e4' },
  { label: '夜间', value: 'night', color: '#202823' },
];
const themePalette: Record<EditorTheme, { bg: string; color: string; heading: string }> = {
  paper: { bg: '#fffefb', color: '#34463e', heading: '#263f35' },
  sepia: { bg: '#f7efdf', color: '#4a4031', heading: '#3a3124' },
  green: { bg: '#e7f0e4', color: '#33463a', heading: '#21382c' },
  night: { bg: '#202823', color: '#c6d2ca', heading: '#e2ebe5' },
};
const fontStacks: Record<string, string> = {
  system: '"PingFang SC", "Microsoft YaHei", sans-serif',
  song: '"STSong", "SimSun", serif',
  kai: '"KaiTi", "STKaiti", serif',
  hei: '"Microsoft YaHei", "PingFang SC", sans-serif',
};
const editorThemeStyle = computed<Record<string, string>>(() => {
  const palette = themePalette[editorPrefs.theme] ?? themePalette.paper;
  const size = Math.min(22, Math.max(13, Number(editorPrefs.fontSize) || 15));
  return {
    '--editor-font': fontStacks[editorPrefs.fontFamily] ?? fontStacks.system,
    '--editor-size': `${size}px`,
    '--editor-bg': palette.bg,
    '--editor-color': palette.color,
    '--editor-heading': palette.heading,
  };
});

onMounted(() => {
  try {
    const raw = localStorage.getItem(EDITOR_PREFS_KEY);
    if (raw) Object.assign(editorPrefs, JSON.parse(raw));
  } catch {
    // 本地偏好损坏时使用默认值
  }
});
watch(editorPrefs, () => {
  try {
    localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify(editorPrefs));
  } catch {
    // 存储不可用时只在本次会话生效
  }
}, { deep: true });

function formatCurrentChapter(): void {
  if (!editor.value || isLocked.value) return;
  const before = getMarkdown();
  const after = formatManuscript(before);
  if (after === before) {
    message.info('当前章节的排版已经整齐');
    return;
  }
  editor.value.commands.setContent(after, false);
  localWords.value = countText(after);
  markDirty();
  message.success('已整理正文空白与缩进，可继续编辑');
}

function createEditorExtensions() {
  return [StarterKit, Markdown.configure({ html: false, transformPastedText: true })];
}

function editorMarkdown(currentEditor: Editor): string {
  return (currentEditor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
}

const editor = useEditor({
  content: '',
  extensions: createEditorExtensions(),
  editorProps: { attributes: { class: 'ink-editor-content', 'aria-label': '章节正文' } },
  onUpdate: ({ editor: currentEditor }) => {
    if (loadingChapter.value) return;
    const content = editorMarkdown(currentEditor);
    localWords.value = countText(content);
    markDirty();
    void persistDraft(content);
  },
  onSelectionUpdate: ({ editor: currentEditor }) => {
    const { from, to } = currentEditor.state.selection;
    selectionText.value = currentEditor.state.doc.textBetween(from, to, '\n', '\n');
  },
});

function getMarkdown(): string {
  return editor.value ? editorMarkdown(editor.value) : loadedContent.value;
}

function syncEditorEditable(): void {
  editor.value?.setEditable(!loadingChapter.value && !acceptBusy.value && !rollbackBusy.value && !loadError.value && !isLocked.value);
}

function clearSaveTimers(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (maxTimer) clearTimeout(maxTimer);
  debounceTimer = null;
  maxTimer = null;
}

function markDirty(): void {
  if (!chapter.value) return;
  dirty.value = true;
  saveState.value = 'dirty';
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { void flush(); }, 2000);
  if (!maxTimer) maxTimer = setTimeout(() => { void flush(); }, 30000);
}

let draftErrorShown = false;
async function persistDraft(content: string): Promise<void> {
  const targetChapterId = chapter.value?.chapterId;
  if (!targetChapterId) return;
  try {
    unwrap(await window.inkforge.chapter.saveDraft({ workId: workId.value, chapterId: targetChapterId, content }));
    draftErrorShown = false;
  } catch (error) {
    if (chapter.value?.chapterId !== targetChapterId || !dirty.value) return;
    saveState.value = 'error';
    if (!draftErrorShown) reportError(error);
    draftErrorShown = true;
  }
}

async function flush(): Promise<boolean> {
  if (activeSave) await activeSave;
  if (!chapter.value || !dirty.value || isLocked.value) return true;
  clearSaveTimers();
  const targetChapterId = chapter.value.chapterId;
  const content = getMarkdown();
  const baseRevision = chapter.value.revision;
  saveState.value = 'saving';
  const request = (async (): Promise<boolean> => {
    try {
      const result = unwrap(await window.inkforge.chapter.save({
        workId: workId.value, chapterId: targetChapterId, content, baseRevision, reason: 'autosave',
      }));
      if (chapter.value?.chapterId === targetChapterId) {
        chapter.value = result.chapter;
        localWords.value = result.chapter.wordCount;
        if (getMarkdown() === content) {
          loadedContent.value = result.content;
          dirty.value = false;
          saveState.value = 'saved';
        } else {
          localWords.value = countText(getMarkdown());
          dirty.value = true;
          saveState.value = 'dirty';
          markDirty();
        }
      }
      return true;
    } catch (error) {
      if (chapter.value?.chapterId === targetChapterId) {
        dirty.value = true;
        saveState.value = 'error';
      }
      reportError(error);
      return false;
    }
  })();
  activeSave = request;
  const result = await request;
  if (activeSave === request) activeSave = null;
  return result;
}

async function manualSave(): Promise<void> {
  if (isLocked.value) { message.warning('章节已锁定，请先解锁'); return; }
  if (!dirty.value) { message.info('当前内容已保存'); return; }
  if (await flush()) message.success('章节已保存');
}

async function toggleLock(): Promise<void> {
  if (!chapter.value || lockBusy.value) return;
  const next = !isLocked.value;
  if (next && !(await flush())) return;
  lockBusy.value = true;
  try {
    const result = await store.setChapterLock({ workId: workId.value, chapterId: chapter.value.chapterId, locked: next });
    if (!result) return;
    chapter.value = result.chapter;
    if (next) {
      dirty.value = false;
      saveState.value = 'saved';
      clearSaveTimers();
      resetAi();
      message.success(result.created.length ? `章节已锁定，并收录人物：${result.created.join('、')}` : '章节已锁定');
    } else {
      message.success('章节已解锁，可继续修改');
    }
    await loadSnapshots();
  } finally {
    lockBusy.value = false;
    syncEditorEditable();
  }
}

async function loadChapter(id: string): Promise<void> {
  loadingChapter.value = true;
  loadError.value = '';
  chapter.value = null;
  title.value = '';
  loadedContent.value = '';
  dirty.value = false;
  editor.value?.commands.setContent('', false);
  preservedPartial.value = '';
  selectionText.value = '';
  resetAi();
  clearSaveTimers();
  syncEditorEditable();
  try {
    const result = unwrap(await window.inkforge.chapter.get(workId.value, id));
    if (chapterId.value !== id) return;
    chapter.value = result.chapter;
    title.value = result.chapter.title;
    loadedContent.value = result.content;
    localWords.value = result.chapter.wordCount;
    selectedCardIds.value = store.pinnedCards.map((card) => card.cardId);
    editor.value?.commands.setContent(result.content || '', false);
    dirty.value = false;
    saveState.value = 'saved';
    await nextTick();
    loadingChapter.value = false;
    syncEditorEditable();
    await loadSnapshots();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '章节载入失败';
    loadingChapter.value = false;
    syncEditorEditable();
    reportError(error);
  }
}

async function saveTitle(): Promise<void> {
  if (isLocked.value) {
    if (chapter.value) title.value = chapter.value.title;
    message.warning('章节已锁定，请先解锁再修改标题');
    return;
  }
  if (!chapter.value || !title.value.trim() || title.value.trim() === chapter.value.title) {
    if (chapter.value) title.value = chapter.value.title;
    return;
  }
  const result = await store.updateOutline(workId.value, chapter.value.nodeId, { title: title.value.trim() });
  if (result) {
    chapter.value.title = result.title;
    title.value = result.title;
    message.success('章节标题已更新');
  }
}

function captureAiTarget(originalContent: string): AiTarget | null {
  if (!chapter.value || !editor.value) return null;
  const { from, to } = editor.value.state.selection;
  const selectedText = aiScene.value === 'continue' ? '' : editor.value.state.doc.textBetween(from, to, '\n', '\n');
  return {
    chapterId: chapter.value.chapterId,
    originalContent,
    mode: aiScene.value === 'continue' ? 'append' : selectedText.trim() ? 'selection' : 'document',
    from, to, selectedText,
    scene: aiScene.value,
    templateId: templateId.value || `builtin-${aiScene.value}`,
  };
}

function startAi(): Promise<void> {
  if (candidate.value && (aiStatus.value === 'error' || aiStatus.value === 'done')) return requestRetry();
  return generateAi();
}

function requestRetry(): Promise<void> {
  if (!candidate.value) return generateAi();
  dialog.warning({
    title: '如何处理已生成的片段？',
    content: '重试会使用发起本次请求时的原始章节上下文整体重来，不会从断点续接。你可以先保留当前片段，或丢弃后再试。',
    positiveText: '丢弃后整体重试',
    negativeText: '保留片段并重试',
    onPositiveClick: () => { void generateAi(); },
    onNegativeClick: () => {
      preservedPartial.value = candidate.value;
      message.success('片段已保留在草稿区，不会写入正文');
      void generateAi();
    },
  });
  return Promise.resolve();
}

async function generateAi(): Promise<void> {
  if (!chapter.value || aiStatus.value === 'streaming') return;
  if (isLocked.value) {
    message.warning('章节已锁定，请先解锁后再使用 AI');
    return;
  }
  if (!store.activeProvider) {
    message.warning('尚未配置可用的模型服务，请先完成设置');
    await router.push('/settings');
    return;
  }
  if (!(await flush())) return;
  if (!getMarkdown().trim() && aiScene.value !== 'continue') {
    message.warning('请先写入正文，再进行润色或自然化改写');
    return;
  }
  const originalContent = getMarkdown();
  const retryTarget = candidate.value && aiTarget.value?.chapterId === chapter.value.chapterId ? aiTarget.value : null;
  if (retryTarget && retryTarget.originalContent !== originalContent) {
    aiStatus.value = 'error';
    aiError.value = '正文在本次生成后已变化，不能按原上下文安全重试。请保留片段并放弃当前候选，再重新发起生成。';
    return;
  }
  const target = retryTarget ?? captureAiTarget(originalContent);
  if (!target) return;
  target.scene = aiScene.value;
  target.templateId = templateId.value || `builtin-${aiScene.value}`;
  aiTarget.value = target;
  candidate.value = '';
  aiError.value = '';
  continuity.value = null;
  aiStatus.value = 'streaming';
  const requestId = createRequestId();
  currentRequestId.value = requestId;
  try {
    const result = await window.inkforge.ai.start({
      requestId, workId: workId.value, chapterId: target.chapterId,
      scene: target.scene, cardIds: [...selectedCardIds.value],
      templateId: target.templateId, targetChars: targetChars.value,
      selectedText: target.mode === 'selection' ? target.selectedText : undefined,
      baseRevision: chapter.value.revision, strategy: strategy.value,
      instruction: aiInstruction.value.trim() || undefined,
      variables: dynamicVarNames.value.length ? { ...dynamicValues } : undefined,
    });
    if (currentRequestId.value !== requestId) return;
    if (result.code !== 0) {
      aiStatus.value = 'error';
      aiError.value = result.message || '生成失败，请稍后重试';
      return;
    }
    handleAiDone(result.data);
  } catch (error) {
    if (currentRequestId.value !== requestId) return;
    aiStatus.value = 'error';
    aiError.value = error instanceof Error ? error.message : '生成失败，请稍后重试';
  }
}

function buildSelectionReplacement(target: AiTarget): string | null {
  if (!editor.value || getMarkdown() !== target.originalContent) return null;
  if (target.to > editor.value.state.doc.content.size) return null;
  const selectedText = editor.value.state.doc.textBetween(target.from, target.to, '\n', '\n');
  if (selectedText !== target.selectedText) return null;
  const candidateEditor = new Editor({ extensions: createEditorExtensions(), content: candidate.value });
  const replacement = candidateEditor.getJSON().content ?? [];
  candidateEditor.destroy();
  const previewEditor = new Editor({ extensions: createEditorExtensions(), content: editor.value.getJSON() });
  try {
    if (!previewEditor.commands.insertContentAt({ from: target.from, to: target.to }, replacement)) return null;
    return editorMarkdown(previewEditor);
  } finally {
    previewEditor.destroy();
  }
}

function handleAiChunk(event: AiChunk): void {
  if (event.requestId !== currentRequestId.value || aiStatus.value !== 'streaming') return;
  candidate.value += event.delta;
}

function handleAiDone(event: AiDone): void {
  if (event.requestId !== currentRequestId.value) return;
  candidate.value = event.text || candidate.value;
  continuity.value = event.continuity ?? null;
  if (!candidate.value.trim()) {
    aiStatus.value = 'error';
    aiError.value = '模型返回了空内容，请调整模板或目标字数后重试';
  } else {
    aiStatus.value = 'done';
  }
}

function handleAiError(event: AiFailure): void {
  if (event.requestId !== currentRequestId.value) return;
  aiStatus.value = 'error';
  aiError.value = event.message || '生成失败，请稍后重试';
}

async function stopAi(): Promise<void> {
  if (!currentRequestId.value) return;
  const requestId = currentRequestId.value;
  currentRequestId.value = '';
  try {
    unwrap(await window.inkforge.ai.abort(requestId));
    aiStatus.value = candidate.value ? 'error' : 'idle';
    aiError.value = candidate.value ? '生成已停止。当前片段不会直接采纳；可保留片段后按原始上下文整体重试。' : '';
    message.info(candidate.value ? '已停止生成，片段可保留后整体重试' : '已停止生成');
  } catch (error) {
    reportError(error);
  }
}

function resetAi(): void {
  if (currentRequestId.value) void window.inkforge.ai.abort(currentRequestId.value).catch(() => undefined);
  currentRequestId.value = '';
  aiTarget.value = null;
  candidate.value = '';
  aiStatus.value = 'idle';
  aiError.value = '';
  continuity.value = null;
}

async function acceptCandidate(): Promise<void> {
  if (!chapter.value || !candidate.value.trim() || acceptBusy.value) return;
  const target = aiTarget.value;
  if (!target || target.chapterId !== chapter.value.chapterId || target.originalContent !== getMarkdown()) {
    aiError.value = '正文或原选区已变化，已阻止采纳以避免误替换。请保留候选后重新生成。';
    return;
  }
  if (!(await flush())) return;
  if (target.originalContent !== getMarkdown()) {
    aiError.value = '正文在保存期间发生变化，已阻止采纳。请重新生成候选。';
    return;
  }
  const targetChapterId = chapter.value.chapterId;
  const nextContent = target.mode === 'selection' ? buildSelectionReplacement(target) : proposedContent.value;
  if (nextContent === null) {
    aiError.value = '无法确认原选区的位置和文本，已阻止采纳，正文保持不变。';
    return;
  }
  acceptBusy.value = true;
  aiError.value = '';
  syncEditorEditable();
  try {
    const result = unwrap(await window.inkforge.chapter.save({
      workId: workId.value, chapterId: targetChapterId, content: nextContent,
      baseRevision: chapter.value.revision, reason: 'ai', createSnapshot: true,
      aiScene: target.scene, templateId: target.templateId,
      diffType: target.mode,
    }));
    if (chapter.value?.chapterId !== targetChapterId || chapterId.value !== targetChapterId) {
      message.success('候选内容已保存到原章节，并已创建快照');
      return;
    }
    const changedDuringSave = getMarkdown() !== target.originalContent;
    chapter.value = result.chapter;
    loadedContent.value = result.content;
    if (changedDuringSave) {
      localWords.value = countText(getMarkdown());
      dirty.value = true;
      saveState.value = 'dirty';
      markDirty();
    } else {
      localWords.value = result.chapter.wordCount;
      editor.value?.commands.setContent(result.content, false);
      dirty.value = false;
      saveState.value = 'saved';
      clearSaveTimers();
    }
    candidate.value = '';
    aiTarget.value = null;
    aiStatus.value = 'idle';
    currentRequestId.value = '';
    message.success(changedDuringSave ? '候选已采纳；你同时输入的内容已保留，将另行自动保存' : '候选内容已采纳，并已创建快照');
    await loadSnapshots();
  } catch (error) {
    aiError.value = '候选内容采纳失败，正文保持不变。请刷新章节后重试。';
    reportError(error);
  } finally {
    acceptBusy.value = false;
    syncEditorEditable();
  }
}

async function loadSnapshots(): Promise<void> {
  if (!chapter.value) return;
  loadingSnapshots.value = true;
  try {
    snapshots.value = unwrap(await window.inkforge.snapshot.list(workId.value, chapter.value.chapterId));
  } catch (error) {
    reportError(error);
  } finally {
    loadingSnapshots.value = false;
  }
}

async function createSnapshot(): Promise<void> {
  if (!chapter.value || !(await flush())) return;
  creatingSnapshot.value = true;
  try {
    const snapshot = unwrap(await window.inkforge.snapshot.create(workId.value, chapter.value.chapterId));
    snapshots.value.unshift(snapshot);
    message.success('手动快照已创建');
  } catch (error) {
    reportError(error);
  } finally {
    creatingSnapshot.value = false;
  }
}

function rollback(snapshot: SnapshotInfo): void {
  dialog.warning({
    title: '回滚到这个历史版本？',
    content: `将恢复到 ${formatDate(snapshot.createdAt)} 的 ${snapshot.wordCount} 字版本。建议先为当前内容创建快照。`,
    positiveText: '确认回滚', negativeText: '取消',
    onPositiveClick: async () => {
      if (!chapter.value || !(await flush())) return false;
      if (rollbackBusy.value) return false;
      const targetChapterId = chapter.value.chapterId;
      const contentBeforeRollback = getMarkdown();
      rollbackBusy.value = true;
      syncEditorEditable();
      try {
        const result = unwrap(await window.inkforge.snapshot.rollback(workId.value, targetChapterId, snapshot.snapshotId));
        if (chapter.value?.chapterId !== targetChapterId || chapterId.value !== targetChapterId) {
          message.success('原章节已回滚到所选版本');
          return true;
        }
        const changedDuringRollback = getMarkdown() !== contentBeforeRollback;
        chapter.value = result.chapter;
        loadedContent.value = result.content;
        if (changedDuringRollback) {
          localWords.value = countText(getMarkdown());
          dirty.value = true;
          saveState.value = 'dirty';
          markDirty();
        } else {
          localWords.value = result.chapter.wordCount;
          editor.value?.commands.setContent(result.content, false);
          dirty.value = false;
          saveState.value = 'saved';
        }
        resetAi();
        message.success(changedDuringRollback ? '已回滚；你同时输入的内容已保留，将另行自动保存' : '已回滚到所选版本');
        await loadSnapshots();
        return true;
      } catch (error) {
        reportError(error);
        return false;
      } finally {
        rollbackBusy.value = false;
        syncEditorEditable();
      }
    },
  });
}

function snapshotReason(reason: SnapshotInfo['reason']): string {
  return ({ pre_ai: 'AI 采纳前', accepted: 'AI 已采纳', manual: '手动快照', rollback: '回滚备份' })[reason];
}

async function openConsistency(): Promise<void> {
  if (await flush()) showConsistency.value = true;
}

async function openExport(): Promise<void> {
  if (await flush()) showExport.value = true;
}

function locateIssue(issue: ConsistencyIssue): void {
  if (!editor.value) return;
  const needle = stripMarkdown(issue.paragraph).trim();
  if (!needle) {
    message.warning('该问题没有可定位的正文段落');
    return;
  }
  const matchedRanges: Array<{ from: number; to: number }> = [];
  editor.value.state.doc.descendants((node, position) => {
    if (matchedRanges.length) return false;
    if (!node.isTextblock) return true;
    const text = node.textContent.trim();
    if (text && (text.includes(needle) || (text.length >= 8 && needle.includes(text)))) {
      matchedRanges.push({ from: position + 1, to: position + node.nodeSize - 1 });
    }
    return false;
  });
  const range = matchedRanges[0];
  if (!range) {
    message.warning('未在当前正文中找到该段落，正文可能已修改');
    return;
  }
  showConsistency.value = false;
  editor.value.chain().focus().setTextSelection(range).run();
  const { node } = editor.value.view.domAtPos(range.from);
  const element = node instanceof HTMLElement ? node : node.parentElement;
  element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

watch(chapterId, (id) => { void loadChapter(id); }, { immediate: true });
watch(aiScene, () => { restorePromptPick(aiScene.value); preservedPartial.value = ''; resetAi(); });
watch(() => store.activeWorkId, () => { selectedCardIds.value = store.pinnedCards.map((card) => card.cardId); });

async function initializePromptSelection(): Promise<void> {
  await promptStore.load();
  const promptParam = typeof route.query.prompt === 'string' ? route.query.prompt : '';
  const template = promptParam ? promptStore.templates.find((item) => item.templateId === promptParam) : null;
  if (template && ['continue', 'polish', 'deai'].includes(template.scene)) {
    aiScene.value = template.scene as AiScene;
    templateId.value = template.templateId;
    rememberPromptPick(template.templateId, template.scene);
    const query = { ...route.query };
    delete query.prompt;
    void router.replace({ query });
    return;
  }
  restorePromptPick(aiScene.value);
}

onMounted(() => {
  void initializePromptSelection();
  if (store.activeWorkId !== workId.value || !store.cards.length) void store.activateWork(workId.value);
  removingListeners.push(
    window.inkforge.ai.onChunk(handleAiChunk),
    window.inkforge.ai.onDone(handleAiDone),
    window.inkforge.ai.onError(handleAiError),
  );
  window.addEventListener('beforeunload', beforeUnload);
  window.addEventListener('inkforge:before-quit', beforeAppQuit);
  window.addEventListener('keydown', keyboardSave);
});

function beforeUnload(): void { void flush(); }
function beforeAppQuit(): void {
  void flush().then(async (saved) => {
    if (!saved) message.error('章节尚未保存，已取消退出。请处理保存冲突后重试');
    await window.inkforge.app.flushComplete(saved);
  }).catch(reportError);
}
function keyboardSave(event: KeyboardEvent): void {
  if (event.key === 'Escape' && focusMode.value) {
    focusMode.value = false;
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void manualSave();
  }
}

onBeforeRouteUpdate(async (to, from) => {
  if (to.params.chapterId === from.params.chapterId) return true;
  resetAi();
  return await flush();
});

onBeforeRouteLeave(async () => {
  resetAi();
  return await flush();
});

onBeforeUnmount(() => {
  clearSaveTimers();
  removingListeners.forEach((remove) => remove());
  window.removeEventListener('beforeunload', beforeUnload);
  window.removeEventListener('inkforge:before-quit', beforeAppQuit);
  window.removeEventListener('keydown', keyboardSave);
  resetAi();
  void flush();
});
</script>

<template>
  <div class="editor-page" :class="{ 'focus-mode': focusMode }">
    <header class="editor-header">
      <div class="editor-chapter-heading"><n-tooltip><template #trigger><button class="editor-back" @click="router.push(`/work/${workId}`)"><arrow-left :size="18" /></button></template>返回作品空间</n-tooltip><div><div class="editor-breadcrumb"><span>{{ store.activeWork?.title || '作品空间' }}</span><chevron-right :size="11" /><span>正文写作</span></div><n-input v-model:value="title" class="chapter-title-input" placeholder="未命名章节" :bordered="false" :disabled="loadingChapter || !!loadError || isLocked" @blur="saveTitle" @keydown.enter="($event.target as HTMLInputElement).blur()" /></div></div>
      <div class="editor-header-actions"><div class="save-indicator" :class="saveState"><loader-circle v-if="saveState === 'saving'" :size="14" class="spinning" /><alert-circle v-else-if="saveState === 'error'" :size="14" /><check v-else-if="saveState === 'saved'" :size="14" /><cloud v-else :size="14" /><span>{{ saveLabel }}</span></div><n-tooltip><template #trigger><n-button size="small" secondary class="focus-toggle" @click="focusMode = !focusMode"><template #icon><minimize2 v-if="focusMode" :size="15" /><maximize2 v-else :size="15" /></template>{{ focusMode ? '退出专注' : '专注写作' }}</n-button></template>{{ focusMode ? '按 Esc 退出专注写作' : '隐藏右侧助手，把编辑区留给正文' }}</n-tooltip><n-button size="small" secondary :type="isLocked ? 'warning' : 'default'" :loading="lockBusy" :disabled="!chapter" @click="toggleLock"><template #icon><unlock v-if="isLocked" :size="15" /><lock v-else :size="15" /></template>{{ isLocked ? '解锁' : '锁定' }}</n-button><n-button size="small" secondary :disabled="!chapter" @click="openConsistency"><template #icon><scan-search :size="15" /></template>一致性检查</n-button><n-button size="small" secondary :disabled="!chapter" @click="openExport"><template #icon><download :size="15" /></template>导出本章</n-button></div>
    </header>

    <div v-if="isLocked" class="locked-banner"><lock :size="15" /><div><strong>本章已锁定</strong><span>正文与标题保持只读，自动保存和 AI 生成已停用；解锁后可继续修改。</span></div></div>

    <div class="editor-workspace">
      <section class="writing-column paper-card" :style="editorThemeStyle">
        <div class="editor-toolbar"><div class="format-tools"><n-tooltip><template #trigger><button :class="{ active: editor?.isActive('bold') }" :disabled="!editor || loadingChapter || isLocked" @click="editor?.chain().focus().toggleBold().run()"><bold :size="16" /></button></template>加粗</n-tooltip><n-tooltip><template #trigger><button :class="{ active: editor?.isActive('italic') }" :disabled="!editor || isLocked" @click="editor?.chain().focus().toggleItalic().run()"><italic :size="16" /></button></template>斜体</n-tooltip><n-tooltip><template #trigger><button :class="{ active: editor?.isActive('strike') }" :disabled="!editor || isLocked" @click="editor?.chain().focus().toggleStrike().run()"><strikethrough :size="16" /></button></template>删除线</n-tooltip><i /><n-tooltip><template #trigger><button :class="{ active: editor?.isActive('heading', { level: 2 }) }" :disabled="!editor || isLocked" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"><heading2 :size="17" /></button></template>二级标题</n-tooltip><n-tooltip><template #trigger><button :class="{ active: editor?.isActive('blockquote') }" :disabled="!editor || isLocked" @click="editor?.chain().focus().toggleBlockquote().run()"><quote :size="15" /></button></template>引用</n-tooltip><i /><n-tooltip><template #trigger><button :class="{ active: editor?.isActive('bulletList') }" :disabled="!editor || isLocked" @click="editor?.chain().focus().toggleBulletList().run()"><list :size="17" /></button></template>无序列表</n-tooltip><n-tooltip><template #trigger><button :class="{ active: editor?.isActive('orderedList') }" :disabled="!editor || isLocked" @click="editor?.chain().focus().toggleOrderedList().run()"><list-ordered :size="17" /></button></template>有序列表</n-tooltip><i /><n-tooltip><template #trigger><button aria-label="智能排版" :disabled="!editor || loadingChapter || isLocked" @click="formatCurrentChapter"><align-left :size="16" /></button></template>智能排版：清理行尾空格、全角缩进与多余空行</n-tooltip></div><div class="history-tools"><n-tooltip><template #trigger><button :disabled="!editor?.can().undo()" @click="editor?.chain().focus().undo().run()"><undo2 :size="15" /></button></template>撤销</n-tooltip><n-tooltip><template #trigger><button :disabled="!editor?.can().redo()" @click="editor?.chain().focus().redo().run()"><redo2 :size="15" /></button></template>重做</n-tooltip><n-popover trigger="click" placement="bottom-end" :show-arrow="false" style="width: 232px"><template #trigger><button title="阅读与字体设置"><type :size="15" /></button></template><div class="reading-settings"><label>正文字体</label><n-select v-model:value="editorPrefs.fontFamily" size="small" :options="editorFontOptions" /><label>正文字号</label><n-input-number v-model:value="editorPrefs.fontSize" size="small" :min="13" :max="22" :show-button="false"><template #suffix>px</template></n-input-number><label>纸张背景</label><div class="theme-swatches"><button v-for="theme in editorThemeOptions" :key="theme.value" :class="{ active: editorPrefs.theme === theme.value }" :style="{ background: theme.color }" :title="theme.label" @click="editorPrefs.theme = theme.value" /></div></div></n-popover></div></div>
        <n-spin :show="loadingChapter" class="chapter-loading-spin">
          <div v-if="loadError" class="editor-error"><alert-circle :size="30" /><h3>章节暂时无法载入</h3><p>{{ loadError }}</p><n-button type="primary" @click="loadChapter(chapterId)">重新载入</n-button></div>
          <editor-content v-else :editor="editor" class="editor-scroll" />
        </n-spin>
        <footer class="editor-statusbar"><div><span>{{ localWords }} 字</span><i /><span>Revision {{ chapter?.revision ?? '—' }}</span><i /><span>{{ chapter?.status === 'done' ? '已完成' : chapter?.status === 'writing' ? '写作中' : '草稿' }}</span></div><div><span>Ctrl + S 保存</span><span class="autosave-note">2 秒防抖 · 30 秒强制保存</span></div></footer>
      </section>

      <aside class="assistant-panel paper-card">
        <n-tabs type="line" animated size="small" class="assistant-tabs">
          <n-tab-pane name="ai" tab="AI 写作助手">
            <div class="assistant-scroll">
              <div class="ai-heading"><div class="ai-spark"><wand-sparkles :size="18" /></div><div><h3>让文字继续生长</h3><p>候选内容不会直接改动正文</p></div></div>
              <div v-if="!store.activeProvider" class="provider-warning"><alert-circle :size="15" /><span>尚未启用模型服务</span><button @click="router.push('/settings')">去设置</button></div>
              <label class="form-label">写作任务</label><n-select v-model:value="aiScene" :options="aiSceneOptions" :disabled="aiStatus === 'streaming'" />
              <div class="ai-form-grid"><div><label class="form-label">目标字数</label><n-input-number v-model:value="targetChars" :min="100" :max="8000" :step="100" :show-button="false" :disabled="aiStatus === 'streaming'"><template #suffix>字</template></n-input-number></div><div><label class="form-label">表达策略</label><n-select v-model:value="strategy" :options="strategyOptions" :disabled="aiStatus === 'streaming'" /></div></div>
              <label class="form-label">参考设定卡</label><n-select v-model:value="selectedCardIds" multiple filterable :options="cardOptions" placeholder="选择设定（可多选）" :disabled="aiStatus === 'streaming'" />
              <button type="button" class="asset-extract" :disabled="aiStatus === 'streaming'" @click="showCardAutoFill = true"><wand-sparkles :size="12" />从本章提取角色 / 场景 / 道具</button>
              <label class="form-label">提示词模板</label>
              <div class="prompt-pick-row"><button type="button" class="prompt-pick" :disabled="aiStatus === 'streaming'" @click="showPromptPicker = true"><sparkles :size="13" /><span>{{ selectedTemplateName }}</span><chevron-down :size="13" /></button><button v-if="templateId" type="button" class="prompt-clear" aria-label="使用系统默认模板" @click="templateId = null"><x :size="13" /></button></div>
              <div v-if="dynamicVarNames.length" class="prompt-vars"><p>该模板有 {{ dynamicVarNames.length }} 个参数需要填写，留空会按空值生成。</p><label v-for="name in dynamicVarNames" :key="name"><span>{{ name }}</span><n-input v-model:value="dynamicValues[name]" size="small" :placeholder="`填写${name}`" :disabled="aiStatus === 'streaming'" /></label></div>
              <label class="form-label">补充要求</label><n-input v-model:value="aiInstruction" type="textarea" :rows="3" maxlength="500" show-count :placeholder="aiScene === 'continue' ? '例如：加强雨夜的压抑感，结尾留一个悬念，不要引入新人物……' : '例如：只保留对话，压缩环境描写，保持原有叙事视角……'" :disabled="aiStatus === 'streaming'" />
              <p v-if="aiScene !== 'continue'" class="selection-hint">{{ selectionText.trim() ? `将处理当前选区（${countText(selectionText)} 字）` : '未选择文字时将处理全文' }}</p>
              <n-button type="primary" block class="generate-button" :loading="aiStatus === 'streaming' && !candidate" :disabled="!chapter || loadingChapter || aiStatus === 'streaming' || isLocked" @click="startAi"><template #icon><sparkles :size="16" /></template>{{ aiStatus === 'error' ? '重新生成' : '生成候选内容' }}</n-button>

              <section v-if="aiStatus !== 'idle' || candidate" class="candidate-section">
                <div class="candidate-header"><div><span class="candidate-dot" :class="aiStatus" /><strong>{{ sceneName }}候选</strong><small v-if="aiStatus === 'streaming'">正在流式生成</small><small v-else-if="aiStatus === 'done'">等待你审阅</small></div><button v-if="aiStatus === 'streaming'" title="停止生成" @click="stopAi"><square :size="13" fill="currentColor" /></button><button v-else title="放弃候选" @click="resetAi"><x :size="15" /></button></div>
                <div v-if="continuity && aiStatus === 'done'" class="continuity-tag" :class="{ low: continuity.score < 4 }">接力 {{ continuity.score }}/10 · {{ continuity.message }}</div>
                <div v-if="candidate" class="candidate-text" :class="{ streaming: aiStatus === 'streaming' }">{{ candidate }}<span v-if="aiStatus === 'streaming'" class="stream-cursor" /></div>
                <div v-else-if="aiStatus === 'streaming'" class="candidate-thinking"><span /><span /><span />正在理解章节与设定…</div>
                <div v-if="aiError" class="ai-error"><alert-circle :size="15" /><p>{{ aiError }}</p></div>
                <div v-if="aiStatus === 'error'" class="candidate-actions"><n-button size="small" secondary @click="requestRetry"><template #icon><rotate-ccw :size="13" /></template>重试</n-button><n-button size="small" quaternary @click="resetAi">放弃</n-button></div>
                <template v-if="aiStatus === 'done' && candidate">
                  <div class="diff-heading"><span>采纳差异预览</span><small>{{ candidateHint }}</small></div>
                  <div class="diff-view"><div v-for="(part, index) in diffParts" :key="index" :class="{ added: part.added, removed: part.removed }">{{ part.value }}</div></div>
                  <div class="candidate-actions"><n-button size="small" type="primary" :loading="acceptBusy" @click="acceptCandidate"><template #icon><check-check :size="14" /></template>采纳并保存</n-button><n-button size="small" secondary :disabled="acceptBusy" @click="requestRetry"><template #icon><rotate-ccw :size="13" /></template>重试</n-button><n-button size="small" quaternary :disabled="acceptBusy" @click="resetAi">放弃</n-button></div>
                </template>
              </section>
              <section v-if="preservedPartial" class="preserved-partial">
                <div><strong>已保留的草稿片段</strong><button @click="preservedPartial = ''">清除</button></div>
                <p>仅保留在这里，不会自动写入正文；整体重试不会续接此片段。</p>
                <pre>{{ preservedPartial }}</pre>
              </section>
              <div class="ai-disclosure"><sparkles :size="12" /><p>AI 内容可能存在事实偏差或表达雷同。采纳前请审阅；采纳成功时会自动创建快照。</p></div>
            </div>
          </n-tab-pane>
          <n-tab-pane name="history" tab="历史快照">
            <div class="assistant-scroll history-panel"><div class="history-heading"><div><h3>章节版本</h3><p>重要节点留档，安心尝试不同写法</p></div><n-button size="small" secondary :loading="creatingSnapshot" :disabled="!chapter" @click="createSnapshot"><template #icon><plus :size="13" /></template>新建快照</n-button></div><n-spin :show="loadingSnapshots"><div v-if="snapshots.length" class="snapshot-list"><article v-for="snapshot in snapshots" :key="snapshot.snapshotId"><div class="snapshot-icon"><file-clock :size="16" /></div><div><strong>{{ snapshotReason(snapshot.reason) }}</strong><span>{{ formatDate(snapshot.createdAt) }}</span><small>{{ snapshot.wordCount }} 字</small></div><n-tooltip><template #trigger><button :disabled="rollbackBusy" @click="rollback(snapshot)"><rotate-ccw :size="14" /></button></template>回滚到此版本</n-tooltip></article></div><div v-else class="snapshot-empty"><history :size="30" /><h3>还没有历史快照</h3><p>手动创建快照，或采纳一次 AI 候选内容后即可在此查看。</p></div></n-spin></div>
          </n-tab-pane>
        </n-tabs>
      </aside>
    </div>

    <ConsistencyDrawer v-model:show="showConsistency" :work-id="workId" :chapter-id="chapterId" :revision="chapter?.revision || 0" @locate="locateIssue" />
    <ExportDialog v-model:show="showExport" :work-id="workId" :chapter-id="chapterId" :chapters="exportChapters" />
    <PromptPickerDialog v-model:show="showPromptPicker" :scene="aiScene" :selected-id="templateId" @select="selectPrompt" />
    <CardAutoFill v-model:show="showCardAutoFill" :work-id="workId" :chapter-id="chapterId" :chapter-title="title" />
  </div>
</template>

<style scoped>
.editor-page { display: flex; height: 100%; min-height: 560px; flex-direction: column; padding: 15px 19px 17px; overflow: hidden; }.editor-header { display: flex; flex: 0 0 59px; align-items: flex-start; justify-content: space-between; gap: 15px; }.editor-chapter-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }.editor-back { display: grid; width: 32px; height: 32px; place-items: center; color: #74867b; cursor: pointer; background: #fff; border: 1px solid #dfe6df; border-radius: 7px; }.editor-back:hover { color: #2a6854; }.editor-breadcrumb { display: flex; align-items: center; gap: 4px; margin-bottom: 1px; color: #96a199; font-size: 9px; }.chapter-title-input { width: 350px; margin-left: -8px; font-size: 18px; font-weight: 600; }.chapter-title-input :deep(.n-input__input-el) { height: 28px; color: #2b4238; }.editor-header-actions { display: flex; align-items: center; gap: 8px; padding-top: 13px; }.save-indicator { display: flex; align-items: center; gap: 5px; margin-right: 4px; color: #718c7d; font-size: 9px; white-space: nowrap; }.save-indicator.dirty { color: #a47b41; }.save-indicator.error { color: #b64f4a; }.spinning { animation: spin 1s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }.editor-workspace { display: grid; flex: 1; grid-template-columns: minmax(0,1fr) 326px; gap: 13px; min-height: 0; }.writing-column { display: flex; min-width: 0; min-height: 0; flex-direction: column; overflow: hidden; }.editor-toolbar { display: flex; flex: 0 0 44px; align-items: center; justify-content: space-between; padding: 0 12px; background: #fbfcfa; border-bottom: 1px solid #e7ebe6; }.format-tools, .history-tools { display: flex; align-items: center; gap: 2px; }.format-tools > i { width: 1px; height: 16px; margin: 0 5px; background: #e0e6e0; }.format-tools button, .history-tools button { display: grid; width: 29px; height: 29px; place-items: center; color: #718078; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.format-tools button:hover, .history-tools button:hover, .format-tools button.active { color: #2c6c56; background: #eaf2ec; }.format-tools button:disabled, .history-tools button:disabled { cursor: default; opacity: .3; }.chapter-loading-spin { flex: 1; min-height: 0; }.chapter-loading-spin :deep(.n-spin-container), .chapter-loading-spin :deep(.n-spin-content) { height: 100%; min-height: 0; }.editor-scroll { height: 100%; overflow-y: auto; }.writing-column :deep(.ink-editor-content) { min-height: 100%; padding: 32px clamp(30px, 5vw, 68px) 100px; color: var(--editor-color, #34463e); caret-color: var(--editor-heading, #286550); background: var(--editor-bg, transparent); font-family: var(--editor-font, "PingFang SC", "Microsoft YaHei", sans-serif); font-size: var(--editor-size, 15px); line-height: 2.05; outline: none; }.writing-column :deep(.ink-editor-content p) { margin: 0 0 1.15em; }.writing-column :deep(.ink-editor-content h1), .writing-column :deep(.ink-editor-content h2), .writing-column :deep(.ink-editor-content h3) { margin: 1.6em 0 .7em; color: var(--editor-heading, #263f35); font-family: "STSong", "SimSun", serif; line-height: 1.5; }.writing-column :deep(.ink-editor-content h1) { font-size: 25px; }.writing-column :deep(.ink-editor-content h2) { font-size: 21px; }.writing-column :deep(.ink-editor-content h3) { font-size: 18px; }.writing-column :deep(.ink-editor-content blockquote) { padding: 4px 0 4px 16px; margin: 1.4em 0; color: #6c7f74; border-left: 3px solid #a6bdae; }.writing-column :deep(.ink-editor-content ul), .writing-column :deep(.ink-editor-content ol) { padding-left: 24px; }.writing-column :deep(.ink-editor-content strong) { color: var(--editor-heading, #263e34); }.writing-column :deep(.ink-editor-content p.is-editor-empty:first-child::before) { color: #b2bcb5; content: '从这里开始书写正文。你的文字将在停止输入后自动保存……'; float: left; height: 0; pointer-events: none; }.editor-statusbar { display: flex; flex: 0 0 31px; align-items: center; justify-content: space-between; padding: 0 14px; color: #99a49e; background: #fafbf9; border-top: 1px solid #e8ece7; font-size: 8px; }.editor-statusbar > div { display: flex; align-items: center; gap: 9px; }.editor-statusbar i { width: 1px; height: 8px; background: #dfe5df; }.autosave-note { color: #acb5af; }.editor-error { display: flex; height: 100%; min-height: 350px; flex-direction: column; align-items: center; justify-content: center; color: #a3635d; }.editor-error h3 { margin: 12px 0 7px; color: #5a665f; font-size: 14px; }.editor-error p { margin: 0 0 17px; color: #909b94; font-size: 11px; }.assistant-panel { min-width: 0; min-height: 0; overflow: hidden; }.assistant-tabs { height: 100%; }.assistant-tabs :deep(.n-tabs-nav) { padding: 0 15px; background: #fbfcfa; }.assistant-tabs :deep(.n-tabs-tab) { font-size: 11px; }.assistant-tabs :deep(.n-tabs-pane-wrapper), .assistant-tabs :deep(.n-tab-pane) { height: 100%; }.assistant-scroll { height: calc(100vh - 230px); max-height: 100%; padding: 15px; overflow-y: auto; }.ai-heading { display: flex; align-items: center; gap: 9px; margin-bottom: 15px; }.ai-spark { display: grid; width: 34px; height: 34px; place-items: center; color: #4e7b67; background: #eaf2ec; border-radius: 8px; }.ai-heading h3 { margin: 0 0 3px; color: #3a5146; font-size: 12px; }.ai-heading p { margin: 0; color: #9ba69f; font-size: 9px; }.provider-warning { display: flex; align-items: center; gap: 6px; padding: 8px; margin-bottom: 12px; color: #9d7541; background: #fff7e9; border-radius: 6px; font-size: 9px; }.provider-warning button { margin-left: auto; color: #88612c; cursor: pointer; background: none; border: 0; }.assistant-scroll .form-label { margin-top: 11px; font-size: 10px; }.ai-form-grid { display: grid; grid-template-columns: .85fr 1.15fr; gap: 9px; }.ai-form-grid .n-input-number { width: 100%; }.generate-button { margin-top: 15px; }.candidate-section { padding-top: 14px; margin-top: 15px; border-top: 1px solid #e6ebe6; }.candidate-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }.candidate-header > div { display: flex; align-items: center; gap: 5px; }.candidate-header strong { color: #4a6055; font-size: 10px; }.candidate-header small { color: #9ca7a0; font-size: 8px; }.candidate-dot { width: 5px; height: 5px; background: #6c9b82; border-radius: 50%; }.candidate-dot.streaming { animation: pulse 1.2s infinite; }.candidate-dot.error { background: #b9554e; }@keyframes pulse { 50% { opacity: .25; } }.candidate-header > button { display: grid; width: 25px; height: 24px; place-items: center; color: #8a9890; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.candidate-header > button:hover { color: #ad504b; background: #fbefed; }.candidate-text { max-height: 245px; padding: 11px; overflow-y: auto; color: #586a60; background: #f6f8f4; border: 1px solid #e6ebe5; border-radius: 7px; font-family: "STSong", "SimSun", serif; font-size: 11px; line-height: 1.9; white-space: pre-wrap; }.candidate-text.streaming { max-height: 180px; }.stream-cursor { display: inline-block; width: 1px; height: 13px; margin-left: 2px; vertical-align: middle; background: #36735c; animation: pulse .8s infinite; }.candidate-thinking { display: flex; align-items: center; gap: 4px; padding: 25px 10px; color: #95a199; font-size: 9px; }.candidate-thinking span { width: 4px; height: 4px; background: #81a18f; border-radius: 50%; animation: pulse 1s infinite; }.candidate-thinking span:nth-child(2) { animation-delay: .2s; }.candidate-thinking span:nth-child(3) { margin-right: 5px; animation-delay: .4s; }.diff-heading { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 6px; color: #75857b; font-size: 9px; }.diff-heading small { color: #a0aaa4; font-size: 7px; }.diff-view { max-height: 160px; overflow: auto; background: #fafbf9; border: 1px solid #e7ebe6; border-radius: 6px; font-family: "SFMono-Regular", Consolas, monospace; font-size: 8px; line-height: 1.6; }.diff-view > div { padding: 1px 7px; white-space: pre-wrap; }.diff-view .added { color: #31694f; background: #e8f4eb; }.diff-view .removed { color: #a4524c; background: #faece9; text-decoration: line-through; }.candidate-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }.ai-error { display: flex; gap: 6px; padding: 8px; margin-top: 8px; color: #ac554e; background: #fdf1ef; border-radius: 6px; }.ai-error p { margin: 0; font-size: 9px; line-height: 1.6; }.ai-disclosure { display: flex; align-items: flex-start; gap: 6px; padding-top: 14px; margin-top: 14px; color: #a1aba5; border-top: 1px solid #edf0ec; }.ai-disclosure p { margin: 0; font-size: 8px; line-height: 1.7; }.history-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; }.history-heading h3 { margin: 0 0 4px; color: #40574b; font-size: 12px; }.history-heading p { margin: 0; color: #9aa69e; font-size: 8px; }.snapshot-list article { display: flex; align-items: flex-start; gap: 8px; padding: 11px 0; border-bottom: 1px solid #edf0ec; }.snapshot-icon { display: grid; width: 29px; height: 30px; place-items: center; color: #708e7d; background: #edf3ee; border-radius: 6px; }.snapshot-list article > div:nth-child(2) { flex: 1; }.snapshot-list strong, .snapshot-list span, .snapshot-list small { display: block; }.snapshot-list strong { color: #52665b; font-size: 10px; }.snapshot-list span { margin-top: 4px; color: #97a39b; font-size: 8px; }.snapshot-list small { margin-top: 3px; color: #8b9b91; font-size: 8px; }.snapshot-list article > button { display: grid; width: 26px; height: 26px; place-items: center; color: #7c8e83; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.snapshot-list article > button:hover { color: #2f6d56; background: #eaf2ec; }.snapshot-empty { padding: 55px 10px; color: #8fa499; text-align: center; }.snapshot-empty h3 { margin: 10px 0 7px; color: #5a6d62; font-size: 12px; }.snapshot-empty p { margin: 0; color: #9aa69e; font-size: 9px; line-height: 1.8; }
.selection-hint { margin: 8px 0 0; color: #82968a; font-size: 9px; line-height: 1.6; }.locked-banner { display: flex; flex: 0 0 auto; align-items: center; gap: 9px; padding: 8px 12px; margin: -4px 0 8px; color: #8a6a2e; background: #fff8e6; border: 1px solid #efe0b8; border-radius: 7px; }.locked-banner strong, .locked-banner span { display: block; }.locked-banner strong { font-size: 10px; }.locked-banner span { margin-top: 2px; color: #a08a5b; font-size: 9px; }.continuity-tag { padding: 5px 8px; margin-bottom: 8px; color: #3f7259; background: #edf5ef; border-radius: 5px; font-size: 9px; }.continuity-tag.low { color: #9a6a2c; background: #fff6e5; }.preserved-partial { padding: 11px; margin-top: 14px; background: #faf8f1; border: 1px solid #e8e1cf; border-radius: 7px; }.preserved-partial > div { display: flex; align-items: center; justify-content: space-between; }.preserved-partial strong { color: #76694e; font-size: 10px; }.preserved-partial button { color: #9b8965; cursor: pointer; background: transparent; border: 0; font-size: 9px; }.preserved-partial p { margin: 5px 0 8px; color: #a09379; font-size: 8px; line-height: 1.6; }.preserved-partial pre { max-height: 150px; margin: 0; overflow: auto; color: #756c5b; font-family: "STSong", "SimSun", serif; font-size: 10px; line-height: 1.8; white-space: pre-wrap; }
@media (max-width: 1250px) { .editor-workspace { grid-template-columns: minmax(0,1fr) 304px; }.save-indicator span { display: none; }.editor-header-actions .n-button { padding: 0 10px; }.ink-editor-content { padding-right: 34px; padding-left: 34px; } }
.reading-settings { display: flex; flex-direction: column; gap: 8px; }
.prompt-pick-row { display: flex; align-items: center; gap: 6px; }
.prompt-pick { display: flex; flex: 1; align-items: center; gap: 7px; min-width: 0; padding: 8px 11px; color: #5d7467; font-size: 11px; text-align: left; cursor: pointer; background: #fbfcfa; border: 1px solid #e3eae2; border-radius: 7px; }
.prompt-pick:hover:not(:disabled) { border-color: #b9cdbe; background: #f7faf5; }
.prompt-pick:disabled { color: #a9b3ac; cursor: not-allowed; }
.prompt-pick span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prompt-pick svg:last-child { flex: 0 0 auto; color: #9aa89f; }
.prompt-clear { display: grid; flex: 0 0 27px; height: 27px; place-items: center; color: #97a49b; cursor: pointer; background: transparent; border: 1px solid transparent; border-radius: 6px; }
.prompt-clear:hover { color: #b0544d; background: #fbf1ef; }
.prompt-vars { display: flex; flex-direction: column; gap: 6px; padding: 9px 10px; margin-top: 7px; background: #fbfaf5; border: 1px solid #ece7da; border-radius: 7px; }
.prompt-vars p { margin: 0 0 1px; color: #9c8f76; font-size: 9px; line-height: 1.6; }
.prompt-vars label { display: flex; align-items: center; gap: 8px; }
.prompt-vars label span { width: 76px; overflow: hidden; color: #7d7361; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.prompt-vars label .n-input { flex: 1; }
.asset-extract { display: inline-flex; align-items: center; gap: 5px; align-self: flex-start; padding: 4px 8px; margin-top: 6px; color: #5d806b; cursor: pointer; background: #f3f7f1; border: 1px solid #e0e9df; border-radius: 5px; font-size: 9px; }
.asset-extract:hover { color: #2c6b55; border-color: #b7cdbf; }
.asset-extract:disabled { cursor: not-allowed; opacity: .55; }
.editor-page.focus-mode .assistant-panel { display: none; }
.editor-page.focus-mode .editor-workspace { grid-template-columns: minmax(0, 1fr); }
.editor-page.focus-mode .writing-column { max-width: 1080px; width: 100%; margin: 0 auto; }
.reading-settings label { margin-top: 3px; color: #6f8176; font-size: 10px; }
.reading-settings label:first-child { margin-top: 0; }
.theme-swatches { display: flex; gap: 8px; }
.theme-swatches button { width: 30px; height: 30px; cursor: pointer; border: 2px solid transparent; border-radius: 7px; box-shadow: inset 0 0 0 1px rgba(44, 70, 57, .12); }
.theme-swatches button.active { border-color: #2c6b56; }
</style>
