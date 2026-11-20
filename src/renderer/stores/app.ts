import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import type {
  AppInfo, Card, CardDraft, Chapter, ChapterLockResult, FormatWorkResult, GeneratedChapterDraft, MasterOutline, OutlineNode, OutlineSeason,
  OutlineSeasonDraft, OutlineVolumeDraft, ProviderInput, PublicProvider, SearchReplaceResult, Work, WorkspaceStats,
} from '../../shared/models';
import type {
  CardBatchInput, CardGenerateInput, CardInput, ChapterLockInput, DraftGenerateInput, OutlineInput, OutlineMoveInput,
  SearchReplaceInput, SeasonGenerateInput, WorkInput,
} from '../../shared/ipc';
import { reportError, unwrap } from '../utils/api';

export const useAppStore = defineStore('app', () => {
  const works = ref<Work[]>([]);
  const workGroups = ref<string[]>([]);
  const workspaceStats = ref<WorkspaceStats>({ totalWords: 0, writingDays: 0, streakDays: 0, works: [] });
  const activeWorkId = ref<string | null>(null);
  const outline = ref<OutlineNode[]>([]);
  const chapters = ref<Chapter[]>([]);
  const seasons = ref<OutlineSeason[]>([]);
  const masterOutline = ref<MasterOutline>({ content: '', updatedAt: '' });
  const cards = ref<Card[]>([]);
  const providers = ref<PublicProvider[]>([]);
  const appInfo = ref<AppInfo | null>(null);
  const loadingWorks = ref(false);
  const loadingWork = ref(false);
  const loadingProviders = ref(false);
  const showExportCompliance = ref(true);

  const activeWork = computed(() => works.value.find((work) => work.workId === activeWorkId.value) || null);
  const activeProvider = computed(() => providers.value.find((provider) => provider.isDefault) || null);
  const volumes = computed(() => outline.value
    .filter((node) => node.level === 1 && !node.deletedAt)
    .sort((a, b) => a.orderIndex - b.orderIndex));
  const pinnedCards = computed(() => cards.value.filter((card) => card.pinned && !card.deletedAt && !card.deprecatedAt));

  async function loadWorks(): Promise<void> {
    loadingWorks.value = true;
    try {
      works.value = unwrap(await window.inkforge.work.list());
    } catch (error) {
      reportError(error);
    } finally {
      loadingWorks.value = false;
    }
  }

  async function loadWorkspaceStats(): Promise<void> {
    try {
      workspaceStats.value = unwrap(await window.inkforge.work.stats());
    } catch (error) {
      reportError(error);
    }
  }

  async function loadProviders(): Promise<void> {
    loadingProviders.value = true;
    try {
      providers.value = unwrap(await window.inkforge.provider.list());
    } catch (error) {
      reportError(error);
    } finally {
      loadingProviders.value = false;
    }
  }

  async function loadInitial(): Promise<void> {
    const results = await Promise.allSettled([
      loadWorks(),
      loadProviders(),
      loadWorkspaceStats(),
      loadWorkGroups(),
      window.inkforge.app.getInfo().then((result) => { appInfo.value = unwrap(result); }),
      window.inkforge.provider.getCompliance().then((result) => { showExportCompliance.value = unwrap(result); }),
    ]);
    results.slice(3).forEach((result) => {
      if (result.status === 'rejected') reportError(result.reason);
    });
  }

  async function activateWork(workId: string): Promise<void> {
    activeWorkId.value = workId;
    loadingWork.value = true;
    try {
      const [outlineResult, cardResult, masterResult, chapterResult, seasonResult] = await Promise.all([
        window.inkforge.outline.list(workId),
        window.inkforge.card.list(workId),
        window.inkforge.outline.getMaster(workId),
        window.inkforge.chapter.list(workId),
        window.inkforge.outline.listSeasons(workId),
      ]);
      if (activeWorkId.value !== workId) return;
      outline.value = unwrap(outlineResult);
      cards.value = unwrap(cardResult);
      masterOutline.value = unwrap(masterResult);
      chapters.value = unwrap(chapterResult);
      seasons.value = unwrap(seasonResult);
    } catch (error) {
      if (activeWorkId.value === workId) {
        outline.value = [];
        cards.value = [];
        masterOutline.value = { content: '', updatedAt: '' };
        chapters.value = [];
        seasons.value = [];
      }
      reportError(error);
    } finally {
      if (activeWorkId.value === workId) loadingWork.value = false;
    }
  }

  async function loadWorkGroups(): Promise<void> {
    try {
      workGroups.value = unwrap(await window.inkforge.work.groups());
    } catch (error) {
      reportError(error);
    }
  }

  async function createWorkGroup(name: string): Promise<boolean> {
    try {
      workGroups.value = unwrap(await window.inkforge.work.createGroup(name));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function deleteWorkGroup(name: string): Promise<boolean> {
    try {
      workGroups.value = unwrap(await window.inkforge.work.deleteGroup(name));
      await loadWorks();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function createWork(input: WorkInput): Promise<Work | null> {    try {
      const work = unwrap(await window.inkforge.work.create(input));
      works.value.unshift(work);
      void loadWorkspaceStats();
      return work;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function updateWork(workId: string, input: Partial<WorkInput>): Promise<Work | null> {
    try {
      const work = unwrap(await window.inkforge.work.update(workId, input));
      const index = works.value.findIndex((item) => item.workId === workId);
      if (index >= 0) works.value[index] = work;
      return work;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function importWork(): Promise<Work | null> {
    try {
      const work = unwrap(await window.inkforge.work.import());
      if (!work) return null;
      works.value = [work, ...works.value];
      void loadWorkspaceStats();
      return work;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function deleteWork(workId: string): Promise<boolean> {
    try {
      unwrap(await window.inkforge.work.delete(workId));
      works.value = works.value.filter((work) => work.workId !== workId);
      if (activeWorkId.value === workId) activeWorkId.value = null;
      void loadWorkspaceStats();
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function createOutline(input: OutlineInput): Promise<OutlineNode | null> {
    try {
      const result = unwrap(await window.inkforge.outline.create(input));
      outline.value.push(result.node);
      return result.node;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function updateOutline(workId: string, nodeId: string, input: Partial<Pick<OutlineNode, 'title' | 'summary'>>): Promise<OutlineNode | null> {
    try {
      const node = unwrap(await window.inkforge.outline.update(workId, nodeId, input));
      const index = outline.value.findIndex((item) => item.nodeId === nodeId);
      if (index >= 0) outline.value[index] = node;
      return node;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function reorderOutline(workId: string, nodeIds: string[]): Promise<boolean> {
    try {
      outline.value = unwrap(await window.inkforge.outline.reorder(workId, nodeIds));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function moveOutlineNode(input: OutlineMoveInput): Promise<OutlineNode | null> {
    try {
      const node = unwrap(await window.inkforge.outline.move({ ...input }));
      outline.value = unwrap(await window.inkforge.outline.list(input.workId));
      return node;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function searchReplace(input: SearchReplaceInput): Promise<SearchReplaceResult | null> {
    try {
      const result = unwrap(await window.inkforge.content.searchReplace({ ...input }));
      chapters.value = unwrap(await window.inkforge.chapter.list(input.workId));
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function formatWork(workId: string): Promise<FormatWorkResult | null> {
    try {
      const result = unwrap(await window.inkforge.content.formatWork(workId));
      chapters.value = unwrap(await window.inkforge.chapter.list(workId));
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function batchCreateCards(input: CardBatchInput): Promise<Card[] | null> {
    try {
      const created = unwrap(await window.inkforge.card.batchCreate({ ...input, items: input.items.map((item) => ({ ...item })) }));
      cards.value = unwrap(await window.inkforge.card.list(input.workId));
      return created;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function deleteOutline(workId: string, nodeId: string): Promise<boolean> {
    try {
      unwrap(await window.inkforge.outline.delete(workId, nodeId));
      outline.value = unwrap(await window.inkforge.outline.list(workId));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function saveMasterOutline(workId: string, content: string): Promise<MasterOutline | null> {
    try {
      masterOutline.value = unwrap(await window.inkforge.outline.saveMaster(workId, content));
      return masterOutline.value;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function applyOutlineDraft(workId: string, volumes: OutlineVolumeDraft[]): Promise<OutlineNode[] | null> {
    try {
      const plainVolumes = JSON.parse(JSON.stringify(volumes)) as OutlineVolumeDraft[];
      const nodes = unwrap(await window.inkforge.outline.applyDraft({ workId, volumes: plainVolumes }));
      outline.value = unwrap(await window.inkforge.outline.list(workId));
      return nodes;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function saveCard(input: CardInput): Promise<Card | null> {
    try {
      // 设定卡来自响应式列表，先转为普通对象再跨进程传递。
      const plain = JSON.parse(JSON.stringify(input)) as CardInput;
      const card = unwrap(await window.inkforge.card.upsert(plain));
      const index = cards.value.findIndex((item) => item.cardId === card.cardId);
      if (index >= 0) cards.value[index] = card;
      else cards.value.unshift(card);
      return card;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function deleteCard(workId: string, cardId: string): Promise<boolean> {
    try {
      unwrap(await window.inkforge.card.delete(workId, cardId));
      cards.value = cards.value.filter((card) => card.cardId !== cardId);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function generateCards(input: CardGenerateInput): Promise<CardDraft[] | null> {
    try {
      return unwrap(await window.inkforge.card.generate(input));
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function generateDrafts(input: DraftGenerateInput): Promise<GeneratedChapterDraft[] | null> {
    try {
      return unwrap(await window.inkforge.draft.generate(input));
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function applyDrafts(workId: string, drafts: { chapterId: string; text: string }[]): Promise<GeneratedChapterDraft[] | null> {
    try {
      const plainDrafts = JSON.parse(JSON.stringify(drafts)) as { chapterId: string; text: string }[];
      return unwrap(await window.inkforge.draft.apply({ workId, drafts: plainDrafts }));
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function loadChapters(workId: string): Promise<void> {
    try {
      chapters.value = unwrap(await window.inkforge.chapter.list(workId));
    } catch (error) {
      reportError(error);
    }
  }

  async function setChapterLock(input: ChapterLockInput): Promise<ChapterLockResult | null> {
    try {
      const result = unwrap(await window.inkforge.chapter.lock(input));
      const index = chapters.value.findIndex((chapter) => chapter.chapterId === input.chapterId);
      if (index >= 0) chapters.value[index] = result.chapter;
      if (result.created.length) cards.value = unwrap(await window.inkforge.card.list(input.workId));
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function generateSeasons(input: SeasonGenerateInput): Promise<OutlineSeasonDraft[] | null> {
    try {
      return unwrap(await window.inkforge.outline.generateSeasons({ ...input }));
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function applySeasons(workId: string, volumeId: string, drafts: OutlineSeasonDraft[]): Promise<boolean> {
    try {
      const plainDrafts = JSON.parse(JSON.stringify(drafts)) as OutlineSeasonDraft[];
      unwrap(await window.inkforge.outline.applySeasons({ workId, volumeId, seasons: plainDrafts }));
      const [outlineResult, seasonResult, chapterResult] = await Promise.all([
        window.inkforge.outline.list(workId),
        window.inkforge.outline.listSeasons(workId),
        window.inkforge.chapter.list(workId),
      ]);
      outline.value = unwrap(outlineResult);
      seasons.value = unwrap(seasonResult);
      chapters.value = unwrap(chapterResult);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function deleteSeason(workId: string, seasonId: string): Promise<boolean> {
    try {
      unwrap(await window.inkforge.outline.deleteSeason(workId, seasonId));
      const [outlineResult, seasonResult] = await Promise.all([
        window.inkforge.outline.list(workId), window.inkforge.outline.listSeasons(workId),
      ]);
      outline.value = unwrap(outlineResult);
      seasons.value = unwrap(seasonResult);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function saveProvider(input: ProviderInput): Promise<PublicProvider | null> {
    try {
      const provider = unwrap(await window.inkforge.provider.upsert(input));
      await loadProviders();
      return provider;
    } catch (error) {
      reportError(error);
      return null;
    }
  }

  async function deleteProvider(id: string): Promise<boolean> {
    try {
      unwrap(await window.inkforge.provider.delete(id));
      providers.value = providers.value.filter((provider) => provider.id !== id);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function activateProvider(id: string): Promise<boolean> {
    try {
      providers.value = unwrap(await window.inkforge.provider.activate(id));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function setExportCompliance(show: boolean): Promise<boolean> {
    try {
      showExportCompliance.value = unwrap(await window.inkforge.provider.setCompliance(show));
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  return {
    works, workGroups, workspaceStats, activeWorkId, outline, chapters, seasons, masterOutline, cards, providers, appInfo,
    loadingWorks, loadingWork, loadingProviders, showExportCompliance,
    activeWork, activeProvider, volumes, pinnedCards,
    loadWorks, loadWorkGroups, createWorkGroup, deleteWorkGroup, loadWorkspaceStats, loadProviders, loadInitial, activateWork,
    createWork, updateWork, deleteWork, importWork,
    createOutline, updateOutline, reorderOutline, deleteOutline, saveMasterOutline, applyOutlineDraft,
    moveOutlineNode, searchReplace, formatWork, batchCreateCards,
    saveCard, deleteCard, saveProvider, deleteProvider, activateProvider, setExportCompliance,
    generateCards, generateDrafts, applyDrafts,
    loadChapters, setChapterLock, generateSeasons, applySeasons, deleteSeason,
  };
});
