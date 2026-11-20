<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NButton, NInput, NInputNumber, NModal, NSelect, NSpin, NTag,
} from 'naive-ui';
import {
  ArrowLeft, Clapperboard, FileDown, Layers, ListTree, Plus, Search, Sparkles, Trash2, Upload,
} from 'lucide-vue-next';
import type { ScriptEpisode, ScriptIdea, ScriptProject } from '../../shared/models';
import { dialog, message, reportError, unwrap } from '../utils/api';

const elementGroups = [
  { label: '题材', items: ['都市', '古装', '悬疑', '甜宠', '复仇', '职场', '战神', '萌宝'] },
  { label: '剧情', items: ['逆袭', '追妻', '打脸', '反转', '误会', '双向暗恋', '身份错位'] },
  { label: '情绪', items: ['爽感', '虐心', '治愈', '紧张', '轻松'] },
  { label: '角色', items: ['女主', '赘婿', '总裁', '卧底', '律师', '医生'] },
];
const genreOptions = ['都市', '古装', '悬疑', '甜宠', '复仇', '玄幻', '职场', '其他'].map((value) => ({ label: value, value }));

const projects = ref<ScriptProject[]>([]);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const creating = ref(false);
const showCreate = ref(false);
const keyword = ref('');
const importing = ref(false);
const ideaInstruction = ref('');
const episodeCount = ref(12);
const batchSize = ref(5);
const elementDraft = ref<string[]>([]);
const previewIndex = ref<number | null>(null);
const episodeDraft = ref('');
const busy = reactive({ ideas: false, outline: false, episodes: false, saving: false, exporting: false });
const createForm = reactive({ title: '', genre: '都市', elements: [] as string[], episodeCount: 12, batchSize: 5 });

const project = computed(() => projects.value.find((item) => item.projectId === selectedId.value) || null);
const filteredProjects = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return projects.value;
  return projects.value.filter((item) => `${item.title}${item.genre}${item.elements.join('')}`.toLowerCase().includes(query));
});
const selectedIdea = computed<ScriptIdea | null>(() => {
  const current = project.value;
  return current?.ideas.find((idea) => idea.ideaId === current.selectedIdeaId) || null;
});
const completedCount = computed(() => project.value?.episodes.filter((episode) => episode.content.trim()).length ?? 0);
const pendingEpisodes = computed(() => project.value?.episodes.filter((episode) => !episode.content.trim()) ?? []);
const previewEpisode = computed(() => project.value?.episodes.find((episode) => episode.index === previewIndex.value) || null);
const currentBatchIndexes = computed(() => pendingEpisodes.value.slice(0, batchSize.value).map((episode) => episode.index));
const statusLabel: Record<ScriptEpisode['status'], string> = {
  pending: '待生成', generating: '生成中', done: '已完成', failed: '失败',
};

function toggleElement(list: string[], value: string): void {
  const index = list.indexOf(value);
  if (index >= 0) list.splice(index, 1);
  else list.push(value);
}

function syncProject(projectValue: ScriptProject | null): void {
  episodeCount.value = projectValue?.episodeCount ?? 12;
  batchSize.value = projectValue?.batchSize ?? 5;
  elementDraft.value = [...(projectValue?.elements ?? [])];
  const hasPreview = projectValue?.episodes.some((episode) => episode.index === previewIndex.value);
  if (!hasPreview) previewIndex.value = projectValue?.episodes[0]?.index ?? null;
  const episode = projectValue?.episodes.find((item) => item.index === previewIndex.value);
  episodeDraft.value = episode?.content ?? '';
}

function applyProject(projectValue: ScriptProject): void {
  projects.value = projects.value.map((item) => item.projectId === projectValue.projectId ? projectValue : item);
  syncProject(projectValue);
}

async function loadProjects(): Promise<void> {
  loading.value = true;
  try {
    projects.value = unwrap(await window.inkforge.script.list());
    const current = project.value;
    syncProject(current ?? projects.value[0] ?? null);
    if (!current && projects.value[0]) selectedId.value = projects.value[0].projectId;
  } catch (error) {
    reportError(error);
  } finally {
    loading.value = false;
  }
}

