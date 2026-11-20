import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { InkForgeApi } from '../shared/ipc';

const ipcChannels = {
  appInfo: 'app.info', appOpenDataDir: 'app.open-data-dir', appQuit: 'app.quit', appFlushComplete: 'app.flush-complete',
  workList: 'work.list', workCreate: 'work.create', workUpdate: 'work.update', workDelete: 'work.delete', workImport: 'work.import', workStats: 'work.stats',
  cardList: 'card.list', cardUpsert: 'card.upsert', cardDelete: 'card.delete',
  outlineList: 'outline.list', outlineCreate: 'outline.create', outlineUpdate: 'outline.update', outlineReorder: 'outline.reorder', outlineDelete: 'outline.delete', outlineMove: 'outline.move',
  outlineGetMaster: 'outline.master', outlineSaveMaster: 'outline.master.save', outlineGenerate: 'outline.generate', outlineApply: 'outline.apply',
  outlineSeasons: 'outline.seasons', outlineGenerateSeasons: 'outline.seasons.generate', outlineApplySeasons: 'outline.seasons.apply', outlineDeleteSeason: 'outline.seasons.delete',
  cardGenerate: 'card.generate', cardBatchCreate: 'card.batch-create', draftGenerate: 'draft.generate', draftApply: 'draft.apply', referencePickTxt: 'reference.pickTxt',
  contentSearchReplace: 'content.search-replace', contentFormatWork: 'content.format-work',
  chapterList: 'chapter.list', chapterGet: 'chapter.get', chapterDraft: 'chapter.draft', chapterSave: 'chapter.save', chapterLock: 'chapter.lock',
  promptList: 'prompt.list', promptUpsert: 'prompt.upsert', promptDelete: 'prompt.delete', promptMarkUsed: 'prompt.mark-used', promptImport: 'prompt.import', promptExport: 'prompt.export',
  historyList: 'history.list', historyDelete: 'history.delete', historyClear: 'history.clear',
  providerList: 'provider.list', providerUpsert: 'provider.upsert', providerDelete: 'provider.delete', providerTest: 'provider.test',
  providerActivate: 'provider.activate', providerCompliance: 'provider.compliance', providerGetCompliance: 'provider.compliance.get',
  aiStart: 'ai.stream', aiAbort: 'ai.abort', aiChunk: 'ai:chunk', aiDone: 'ai:done', aiError: 'ai:error',
  consistencyCheck: 'consistency.check', consistencyBook: 'consistency.checkBook', consistencyFix: 'consistency.fix',
  snapshotList: 'snapshot.list', snapshotCreate: 'snapshot.create', snapshotRollback: 'snapshot.rollback',
  recoveryList: 'recovery.list', recoveryRestore: 'recovery.restore', recoveryDiscard: 'recovery.discard',
  exportDocument: 'export.document',
  workGroupList: 'work.groups', workGroupCreate: 'work.group.create', workGroupDelete: 'work.group.delete',
  scriptList: 'script.list', scriptImport: 'script.import', scriptCreate: 'script.create', scriptUpdate: 'script.update', scriptDelete: 'script.delete',
  scriptGenerateIdeas: 'script.ideas.generate', scriptSelectIdea: 'script.idea.select', scriptGenerateOutline: 'script.outline.generate',
  scriptGenerateEpisodes: 'script.episodes.generate', scriptSaveEpisode: 'script.episode.save', scriptExport: 'script.export',
} as const;