function openProject(projectValue: ScriptProject): void {
  selectedId.value = projectValue.projectId;
  previewIndex.value = projectValue.episodes[0]?.index ?? null;
  syncProject(projectValue);
}

function backToList(): void {
  selectedId.value = null;
  syncProject(null);
}

function openCreate(): void {
  Object.assign(createForm, { title: '', genre: '都市', elements: [], episodeCount: 12, batchSize: 5 });
  showCreate.value = true;
}

async function createProject(): Promise<void> {
  if (!createForm.title.trim()) {
    message.warning('请先为剧本起一个名字');
    return;
  }
  if (!createForm.elements.length) {
    message.warning('请至少选择一个题材或情绪元素');
    return;
  }
  creating.value = true;
  try {
    const created = unwrap(await window.inkforge.script.create({
      title: createForm.title.trim(), genre: createForm.genre,
      elements: [...createForm.elements], episodeCount: createForm.episodeCount, batchSize: createForm.batchSize,
    }));
    projects.value.unshift(created);
    showCreate.value = false;
    openProject(created);
    message.success('剧本项目已创建，先选元素生成创意');
  } catch (error) {
    reportError(error);
  } finally {
    creating.value = false;
  }
}

async function importScript(): Promise<void> {
  if (importing.value) return;
  importing.value = true;
  try {
    const imported = unwrap(await window.inkforge.script.importFile());
    if (!imported) return;
    projects.value = [imported, ...projects.value.filter((item) => item.projectId !== imported.projectId)];
    openProject(imported);
    message.success(`《${imported.title}》已导入，共 ${imported.episodes.length} 集`);
  } catch (error) {
    reportError(error);
  } finally {
    importing.value = false;
  }
}