const invokeWhitelist = new Set<string>([
  ipcChannels.appInfo, ipcChannels.appOpenDataDir, ipcChannels.appQuit, ipcChannels.appFlushComplete,
  ipcChannels.workList, ipcChannels.workCreate, ipcChannels.workUpdate, ipcChannels.workDelete, ipcChannels.workImport, ipcChannels.workStats,
  ipcChannels.cardList, ipcChannels.cardUpsert, ipcChannels.cardDelete,
  ipcChannels.outlineList, ipcChannels.outlineCreate, ipcChannels.outlineUpdate, ipcChannels.outlineReorder, ipcChannels.outlineDelete, ipcChannels.outlineMove,
  ipcChannels.outlineGetMaster, ipcChannels.outlineSaveMaster, ipcChannels.outlineGenerate, ipcChannels.outlineApply,
  ipcChannels.outlineSeasons, ipcChannels.outlineGenerateSeasons, ipcChannels.outlineApplySeasons, ipcChannels.outlineDeleteSeason,
  ipcChannels.cardGenerate, ipcChannels.cardBatchCreate, ipcChannels.draftGenerate, ipcChannels.draftApply, ipcChannels.referencePickTxt,
  ipcChannels.contentSearchReplace, ipcChannels.contentFormatWork,
  ipcChannels.chapterList, ipcChannels.chapterGet, ipcChannels.chapterDraft, ipcChannels.chapterSave, ipcChannels.chapterLock,
  ipcChannels.promptList, ipcChannels.promptUpsert, ipcChannels.promptDelete, ipcChannels.promptMarkUsed, ipcChannels.promptImport, ipcChannels.promptExport,
  ipcChannels.historyList, ipcChannels.historyDelete, ipcChannels.historyClear,
  ipcChannels.providerList, ipcChannels.providerUpsert, ipcChannels.providerDelete, ipcChannels.providerTest,
  ipcChannels.providerActivate, ipcChannels.providerCompliance, ipcChannels.providerGetCompliance,
  ipcChannels.aiStart, ipcChannels.aiAbort,
  ipcChannels.consistencyCheck, ipcChannels.consistencyBook, ipcChannels.consistencyFix,
  ipcChannels.snapshotList, ipcChannels.snapshotCreate, ipcChannels.snapshotRollback,
  ipcChannels.recoveryList, ipcChannels.recoveryRestore, ipcChannels.recoveryDiscard,
  ipcChannels.exportDocument,
  ipcChannels.workGroupList, ipcChannels.workGroupCreate, ipcChannels.workGroupDelete,
  ipcChannels.scriptList, ipcChannels.scriptImport, ipcChannels.scriptCreate, ipcChannels.scriptUpdate, ipcChannels.scriptDelete,
  ipcChannels.scriptGenerateIdeas, ipcChannels.scriptSelectIdea, ipcChannels.scriptGenerateOutline,
  ipcChannels.scriptGenerateEpisodes, ipcChannels.scriptSaveEpisode, ipcChannels.scriptExport,
]);