async function removeProject(projectValue: ScriptProject): Promise<void> {
  dialog.warning({
    title: '删除剧本项目',
    content: `确定删除《${projectValue.title}》吗？本机保存的创意、大纲与分集正文会一并删除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        unwrap(await window.inkforge.script.delete(projectValue.projectId));
        projects.value = projects.value.filter((item) => item.projectId !== projectValue.projectId);
        if (selectedId.value === projectValue.projectId) backToList();
        message.success('剧本项目已删除');
      } catch (error) {
        reportError(error);
      }
    },
  });
}

async function generateIdeas(): Promise<void> {
  const current = project.value;
  if (!current) return;
  if (!elementDraft.value.length) {
    message.warning('请至少选择一个题材或情绪元素');
    return;
  }
  busy.ideas = true;
  try {
    const withElements = unwrap(await window.inkforge.script.update(current.projectId, { elements: [...elementDraft.value] }));
    applyProject(withElements);
    const updated = unwrap(await window.inkforge.script.generateIdeas(current.projectId, ideaInstruction.value.trim() || undefined));
    applyProject(updated);
    message.success(`已生成 ${updated.ideas.length} 条短剧创意`);
  } catch (error) {
    reportError(error);
  } finally {
    busy.ideas = false;
  }
}

async function chooseIdea(idea: ScriptIdea): Promise<void> {
  if (!project.value) return;
  try {
    applyProject(unwrap(await window.inkforge.script.selectIdea(project.value.projectId, idea.ideaId)));
  } catch (error) {
    reportError(error);
  }
}

async function generateOutline(): Promise<void> {
  const current = project.value;
  if (!current) return;
  if (!selectedIdea.value) {
    message.warning('请先在 Step1 选择一条创意');
    return;
  }
  busy.outline = true;
  try {
    const updatedSettings = unwrap(await window.inkforge.script.update(current.projectId, {
      episodeCount: episodeCount.value, batchSize: batchSize.value,
    }));
    applyProject(updatedSettings);
    const updated = unwrap(await window.inkforge.script.generateOutline(current.projectId));
    applyProject(updated);
    message.success(`已生成总大纲与 ${updated.episodes.length} 集分集规划`);
  } catch (error) {
    reportError(error);
  } finally {
    busy.outline = false;
  }
}

async function generateEpisodes(indexes: number[]): Promise<void> {
  const current = project.value;
  if (!current || !indexes.length) return;
  busy.episodes = true;
  try {
    const updated = unwrap(await window.inkforge.script.generateEpisodes({ projectId: current.projectId, episodeIndexes: indexes }));
    applyProject(updated);
    const done = updated.episodes.filter((episode) => indexes.includes(episode.index) && episode.content.trim()).length;
    if (done) message.success(`本批已生成 ${done} 集正文`);
    else message.warning('本批未生成成功，可查看失败原因后重试');
  } catch (error) {
    reportError(error);
  } finally {
    busy.episodes = false;
  }
}

function generateNextBatch(): void {
  if (!pendingEpisodes.value.length) {
    message.info('全部分集都已有正文');
    return;
  }
  void generateEpisodes(currentBatchIndexes.value);
}

function generateAll(): void {
  const indexes = pendingEpisodes.value.map((episode) => episode.index);
  if (!indexes.length) {
    message.info('全部分集都已有正文');
    return;
  }
  if (indexes.length > 20) {
    message.warning('单次最多生成 20 集，请按批次生成');
    return;
  }
  void generateEpisodes(indexes);
}

function retryEpisode(episode: ScriptEpisode): void {
  void generateEpisodes([episode.index]);
}

function selectEpisode(episode: ScriptEpisode): void {
  previewIndex.value = episode.index;
  episodeDraft.value = episode.content;
}

async function saveEpisode(): Promise<void> {
  const current = project.value;
  if (!current || previewIndex.value === null) return;
  busy.saving = true;
  try {
    applyProject(unwrap(await window.inkforge.script.saveEpisode({
      projectId: current.projectId, episodeIndex: previewIndex.value, content: episodeDraft.value,
    })));
    message.success('本集正文已保存');
  } catch (error) {
    reportError(error);
  } finally {
    busy.saving = false;
  }
}

async function exportScript(batchOnly: boolean): Promise<void> {
  const current = project.value;
  if (!current) return;
  let indexes: number[] | undefined;
  if (batchOnly) {
    const start = Math.floor(((previewIndex.value ?? 1) - 1) / batchSize.value) * batchSize.value;
    indexes = current.episodes.slice(start, start + batchSize.value)
      .filter((episode) => episode.content.trim()).map((episode) => episode.index);
    if (!indexes.length) {
      message.warning('本批次还没有可导出的正文');
      return;
    }
  }
  busy.exporting = true;
  try {
    const result = unwrap(await window.inkforge.script.export({ projectId: current.projectId, episodeIndexes: indexes, format: 'md' }));
    if (result) message.success(`已导出：${result.filePath}`);
  } catch (error) {
    reportError(error);
  } finally {
    busy.exporting = false;
  }
}

onMounted(() => { void loadProjects(); });
</script>

<template>
  <div class="scripts-view">
    <section class="script-hero">
      <div class="hero-copy">
        <div class="hero-icon"><clapperboard :size="22" /></div>
        <div>
          <h2>剧本创作工作台</h2>
          <p>元素 → 创意 → 总大纲 → 分集正文，按批次生成并导出。全部内容保存在本机。</p>
        </div>
      </div>
      <div class="hero-actions">
        <n-button class="import-script" :loading="importing" @click="importScript"><template #icon><upload :size="15" /></template>导入剧本</n-button>
        <n-button type="primary" class="new-project" @click="openCreate"><template #icon><plus :size="15" /></template>新建剧本项目</n-button>
      </div>
    </section>

    <n-spin :show="loading">
      <template v-if="!project">
        <div v-if="!projects.length" class="script-empty">
          <clapperboard :size="34" />
          <strong>还没有剧本项目</strong>
          <p>先选题材与情绪元素，生成多条短剧创意，再扩成分集大纲与正文。</p>
          <n-button type="primary" @click="openCreate"><template #icon><plus :size="15" /></template>新建剧本项目</n-button>
        </div>
        <div v-else class="script-list">
          <div class="script-list-tools">
            <n-input v-model:value="keyword" size="small" clearable placeholder="搜索剧本名、类型或元素" class="script-search">
              <template #prefix><search :size="14" /></template>
            </n-input>
            <span>共 {{ filteredProjects.length }} 部</span>
          </div>
          <div v-if="!filteredProjects.length" class="script-empty search-empty">
            <search :size="26" />
            <strong>没有找到相关剧本</strong>
            <p>试试剧本名、类型或元素中的其他关键词。</p>
            <n-button size="small" @click="keyword = ''">清除搜索</n-button>
          </div>
          <div v-else class="project-grid">
            <article v-for="item in filteredProjects" :key="item.projectId" class="project-card" @click="openProject(item)">
              <div class="project-card-top">
                <span class="project-genre">{{ item.genre || '未分类' }}</span>
                <button class="project-delete" title="删除剧本项目" @click.stop="removeProject(item)"><trash2 :size="14" /></button>
              </div>
              <strong>{{ item.title }}</strong>
              <p>{{ item.elements.length ? item.elements.join(' · ') : '尚未选择元素' }}</p>
              <div class="project-meta">
                <span>{{ item.episodes.length || item.episodeCount }} 集规划</span>
                <span>{{ item.episodes.filter((episode) => episode.content.trim()).length }} 集有正文</span>
              </div>
            </article>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="studio-head">
          <button class="back-button" @click="backToList"><arrow-left :size="15" />返回我的剧本</button>
          <div class="studio-title">
            <h3>{{ project.title }}</h3>
            <span>{{ project.genre || '未分类' }} · {{ project.elements.join(' / ') || '未选择元素' }}</span>
          </div>
          <div class="studio-actions">
            <n-tag :bordered="false" size="small">{{ completedCount }} / {{ project.episodes.length || episodeCount }} 集有正文</n-tag>
            <n-button size="small" quaternary class="export-all" :loading="busy.exporting" @click="exportScript(false)">
              <template #icon><file-down :size="14" /></template>导出全部
            </n-button>
          </div>
        </div>

        <section class="step-card">
          <header class="step-head"><span class="step-no">Step 1</span><div><strong>短剧创建：元素与创意</strong><p>勾选题材、剧情、情绪与角色元素，生成多条方向不同的创意。</p></div></header>
          <div class="element-groups">
            <div v-for="group in elementGroups" :key="group.label" class="element-group">
              <span class="element-label">{{ group.label }}</span>
              <button
                v-for="item in group.items" :key="item" type="button" class="element-chip"
                :class="{ active: elementDraft.includes(item) }" @click="toggleElement(elementDraft, item)"
              >
                {{ item }}
              </button>
            </div>
          </div>
          <n-input v-model:value="ideaInstruction" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" class="idea-instruction" placeholder="补充想法（可选）：例如女主是落魄千金，第一集就要完成打脸" />
          <div class="step-footer">
            <span>已选 {{ elementDraft.length }} 个元素</span>
            <n-button type="primary" class="generate-ideas" :loading="busy.ideas" @click="generateIdeas"><template #icon><sparkles :size="15" /></template>生成短剧创意</n-button>
          </div>
          <div v-if="project.ideas.length" class="idea-grid">
            <article
              v-for="idea in project.ideas" :key="idea.ideaId" class="idea-card"
              :class="{ selected: project.selectedIdeaId === idea.ideaId }" @click="chooseIdea(idea)"
            >
              <strong>{{ idea.title }}</strong>
              <p class="idea-logline">{{ idea.logline || '暂无一句话卖点' }}</p>
              <p class="idea-synopsis">{{ idea.synopsis || '暂无剧情梗概' }}</p>
              <span v-if="project.selectedIdeaId === idea.ideaId" class="idea-badge">已选创意</span>
            </article>
          </div>
        </section>

        <section class="step-card">
          <header class="step-head"><span class="step-no">Step 2</span><div><strong>生成大纲：总纲与分集规划</strong><p>设置集数与批次大小，把选中的创意拆成可执行的分集。</p></div></header>
          <div class="selected-idea">
            <template v-if="selectedIdea"><span>已选择创意</span><strong>{{ selectedIdea.title }}</strong><p>{{ selectedIdea.logline }}</p></template>
            <template v-else><span>尚未选择创意，请先回到 Step 1 点击一张创意卡片。</span></template>
          </div>
          <div class="outline-settings">
            <label>集数<n-input-number v-model:value="episodeCount" class="episode-count" :min="1" :max="100" /></label>
            <label>批次大小<n-input-number v-model:value="batchSize" class="batch-size" :min="1" :max="20" /></label>
            <n-button class="generate-outline" :loading="busy.outline" :disabled="!selectedIdea" @click="generateOutline"><template #icon><list-tree :size="15" /></template>生成总大纲</n-button>
          </div>
          <div v-if="project.masterOutline" class="master-outline">{{ project.masterOutline }}</div>
          <div v-if="project.episodes.length" class="episode-list">
            <div v-for="episode in project.episodes" :key="episode.index" class="episode-row">
              <span class="episode-index">第 {{ episode.index }} 集</span>
              <div class="episode-copy"><strong>{{ episode.title }}</strong><p>{{ episode.summary }}</p></div>
              <span class="episode-status" :data-status="episode.status">{{ statusLabel[episode.status] }}</span>
            </div>
          </div>
        </section>

        <section class="step-card">
          <header class="step-head"><span class="step-no">Step 3</span><div><strong>分集创作：批量生成与导出</strong><p>按批次生成正文，失败可单集重试；点击分集可预览并手动修改。</p></div></header>
          <div class="episode-toolbar">
            <n-button class="generate-batch" :loading="busy.episodes" :disabled="!project.episodes.length" @click="generateNextBatch"><template #icon><layers :size="15" /></template>生成下一批</n-button>
            <n-button class="generate-all" :loading="busy.episodes" :disabled="!project.episodes.length" @click="generateAll">生成全部</n-button>
            <n-button class="export-batch" :loading="busy.exporting" @click="exportScript(true)"><template #icon><file-down :size="14" /></template>导出本批</n-button>
            <span class="episode-progress">已完成 {{ completedCount }} / {{ project.episodes.length || episodeCount }} 集</span>
          </div>
          <p v-if="!project.episodes.length" class="step-hint">请先在 Step 2 生成总大纲与分集规划。</p>
          <div v-else class="episode-workspace">
            <div class="episode-items">
              <button
                v-for="episode in project.episodes" :key="episode.index" type="button" class="episode-item"
                :class="{ active: previewIndex === episode.index }" @click="selectEpisode(episode)"
              >
                <span class="episode-index">第 {{ episode.index }} 集</span>
                <span class="episode-item-title">{{ episode.title }}</span>
                <span class="episode-status" :data-status="episode.status">{{ statusLabel[episode.status] }}</span>
                <span v-if="episode.status === 'failed'" class="episode-retry" @click.stop="retryEpisode(episode)">重试</span>
              </button>
            </div>
            <div class="episode-preview">
              <template v-if="previewEpisode">
                <div class="preview-head"><strong>{{ previewEpisode.title }}</strong><span>{{ previewEpisode.summary }}</span></div>
                <p v-if="previewEpisode.error" class="preview-error">{{ previewEpisode.error }}</p>
                <n-input v-model:value="episodeDraft" type="textarea" class="episode-text" :autosize="{ minRows: 8, maxRows: 16 }" placeholder="生成后可在此修改本集剧本" />
                <div class="preview-footer">
                  <span>{{ episodeDraft.replace(/\s/g, '').length }} 字</span>
                  <n-button size="small" class="save-episode" :loading="busy.saving" @click="saveEpisode">保存本集</n-button>
                </div>
              </template>
              <p v-else class="step-hint">点击左侧分集查看正文。</p>
            </div>
          </div>
        </section>
      </template>
    </n-spin>

    <n-modal v-model:show="showCreate" preset="card" title="新建剧本项目" class="script-create-modal">
      <label class="form-label">剧本名称</label>
      <n-input v-model:value="createForm.title" class="script-title" placeholder="例如：离婚当天，我继承了整座城" />
      <label class="form-label field-gap">类型</label>
      <n-select v-model:value="createForm.genre" class="script-genre" :options="genreOptions" />
      <label class="form-label field-gap">元素（至少选择一个）</label>
      <div class="element-groups create-elements">
        <div v-for="group in elementGroups" :key="group.label" class="element-group">
          <span class="element-label">{{ group.label }}</span>
          <button
            v-for="item in group.items" :key="item" type="button" class="element-chip"
            :class="{ active: createForm.elements.includes(item) }" @click="toggleElement(createForm.elements, item)"
          >
            {{ item }}
          </button>
        </div>
      </div>
      <div class="create-settings">
        <label>集数<n-input-number v-model:value="createForm.episodeCount" class="create-episode-count" :min="1" :max="100" /></label>
        <label>批次大小<n-input-number v-model:value="createForm.batchSize" class="create-batch-size" :min="1" :max="20" /></label>
      </div>
      <div class="modal-footer">
        <n-button @click="showCreate = false">取消</n-button>
        <n-button type="primary" class="create-submit" :loading="creating" @click="createProject">创建并开始</n-button>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.scripts-view { display: flex; flex-direction: column; gap: 16px; }.script-hero { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 22px; background: linear-gradient(120deg, #eef5ef, #f7faf6); border: 1px solid #e0e9e1; border-radius: 14px; }.hero-actions { display: flex; align-items: center; gap: 8px; }.script-list-tools { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }.script-search { width: 240px; }.script-list-tools > span { color: #93a098; font-size: 10px; }.search-empty { padding: 40px 20px; }.hero-copy { display: flex; align-items: center; gap: 14px; }.hero-icon { display: grid; width: 44px; height: 44px; color: #2f6b58; background: #e0eee4; border-radius: 12px; place-items: center; }.hero-copy h2 { margin: 0; color: #2b4038; font-size: 17px; }.hero-copy p { margin: 5px 0 0; color: #7c8c83; font-size: 11px; }.script-empty { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 60px 20px; color: #8a978f; background: #fff; border: 1px dashed #dbe5dc; border-radius: 14px; }.script-empty strong { color: #44584e; font-size: 14px; }.script-empty p { margin: 0; font-size: 11px; }.project-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }.project-card { padding: 16px; cursor: pointer; background: #fff; border: 1px solid #e3eae4; border-radius: 12px; transition: border-color .2s, box-shadow .2s; }.project-card:hover { border-color: #b9d3c1; box-shadow: 0 8px 20px rgba(47, 107, 88, .08); }.project-card-top { display: flex; align-items: center; justify-content: space-between; }.project-genre { color: #78907f; font-size: 10px; }.project-delete { padding: 4px; color: #a8b5ac; cursor: pointer; background: transparent; border: 0; }.project-delete:hover { color: #b7504c; }.project-card strong { display: block; margin-top: 9px; color: #2f453b; font-size: 14px; }.project-card p { margin: 6px 0 10px; color: #8b978f; font-size: 10px; }.project-meta { display: flex; justify-content: space-between; color: #8a978f; font-size: 9px; }.studio-head { display: flex; align-items: center; gap: 14px; padding: 14px 18px; background: #fff; border: 1px solid #e3eae4; border-radius: 12px; }.back-button { display: flex; align-items: center; gap: 5px; padding: 5px 9px; color: #5d7367; cursor: pointer; background: #f1f6f2; border: 1px solid #e0e9e2; border-radius: 7px; font-size: 10px; }.studio-title { flex: 1; min-width: 0; }.studio-title h3 { margin: 0; color: #2f453b; font-size: 15px; }.studio-title span { color: #8b978f; font-size: 10px; }.studio-actions { display: flex; align-items: center; gap: 8px; }.step-card { padding: 18px 20px; background: #fff; border: 1px solid #e3eae4; border-radius: 13px; }.step-head { display: flex; gap: 12px; align-items: flex-start; }.step-no { padding: 3px 8px; color: #2f6b58; font-size: 9px; font-weight: 600; background: #e9f2eb; border-radius: 5px; }.step-head strong { color: #2f453b; font-size: 13px; }.step-head p { margin: 4px 0 0; color: #8b978f; font-size: 10px; }.element-groups { display: flex; flex-direction: column; gap: 8px; margin-top: 15px; }.element-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }.element-label { width: 34px; color: #829087; font-size: 10px; }.element-chip { padding: 3px 9px; color: #64776b; cursor: pointer; background: #f6f9f6; border: 1px solid #e2eae3; border-radius: 12px; font-size: 10px; }.element-chip.active { color: #215e4c; background: #e3efe6; border-color: #b9d3c1; }.idea-instruction { margin-top: 13px; }.step-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 12px; color: #8b978f; font-size: 10px; }.idea-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 11px; margin-top: 14px; }.idea-card { position: relative; padding: 13px; cursor: pointer; border: 1px solid #e2eae3; border-radius: 10px; transition: border-color .2s, background .2s; }.idea-card:hover { border-color: #b9d3c1; }.idea-card.selected { background: #f1f7f2; border-color: #7fb095; }.idea-card strong { color: #2f453b; font-size: 12px; }.idea-logline { margin: 6px 0 4px; color: #5c7568; font-size: 10px; }.idea-synopsis { margin: 0; color: #8b978f; font-size: 10px; line-height: 1.7; }.idea-badge { position: absolute; top: 9px; right: 9px; padding: 2px 6px; color: #2f6b58; font-size: 9px; background: #e0eee4; border-radius: 4px; }.selected-idea { margin-top: 13px; padding: 10px 12px; background: #f5f9f5; border: 1px dashed #dce8de; border-radius: 9px; }.selected-idea span { color: #8b978f; font-size: 9px; }.selected-idea strong { display: block; margin-top: 4px; color: #33594a; font-size: 11px; }.selected-idea p { margin: 3px 0 0; color: #718176; font-size: 10px; }.outline-settings { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 14px; margin-top: 13px; }.outline-settings label { display: flex; flex-direction: column; gap: 5px; color: #718176; font-size: 10px; }.outline-settings :deep(.n-input-number) { width: 110px; }.outline-settings .n-button { margin-left: auto; }.master-outline { margin-top: 14px; padding: 12px; color: #56675d; font-size: 10px; line-height: 1.8; white-space: pre-wrap; background: #faf9f4; border: 1px solid #ece7d8; border-radius: 9px; }.episode-list { margin-top: 12px; border: 1px solid #edf1ed; border-radius: 9px; }.episode-row { display: flex; gap: 11px; padding: 9px 12px; border-top: 1px solid #f1f4f1; }.episode-row:first-child { border-top: 0; }.episode-index { flex-shrink: 0; color: #8b978f; font-size: 9px; }.episode-copy { flex: 1; min-width: 0; }.episode-copy strong { color: #405448; font-size: 10px; }.episode-copy p { margin: 3px 0 0; color: #8b978f; font-size: 9px; }.episode-status { flex-shrink: 0; color: #8b978f; font-size: 9px; }.episode-status[data-status='done'] { color: #2f7562; }.episode-status[data-status='failed'] { color: #b7504c; }.episode-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 15px; }.episode-progress { margin-left: auto; color: #8b978f; font-size: 10px; }.episode-workspace { display: grid; grid-template-columns: minmax(200px, 0.8fr) 1.4fr; gap: 12px; margin-top: 13px; }.episode-items { max-height: 360px; overflow-y: auto; border: 1px solid #edf1ed; border-radius: 9px; }.episode-item { display: flex; align-items: center; gap: 7px; width: 100%; padding: 8px 10px; text-align: left; cursor: pointer; background: transparent; border: 0; border-top: 1px solid #f2f5f2; }.episode-item:first-child { border-top: 0; }.episode-item.active { background: #f1f7f2; }.episode-item-title { flex: 1; overflow: hidden; color: #4b6155; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.episode-retry { color: #b88036; font-size: 9px; }.episode-preview { display: flex; flex-direction: column; padding: 12px; background: #fbfcfa; border: 1px solid #eef2ee; border-radius: 9px; }.preview-head strong { color: #33483d; font-size: 11px; }.preview-head span { display: block; margin-top: 4px; color: #8b978f; font-size: 9px; line-height: 1.6; }.preview-error { margin: 7px 0 0; color: #b7504c; font-size: 10px; }.episode-text { margin-top: 9px; }.preview-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; color: #8b978f; font-size: 9px; }.step-hint { margin: 12px 0 0; color: #8b978f; font-size: 10px; }.script-create-modal { width: 560px; }.form-label { display: block; margin-bottom: 6px; color: #5d7367; font-size: 10px; }.field-gap { margin-top: 15px; }.create-elements { margin-top: 0; }.create-settings { display: flex; gap: 18px; margin-top: 15px; }.create-settings label { display: flex; flex-direction: column; gap: 5px; color: #718176; font-size: 10px; }.create-settings :deep(.n-input-number) { width: 130px; }.modal-footer { display: flex; justify-content: flex-end; gap: 9px; margin-top: 20px; }
</style>