function invoke(channel: string, ...args: unknown[]): Promise<any> {
  if (!invokeWhitelist.has(channel)) return Promise.reject(new Error('IPC channel is not allowed'));
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe<T>(channel: string, callback: (event: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: InkForgeApi = {
  app: {
    getInfo: () => invoke(ipcChannels.appInfo),
    openDataDir: () => invoke(ipcChannels.appOpenDataDir),
    quit: () => invoke(ipcChannels.appQuit),
    flushComplete: (saved) => invoke(ipcChannels.appFlushComplete, saved),
  },
  work: {
    list: () => invoke(ipcChannels.workList),
    create: (input) => invoke(ipcChannels.workCreate, input),
    update: (workId, input) => invoke(ipcChannels.workUpdate, workId, input),
    delete: (workId) => invoke(ipcChannels.workDelete, workId),
    import: () => invoke(ipcChannels.workImport),
    stats: () => invoke(ipcChannels.workStats),
    groups: () => invoke(ipcChannels.workGroupList),
    createGroup: (name) => invoke(ipcChannels.workGroupCreate, name),
    deleteGroup: (name) => invoke(ipcChannels.workGroupDelete, name),
  },
  card: {
    list: (workId) => invoke(ipcChannels.cardList, workId),
    upsert: (input) => invoke(ipcChannels.cardUpsert, input),
    delete: (workId, cardId) => invoke(ipcChannels.cardDelete, workId, cardId),
    generate: (input) => invoke(ipcChannels.cardGenerate, input),
    batchCreate: (input) => invoke(ipcChannels.cardBatchCreate, input),
  },
  outline: {
    list: (workId) => invoke(ipcChannels.outlineList, workId),
    create: (input) => invoke(ipcChannels.outlineCreate, input),
    update: (workId, nodeId, input) => invoke(ipcChannels.outlineUpdate, workId, nodeId, input),
    reorder: (workId, nodeIds) => invoke(ipcChannels.outlineReorder, workId, nodeIds),
    move: (input) => invoke(ipcChannels.outlineMove, input),
    delete: (workId, nodeId) => invoke(ipcChannels.outlineDelete, workId, nodeId),
    getMaster: (workId) => invoke(ipcChannels.outlineGetMaster, workId),
    saveMaster: (workId, content) => invoke(ipcChannels.outlineSaveMaster, workId, content),
    generate: (input) => invoke(ipcChannels.outlineGenerate, input),
    applyDraft: (input) => invoke(ipcChannels.outlineApply, input),
    listSeasons: (workId) => invoke(ipcChannels.outlineSeasons, workId),
    generateSeasons: (input) => invoke(ipcChannels.outlineGenerateSeasons, input),
    applySeasons: (input) => invoke(ipcChannels.outlineApplySeasons, input),
    deleteSeason: (workId, seasonId) => invoke(ipcChannels.outlineDeleteSeason, workId, seasonId),
  },
  draft: {
    generate: (input) => invoke(ipcChannels.draftGenerate, input),
    apply: (input) => invoke(ipcChannels.draftApply, input),
  },
  content: {
    searchReplace: (input) => invoke(ipcChannels.contentSearchReplace, input),
    formatWork: (workId) => invoke(ipcChannels.contentFormatWork, workId),
  },
  reference: {
    pickTxt: () => invoke(ipcChannels.referencePickTxt),
  },
  chapter: {
    list: (workId) => invoke(ipcChannels.chapterList, workId),
    get: (workId, chapterId) => invoke(ipcChannels.chapterGet, workId, chapterId),
    saveDraft: (input) => invoke(ipcChannels.chapterDraft, input),
    save: (input) => invoke(ipcChannels.chapterSave, input),
    lock: (input) => invoke(ipcChannels.chapterLock, input),
  },
  prompt: {
    list: () => invoke(ipcChannels.promptList),
    upsert: (input) => invoke(ipcChannels.promptUpsert, input),
    delete: (templateId) => invoke(ipcChannels.promptDelete, templateId),
    markUsed: (templateId) => invoke(ipcChannels.promptMarkUsed, templateId),
    import: () => invoke(ipcChannels.promptImport),
    export: () => invoke(ipcChannels.promptExport),
  },
  history: {
    list: () => invoke(ipcChannels.historyList),
    delete: (generationId) => invoke(ipcChannels.historyDelete, generationId),
    clear: () => invoke(ipcChannels.historyClear),
  },
  provider: {
    list: () => invoke(ipcChannels.providerList),
    upsert: (input) => invoke(ipcChannels.providerUpsert, input),
    delete: (id) => invoke(ipcChannels.providerDelete, id),
    test: (id) => invoke(ipcChannels.providerTest, id),
    activate: (id) => invoke(ipcChannels.providerActivate, id),
    setCompliance: (show) => invoke(ipcChannels.providerCompliance, show),
    getCompliance: () => invoke(ipcChannels.providerGetCompliance),
  },
  ai: {
    start: (input) => invoke(ipcChannels.aiStart, input),
    abort: (requestId) => invoke(ipcChannels.aiAbort, requestId),
    onChunk: (callback) => subscribe(ipcChannels.aiChunk, callback),
    onDone: (callback) => subscribe(ipcChannels.aiDone, callback),
    onError: (callback) => subscribe(ipcChannels.aiError, callback),
  },
  consistency: {
    check: (input) => invoke(ipcChannels.consistencyCheck, input),
    checkBook: (input) => invoke(ipcChannels.consistencyBook, input),
    recordFix: (input) => invoke(ipcChannels.consistencyFix, input),
  },
  snapshot: {
    list: (workId, chapterId) => invoke(ipcChannels.snapshotList, workId, chapterId),
    create: (workId, chapterId) => invoke(ipcChannels.snapshotCreate, workId, chapterId),
    rollback: (workId, chapterId, snapshotId) => invoke(ipcChannels.snapshotRollback, workId, chapterId, snapshotId),
  },
  recovery: {
    list: () => invoke(ipcChannels.recoveryList),
    restore: (id) => invoke(ipcChannels.recoveryRestore, id),
    discard: (id) => invoke(ipcChannels.recoveryDiscard, id),
  },
  export: {
    document: (input) => invoke(ipcChannels.exportDocument, input),
  },
  script: {
    list: () => invoke(ipcChannels.scriptList),
    importFile: () => invoke(ipcChannels.scriptImport),
    create: (input) => invoke(ipcChannels.scriptCreate, input),
    update: (projectId, input) => invoke(ipcChannels.scriptUpdate, projectId, input),
    delete: (projectId) => invoke(ipcChannels.scriptDelete, projectId),
    generateIdeas: (projectId, instruction) => invoke(ipcChannels.scriptGenerateIdeas, projectId, instruction),
    selectIdea: (projectId, ideaId) => invoke(ipcChannels.scriptSelectIdea, projectId, ideaId),
    generateOutline: (projectId) => invoke(ipcChannels.scriptGenerateOutline, projectId),
    generateEpisodes: (input) => invoke(ipcChannels.scriptGenerateEpisodes, input),
    saveEpisode: (input) => invoke(ipcChannels.scriptSaveEpisode, input),
    export: (input) => invoke(ipcChannels.scriptExport, input),
  },
};

ipcRenderer.on('app:before-quit', () => {
  window.dispatchEvent(new Event('inkforge:before-quit'));
});

contextBridge.exposeInMainWorld('inkforge', api);

declare global {
  interface Window {
    inkforge: InkForgeApi;
  }
}
