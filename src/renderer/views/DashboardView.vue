<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton, NInput, NInputNumber, NModal, NRadioButton, NRadioGroup, NSelect, NSpin, NTooltip,
} from 'naive-ui';
import {
  ArrowRight, BookOpen, BookPlus, CalendarDays, Clock3, FileText, FolderInput, FolderPlus, LayoutGrid,
  List, Palette, Pencil, Plus, Search, Sparkles, Trash2, Upload,
} from 'lucide-vue-next';
import type { Work } from '../../shared/models';
import { formatWordCount } from '../../shared/utils/stats';
import { useAppStore } from '../stores/app';
import { dialog, message, shortDate } from '../utils/api';

const router = useRouter();
const store = useAppStore();
const showCreate = ref(false);
const showRename = ref(false);
const saving = ref(false);
const importing = ref(false);
const viewMode = ref<'grid' | 'list'>('grid');
const keyword = ref('');
const activeGroup = ref('all');
const showGroupModal = ref(false);
const groupName = ref('');
const movingWork = ref<Work | null>(null);
const showMove = ref(false);
const moveGroup = ref('');
const renaming = ref<Work | null>(null);
const createForm = reactive({
  title: '', genre: '', description: '', style: '', targetWords: null as number | null, platform: '', requirements: '',
  visualRatio: '', visualStyle: '', visualNotes: '', group: '',
});
const renameForm = reactive({
  title: '', genre: '', description: '', style: '', targetWords: null as number | null, platform: '', requirements: '',
  visualRatio: '', visualStyle: '', visualNotes: '', group: '',
});
const genreOptions = ['长篇小说', '短篇小说', '散文随笔', '剧本', '诗歌', '非虚构', '其他'].map((value) => ({ label: value, value }));
const visualRatioOptions = ['9:16', '16:9', '1:1', '4:3'].map((value) => ({ label: value, value }));
const coverThemes = ['moss', 'dusk', 'coral', 'ocean', 'amber', 'mono'];
const groupOptions = computed(() => store.workGroups.map((group) => ({ label: group, value: group })));

const filteredWorks = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  return store.works.filter((work) => {
    if (activeGroup.value !== 'all' && work.group !== activeGroup.value) return false;
    if (!query) return true;
    return `${work.title}${work.genre}${work.group ?? ''}${work.description}${work.style ?? ''}${work.platform ?? ''}${work.requirements ?? ''}`.toLowerCase().includes(query);
  });
});
const groupCounts = computed(() => {
  const counts: Record<string, number> = {};
  for (const work of store.works) {
    if (work.group) counts[work.group] = (counts[work.group] ?? 0) + 1;
  }
  return counts;
});
const activeCount = computed(() => store.works.filter((work) => work.status === 'active').length);
const archivedCount = computed(() => store.works.filter((work) => work.status === 'archived').length);
const statMap = computed(() => new Map(store.workspaceStats.works.map((item) => [item.workId, item])));
const latestWork = computed(() => {
  const lastActive = (work: Work) => statMap.value.get(work.workId)?.lastActiveAt || work.updatedAt;
  return [...store.works].sort((a, b) => lastActive(b).localeCompare(lastActive(a)))[0] || null;
});
const latestStat = computed(() => (latestWork.value ? statMap.value.get(latestWork.value.workId) || null : null));
const latestChapterLabel = computed(() => latestStat.value?.lastChapterTitle || '尚未开始写作');
const streakText = computed(() => (store.workspaceStats.streakDays ? `连续 ${store.workspaceStats.streakDays} 天` : '今天动笔吧'));
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
});

function openCreate(): void {
  Object.assign(createForm, {
    title: '', genre: '', description: '', style: '', targetWords: null, platform: '', requirements: '',
    visualRatio: '', visualStyle: '', visualNotes: '', group: activeGroup.value === 'all' ? '' : activeGroup.value,
  });
  showCreate.value = true;
}

async function createWork(): Promise<void> {
  if (!createForm.title.trim()) {
    message.warning('请先为作品起一个名字');
    return;
  }
  saving.value = true;
  const work = await store.createWork({
    title: createForm.title.trim(),
    genre: createForm.genre || undefined,
    description: createForm.description.trim() || undefined,
    style: createForm.style.trim() || undefined,
    targetWords: createForm.targetWords ?? undefined,
    platform: createForm.platform.trim() || undefined,
    requirements: createForm.requirements.trim() || undefined,
    visualRatio: createForm.visualRatio || undefined,
    visualStyle: createForm.visualStyle.trim() || undefined,
    visualNotes: createForm.visualNotes.trim() || undefined,
    group: createForm.group || undefined,
  });
  saving.value = false;
  if (!work) return;
  showCreate.value = false;
  message.success('作品已创建，开始搭建故事世界吧');
  await router.push(`/work/${work.workId}`);
}

function openWork(work: Work): void {
  void router.push(`/work/${work.workId}`);
}

function workMeta(work: Work): string {
  const stat = statMap.value.get(work.workId);
  if (!stat || !stat.chapterCount) return '尚无章节';
  return `${formatWordCount(stat.wordCount)} 字 · ${stat.chapterCount} 章`;
}

/** 最近写作位置有章节时直接回到该章节，否则回到作品空间。 */
function resumeWork(work: Work): void {
  const chapterId = statMap.value.get(work.workId)?.lastChapterId;
  if (chapterId) {
    void router.push(`/work/${work.workId}/chapter/${chapterId}`);
    return;
  }
  openWork(work);
}

onMounted(() => {
  void store.loadWorks();
  void store.loadWorkspaceStats();
});

async function importWork(): Promise<void> {
  if (importing.value) return;
  importing.value = true;
  try {
    const work = await store.importWork();
    if (!work) return;
    message.success(`《${work.title}》已导入，章节与正文可在作品空间查看`);
    await router.push(`/work/${work.workId}`);
  } finally {
    importing.value = false;
  }
}

function openRename(work: Work): void {
  renaming.value = work;
  Object.assign(renameForm, {
    title: work.title,
    genre: work.genre,
    description: work.description,
    style: work.style ?? '',
    targetWords: work.targetWords || null,
    platform: work.platform ?? '',
    requirements: work.requirements ?? '',
    visualRatio: work.visualRatio ?? '',
    visualStyle: work.visualStyle ?? '',
    visualNotes: work.visualNotes ?? '',
    group: work.group ?? '',
  });
  showRename.value = true;
}

async function renameWork(): Promise<void> {
  if (!renaming.value || !renameForm.title.trim()) {
    message.warning('作品名称不能为空');
    return;
  }
  saving.value = true;
  const result = await store.updateWork(renaming.value.workId, {
    title: renameForm.title.trim(),
    genre: renameForm.genre,
    description: renameForm.description.trim(),
    style: renameForm.style.trim(),
    targetWords: renameForm.targetWords ?? 0,
    platform: renameForm.platform.trim(),
    requirements: renameForm.requirements.trim(),
    visualRatio: renameForm.visualRatio,
    visualStyle: renameForm.visualStyle.trim(),
    visualNotes: renameForm.visualNotes.trim(),
    group: renameForm.group,
  });
  saving.value = false;
  if (result) {
    showRename.value = false;
    message.success('作品信息已更新');
  }
}

function removeWork(work: Work): void {
  dialog.warning({
    title: `将《${work.title}》移入回收站？`,
    content: '作品将被软删除，不会立即物理清除。删除期间，作品内的大纲、章节与设定卡也不会出现在工作台。',
    positiveText: '移入回收站',
    negativeText: '保留作品',
    onPositiveClick: async () => {
      const success = await store.deleteWork(work.workId);
      if (success) message.success('作品已移入回收站');
    },
  });
}

function openGroupModal(): void {
  groupName.value = '';
  showGroupModal.value = true;
}

async function submitGroup(): Promise<void> {
  if (!groupName.value.trim()) {
    message.warning('请填写分组名称');
    return;
  }
  const created = await store.createWorkGroup(groupName.value.trim());
  if (!created) return;
  const name = groupName.value.trim();
  showGroupModal.value = false;
  activeGroup.value = name;
  message.success(`分组“${name}”已创建`);
}

function removeGroup(group: string): void {
  dialog.warning({
    title: `删除分组“${group}”？`,
    content: '删除分组只会把其中的作品移回“全部”，不会删除作品本体。',
    positiveText: '删除分组',
    negativeText: '取消',
    onPositiveClick: async () => {
      const removed = await store.deleteWorkGroup(group);
      if (!removed) return;
      if (activeGroup.value === group) activeGroup.value = 'all';
      message.success('分组已删除，作品已回到全部');
    },
  });
}

function openMove(work: Work): void {
  movingWork.value = work;
  moveGroup.value = work.group ?? '';
  showMove.value = true;
}

async function submitMove(): Promise<void> {
  if (!movingWork.value) return;
  const updated = await store.updateWork(movingWork.value.workId, { group: moveGroup.value });
  if (!updated) return;
  message.success(moveGroup.value ? `已移入“${moveGroup.value}”` : '已移出分组');
  movingWork.value = null;
  showMove.value = false;
}

async function cycleCover(work: Work): Promise<void> {
  const index = work.cover ? coverThemes.indexOf(work.cover) : -1;
  const cover = coverThemes[(index + 1) % coverThemes.length];
  const updated = await store.updateWork(work.workId, { cover });
  if (updated) message.success(work.cover ? '封面已更换' : '已生成本地占位封面');
}

function coverInitial(title: string): string {
  return title.trim().slice(0, 1) || '墨';
}
</script>

<template>
  <div class="page dashboard-page">
    <section class="welcome-panel">
      <div class="welcome-copy">
        <div class="welcome-eyebrow"><sparkles :size="14" /> 今日宜落笔</div>
        <h2>{{ greeting }}，继续你的故事。</h2>
        <p>不必等待完美的开头。写下此刻最清晰的一句，其余会慢慢生长。</p>
        <div class="welcome-actions">
          <n-button type="primary" size="large" @click="openCreate">
            <template #icon><plus :size="18" /></template>新建作品
          </n-button>
          <n-button size="large" secondary @click="router.push('/wizard')">
            <template #icon><sparkles :size="17" /></template>创作向导
          </n-button>
          <n-button size="large" secondary :loading="importing" @click="importWork">
            <template #icon><upload :size="17" /></template>导入作品
          </n-button>
        </div>
      </div>
      <div class="welcome-decoration" aria-hidden="true">
        <div class="paper-sheet sheet-back" />
        <div class="paper-sheet sheet-front">
          <div class="writing-lines"><i /><i /><i /><i /></div>
          <book-open :size="28" :stroke-width="1.25" />
        </div>
      </div>
    </section>

    <section class="stats-grid" aria-label="创作概览">
      <div class="stat-card paper-card">
        <div class="stat-icon"><file-text :size="19" /></div>
        <div><span>累计字数</span><strong>{{ formatWordCount(store.workspaceStats.totalWords) }}</strong></div>
        <small>{{ store.workspaceStats.totalWords ? '全部作品正文' : '等待第一个字' }}</small>
      </div>
      <div class="stat-card paper-card">
        <div class="stat-icon green"><calendar-days :size="19" /></div>
        <div><span>创作天数</span><strong>{{ store.workspaceStats.writingDays }}</strong></div>
        <small>{{ streakText }}</small>
      </div>
      <div class="stat-card paper-card">
        <div class="stat-icon amber"><book-open :size="19" /></div>
        <div><span>正在创作</span><strong>{{ activeCount }}</strong></div>
        <small>共 {{ store.works.length }} 部 · 归档 {{ archivedCount }}</small>
      </div>
      <div class="stat-card latest paper-card">
        <div class="stat-icon neutral"><clock3 :size="19" /></div>
        <div class="latest-copy">
          <span>最近创作</span>
          <strong>{{ latestWork?.title || '尚未开始' }}</strong>
          <small v-if="latestWork">{{ latestChapterLabel }}</small>
        </div>
        <n-button v-if="latestWork" size="tiny" secondary class="resume-btn" @click="resumeWork(latestWork)">
          <template #icon><arrow-right :size="13" /></template>继续写作
        </n-button>
        <small v-else>新建第一部作品</small>
      </div>
    </section>

    <section class="works-section">
      <div class="works-toolbar">
        <div><h3>我的作品</h3><span>{{ filteredWorks.length }} 部作品</span></div>
        <div class="works-tools">
          <n-input v-model:value="keyword" size="small" clearable placeholder="搜索作品" class="work-search">
            <template #prefix><search :size="15" /></template>
          </n-input>
          <n-radio-group v-model:value="viewMode" size="small">
            <n-radio-button value="grid"><layout-grid :size="15" /></n-radio-button>
            <n-radio-button value="list"><list :size="16" /></n-radio-button>
          </n-radio-group>
        </div>
      </div>

      <div class="group-tabs">
        <button class="group-tab" :class="{ active: activeGroup === 'all' }" @click="activeGroup = 'all'">全部 <em>{{ store.works.length }}</em></button>
        <button
          v-for="group in store.workGroups" :key="group" class="group-tab"
          :class="{ active: activeGroup === group }" @click="activeGroup = group"
        >
          {{ group }} <em>{{ groupCounts[group] || 0 }}</em>
          <span v-if="activeGroup === group" class="group-remove" title="删除分组" @click.stop="removeGroup(group)">×</span>
        </button>
        <button class="group-tab group-add" @click="openGroupModal"><folder-plus :size="13" />添加分组</button>
      </div>

      <n-spin :show="store.loadingWorks">
        <div v-if="filteredWorks.length && viewMode === 'grid'" class="works-grid">
          <article v-for="work in filteredWorks" :key="work.workId" class="work-card paper-card" tabindex="0" @click="openWork(work)" @keydown.enter="openWork(work)">
            <div class="work-accent" />
            <div class="work-card-top">
              <div v-if="work.cover" class="work-cover" :data-theme="work.cover"><span>{{ coverInitial(work.title) }}</span></div>
              <div v-else class="work-book-icon"><book-open :size="22" :stroke-width="1.5" /></div>
              <span class="work-status" :class="work.status">{{ work.status === 'active' ? '创作中' : '已归档' }}</span>
            </div>
            <h4>{{ work.title }}</h4>
            <div class="work-genre">{{ work.genre || '未分类' }}<template v-if="work.group"> · {{ work.group }}</template> · {{ workMeta(work) }}</div>
            <p>{{ work.description || '还没有作品简介。进入作品空间，为此故事写下第一句注解。' }}</p>
            <div class="work-card-footer">
              <span><clock3 :size="12" />{{ shortDate(work.updatedAt) }}更新</span>
              <div class="work-actions" @click.stop>
                <n-tooltip><template #trigger><button aria-label="移入分组" @click="openMove(work)"><folder-input :size="15" /></button></template>移入分组</n-tooltip>
                <n-tooltip><template #trigger><button aria-label="生成或更换封面" @click="cycleCover(work)"><palette :size="15" /></button></template>{{ work.cover ? '换封面' : '生成封面' }}</n-tooltip>
                <n-tooltip><template #trigger><button aria-label="重命名作品" @click="openRename(work)"><pencil :size="15" /></button></template>重命名</n-tooltip>
                <n-tooltip><template #trigger><button aria-label="删除作品" class="delete" @click="removeWork(work)"><trash2 :size="15" /></button></template>移入回收站</n-tooltip>
                <button class="open-work" aria-label="继续写作" @click="resumeWork(work)"><arrow-right :size="16" /></button>
              </div>
            </div>
          </article>
          <button class="new-work-card" @click="openCreate"><book-plus :size="25" /><strong>开始新的故事</strong><span>创建一部空白作品</span></button>
        </div>

        <div v-else-if="filteredWorks.length" class="work-list paper-card">
          <div class="work-list-head"><span>作品</span><span>分类</span><span>字数</span><span>状态</span><span>最近更新</span><span>操作</span></div>
          <div v-for="work in filteredWorks" :key="work.workId" class="work-list-row" @click="openWork(work)">
            <div class="list-work-title"><book-open :size="18" /><strong>{{ work.title }}</strong></div>
            <span>{{ work.genre || '未分类' }}<template v-if="work.group"> · {{ work.group }}</template></span>
            <span>{{ workMeta(work) }}</span>
            <span class="work-status" :class="work.status">{{ work.status === 'active' ? '创作中' : '已归档' }}</span>
            <span>{{ shortDate(work.updatedAt) }}</span>
            <div class="list-actions" @click.stop><button aria-label="移入分组" @click="openMove(work)"><folder-input :size="15" /></button><button aria-label="生成或更换封面" @click="cycleCover(work)"><palette :size="15" /></button><button aria-label="重命名作品" @click="openRename(work)"><pencil :size="15" /></button><button aria-label="删除作品" class="delete" @click="removeWork(work)"><trash2 :size="15" /></button><button aria-label="继续写作" @click="resumeWork(work)"><arrow-right :size="16" /></button></div>
          </div>
        </div>

        <div v-else class="paper-card empty-wrap">
          <div class="empty-icon"><book-plus :size="29" :stroke-width="1.4" /></div>
          <template v-if="keyword"><h3>没有找到相关作品</h3><p>试试作品名、分类或简介中的其他关键词。</p><n-button @click="keyword = ''">清除搜索</n-button></template>
          <template v-else>
            <h3>你的书架还空着</h3>
            <p>每一个宏大的世界，都始于一个名字。创建第一部作品，让故事在这里落脚。</p>
            <n-button type="primary" @click="openCreate"><template #icon><plus :size="16" /></template>新建第一部作品</n-button>
            <ol class="empty-steps">
              <li><b>1</b><div><strong>创建作品</strong><span>为故事起名，选择分类</span></div></li>
              <li><b>2</b><div><strong>搭建大纲与设定</strong><span>梳理卷章，记录人物与世界观</span></div></li>
              <li><b>3</b><div><strong>开始写作</strong><span>从第一章写下第一句</span></div></li>
            </ol>
          </template>
        </div>
      </n-spin>
    </section>

    <n-modal v-model:show="showCreate" preset="card" title="新建作品" class="form-modal" :mask-closable="!saving">
      <p class="modal-intro">先为故事留一个位置。基础信息会同步给 AI，越具体越不容易跑偏，之后也可以修改。</p>
      <label class="form-label required">作品名称</label>
      <n-input v-model:value="createForm.title" maxlength="80" show-count placeholder="例如：山河故人" @keydown.enter="createWork" />
      <label class="form-label field-gap">作品分类</label>
      <n-select v-model:value="createForm.genre" :options="genreOptions" clearable placeholder="选择作品分类" />
      <label class="form-label field-gap">分组</label>
      <n-select v-model:value="createForm.group" :options="groupOptions" clearable placeholder="选填，可先创建分组" class="work-group-select" />
      <label class="form-label field-gap">作品简介</label>
      <n-input v-model:value="createForm.description" type="textarea" :rows="3" maxlength="500" show-count placeholder="用几句话记下故事的核心、主角或你想探索的主题……" />
      <label class="form-label field-gap">文风</label>
      <n-input v-model:value="createForm.style" maxlength="80" placeholder="例如：轻松幽默、快节奏、第一人称限知" />
      <div class="form-grid-2">
        <div><label class="form-label field-gap">目标字数</label><n-input-number v-model:value="createForm.targetWords" :min="0" :max="10000000" :step="10000" :show-button="false" placeholder="例如 200000"><template #suffix>字</template></n-input-number></div>
        <div><label class="form-label field-gap">发布平台</label><n-input v-model:value="createForm.platform" maxlength="60" placeholder="选填" /></div>
      </div>
      <label class="form-label field-gap">补充要求</label>
      <n-input v-model:value="createForm.requirements" type="textarea" :rows="3" maxlength="500" show-count placeholder="例如：不要新增设定、每章结尾留钩子、避免大段说明……" />
      <div class="form-grid-2">
        <div><label class="form-label field-gap">画幅比例</label><n-select v-model:value="createForm.visualRatio" :options="visualRatioOptions" clearable placeholder="选填，例如 9:16" /></div>
        <div><label class="form-label field-gap">画风预设</label><n-input v-model:value="createForm.visualStyle" maxlength="60" placeholder="例如：国风厚涂" /></div>
      </div>
      <p class="modal-intro visual-intro">画幅与画风选填，供“从本章提取资产”和改编资料导出使用，不影响正文写作。</p>
      <div class="modal-footer"><n-button @click="showCreate = false">取消</n-button><n-button type="primary" :loading="saving" @click="createWork">创建并进入</n-button></div>
    </n-modal>

    <n-modal v-model:show="showRename" preset="card" title="编辑作品信息" class="form-modal" :mask-closable="!saving">
      <label class="form-label required">作品名称</label><n-input v-model:value="renameForm.title" maxlength="80" show-count />
      <label class="form-label field-gap">作品分类</label><n-select v-model:value="renameForm.genre" :options="genreOptions" clearable />
      <label class="form-label field-gap">分组</label><n-select v-model:value="renameForm.group" :options="groupOptions" clearable placeholder="未分组" class="work-group-select" />
      <label class="form-label field-gap">作品简介</label><n-input v-model:value="renameForm.description" type="textarea" :rows="3" maxlength="500" show-count />
      <label class="form-label field-gap">文风</label><n-input v-model:value="renameForm.style" maxlength="80" placeholder="例如：轻松幽默、快节奏、第一人称限知" />
      <div class="form-grid-2">
        <div><label class="form-label field-gap">目标字数</label><n-input-number v-model:value="renameForm.targetWords" :min="0" :max="10000000" :step="10000" :show-button="false" placeholder="例如 200000"><template #suffix>字</template></n-input-number></div>
        <div><label class="form-label field-gap">发布平台</label><n-input v-model:value="renameForm.platform" maxlength="60" placeholder="选填" /></div>
      </div>
      <label class="form-label field-gap">补充要求</label><n-input v-model:value="renameForm.requirements" type="textarea" :rows="3" maxlength="500" show-count placeholder="例如：不要新增设定、每章结尾留钩子、避免大段说明……" />
      <div class="form-grid-2">
        <div><label class="form-label field-gap">画幅比例</label><n-select v-model:value="renameForm.visualRatio" :options="visualRatioOptions" clearable placeholder="选填，例如 9:16" /></div>
        <div><label class="form-label field-gap">画风预设</label><n-input v-model:value="renameForm.visualStyle" maxlength="60" placeholder="例如：国风厚涂" /></div>
      </div>
      <div class="modal-footer"><n-button @click="showRename = false">取消</n-button><n-button type="primary" :loading="saving" @click="renameWork">保存修改</n-button></div>
    </n-modal>

    <n-modal v-model:show="showGroupModal" preset="card" title="添加分组" class="group-modal">
      <p class="modal-intro">分组用于整理作品；删除分组不会删除作品本体。</p>
      <n-input v-model:value="groupName" maxlength="20" show-count placeholder="例如：都市短篇" @keydown.enter="submitGroup" />
      <div class="modal-footer"><n-button @click="showGroupModal = false">取消</n-button><n-button type="primary" class="group-submit" @click="submitGroup">创建分组</n-button></div>
    </n-modal>

    <n-modal v-model:show="showMove" preset="card" title="移入分组" class="group-modal">
      <p class="modal-intro">把《{{ movingWork?.title }}》移动到：</p>
      <n-select v-model:value="moveGroup" :options="groupOptions" clearable placeholder="不分组（移回全部）" class="move-group-select" />
      <div class="modal-footer"><n-button @click="showMove = false">取消</n-button><n-button type="primary" class="move-submit" @click="submitMove">确认移动</n-button></div>
    </n-modal>
  </div>
</template>

<style scoped>
.welcome-panel { position: relative; display: flex; min-height: 194px; padding: 30px 36px; margin-bottom: 19px; overflow: hidden; background: linear-gradient(112deg, #e7efe8 0%, #edf2eb 62%, #e4ede5 100%); border: 1px solid #dae5dc; border-radius: 13px; }
.welcome-copy { position: relative; z-index: 1; }
.welcome-eyebrow { display: flex; align-items: center; gap: 6px; margin-bottom: 11px; color: #668576; font-size: 10px; font-weight: 600; letter-spacing: 1.2px; }
.welcome-copy h2 { margin: 0 0 9px; color: #234438; font-family: "STSong", "SimSun", serif; font-size: 27px; font-weight: 600; letter-spacing: 1px; }
.welcome-copy p { margin: 0 0 19px; color: #6f8178; font-size: 12px; }
.welcome-actions { display: flex; align-items: center; gap: 10px; }
.welcome-copy .n-button { min-width: 118px; box-shadow: 0 5px 14px rgba(35,101,87,.16); }
.welcome-decoration { position: absolute; top: 0; right: 38px; width: 230px; height: 100%; opacity: .9; }
.paper-sheet { position: absolute; width: 130px; height: 155px; background: #f9fbf7; border: 1px solid #d7e1d7; border-radius: 4px; box-shadow: 0 9px 30px rgba(41,75,57,.07); }
.sheet-back { top: 31px; right: 26px; transform: rotate(10deg); opacity: .7; }
.sheet-front { top: 20px; right: 50px; display: flex; align-items: center; justify-content: center; color: #91aa9a; transform: rotate(-5deg); }
.writing-lines { position: absolute; top: 28px; right: 22px; left: 22px; }
.writing-lines i { display: block; height: 1px; margin-bottom: 15px; background: #e1e8df; }
.stats-grid { display: grid; grid-template-columns: .85fr .85fr .85fr 1.45fr; gap: 13px; margin-bottom: 27px; }
.stat-card { display: flex; align-items: center; gap: 12px; min-height: 84px; padding: 16px 17px; }
.stat-icon { display: grid; flex: 0 0 37px; height: 39px; place-items: center; color: #527d6c; background: #eaf2ec; border-radius: 9px; }
.stat-icon.amber { color: #a07d46; background: #f6f0e4; }.stat-icon.neutral { color: #78877f; background: #eff2ef; }
.stat-card div > span { display: block; margin-bottom: 2px; color: #84918a; font-size: 10px; }
.stat-card div > strong { color: #30483e; font-size: 23px; font-weight: 600; }
.stat-card > small { margin-left: auto; color: #9aa59f; font-size: 9px; white-space: nowrap; }
.stat-card.latest div > strong { display: block; max-width: 125px; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.latest-copy small { display: block; max-width: 125px; margin-top: 2px; overflow: hidden; color: #9aa59f; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.resume-btn { flex: 0 0 auto; margin-left: auto; }
.works-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.works-toolbar > div:first-child { display: flex; align-items: baseline; gap: 10px; }.works-toolbar h3 { margin: 0; font-size: 15px; font-weight: 600; }.works-toolbar > div > span { color: #93a098; font-size: 10px; }
.works-tools { display: flex; align-items: center; gap: 10px; }.work-search { width: 190px; }
.group-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 13px; }
.group-tab { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; color: #6b7f73; cursor: pointer; background: #f6f9f5; border: 1px solid #e3ebe3; border-radius: 14px; font-size: 10px; }
.group-tab em { color: #9aa79f; font-style: normal; font-size: 9px; }
.group-tab.active { color: #215e4c; background: #e6f1e9; border-color: #b9d3c1; }
.group-tab.active em { color: #47705d; }
.group-tab.group-add { color: #7a8d81; background: transparent; border-style: dashed; }
.group-remove { display: inline-grid; width: 14px; height: 14px; margin-left: 1px; color: #8ca294; border-radius: 50%; place-items: center; font-size: 11px; line-height: 1; }
.group-remove:hover { color: #b44e49; background: #fbeceb; }
.work-cover { display: flex; align-items: flex-end; justify-content: space-between; width: 58px; height: 78px; padding: 7px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); }
.work-cover span { color: #fff; font-family: "STSong", "SimSun", serif; font-size: 22px; line-height: 1; text-shadow: 0 1px 3px rgba(0,0,0,.18); }
.work-cover[data-theme='moss'] { background: linear-gradient(150deg, #356e59, #8fb49c); }
.work-cover[data-theme='dusk'] { background: linear-gradient(150deg, #3f445f, #9a8fa8); }
.work-cover[data-theme='coral'] { background: linear-gradient(150deg, #a8583f, #e2a17e); }
.work-cover[data-theme='ocean'] { background: linear-gradient(150deg, #2f5f73, #8ab5c2); }
.work-cover[data-theme='amber'] { background: linear-gradient(150deg, #92703a, #dcc08a); }
.work-cover[data-theme='mono'] { background: linear-gradient(150deg, #4c514d, #a3aca5); }
.group-modal { width: 440px; }.move-group-select, .work-group-select { width: 100%; }
.works-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 15px; }
.work-card { position: relative; min-height: 238px; padding: 19px 18px 14px; overflow: hidden; cursor: pointer; transition: transform .18s, box-shadow .18s, border-color .18s; }
.work-card:hover { border-color: #bdcec2; box-shadow: 0 8px 24px rgba(37,68,53,.07); transform: translateY(-2px); }.work-card:focus { outline: 2px solid #84aa98; outline-offset: 2px; }
.work-accent { position: absolute; top: 0; bottom: 0; left: 0; width: 3px; background: #7c9f8d; opacity: 0; transition: opacity .18s; }.work-card:hover .work-accent { opacity: 1; }
.work-card-top { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 14px; }.work-book-icon { display: grid; width: 40px; height: 42px; place-items: center; color: #587c6a; background: #edf3ee; border-radius: 8px; }
.work-status { display: inline-flex; align-items: center; width: fit-content; padding: 3px 7px; color: #60816f; background: #edf4ef; border-radius: 4px; font-size: 9px; }.work-status.archived { color: #8c806b; background: #f4f1ea; }
.work-card h4 { overflow: hidden; margin: 0 0 6px; color: #2b4037; font-size: 16px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }.work-genre { margin-bottom: 10px; overflow: hidden; color: #819188; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.work-card > p { display: -webkit-box; min-height: 43px; margin: 0; overflow: hidden; color: #87928c; font-size: 11px; line-height: 1.75; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.work-card-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 13px; margin-top: 14px; border-top: 1px solid #edf0ec; }.work-card-footer > span { display: flex; align-items: center; gap: 4px; color: #9aa49e; font-size: 9px; }
.work-actions, .list-actions { display: flex; align-items: center; gap: 2px; }.work-actions button, .list-actions button { display: grid; width: 27px; height: 27px; place-items: center; color: #839088; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.work-actions button:hover, .list-actions button:hover { color: #285f4f; background: #edf3ee; }.work-actions button.delete:hover, .list-actions button.delete:hover { color: #b44e49; background: #fbefee; }.work-actions .open-work { color: #346b59; }
.new-work-card { display: flex; min-height: 238px; flex-direction: column; align-items: center; justify-content: center; gap: 9px; color: #88a091; cursor: pointer; background: rgba(255,255,255,.36); border: 1px dashed #c8d4cb; border-radius: 12px; }.new-work-card:hover { color: #39705d; background: #f7faf6; border-color: #8daf9c; }.new-work-card strong { margin-top: 3px; font-size: 12px; font-weight: 500; }.new-work-card span { color: #a0aca5; font-size: 10px; }
.work-list { overflow: hidden; }.work-list-head, .work-list-row { display: grid; grid-template-columns: 1.8fr .8fr 1.1fr .8fr 1fr 110px; align-items: center; gap: 12px; padding: 0 18px; }.work-list-head { height: 39px; color: #8d9992; background: #f8faf7; border-bottom: 1px solid var(--line); font-size: 10px; }.work-list-row { min-height: 62px; color: #7f8c85; cursor: pointer; border-bottom: 1px solid #edf0ec; font-size: 11px; }.work-list-row:last-child { border: 0; }.work-list-row:hover { background: #fafcf9; }.list-work-title { display: flex; align-items: center; gap: 10px; min-width: 0; color: #5a7c6b; }.list-work-title strong { overflow: hidden; color: #354b41; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.form-modal { width: 560px; max-height: 88vh; overflow-y: auto; }.modal-intro { margin: -4px 0 19px; color: #8a9690; font-size: 11px; }.field-gap { margin-top: 17px; }.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.empty-steps { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; padding: 0; margin: 24px 0 0; list-style: none; }
.empty-steps li { display: flex; align-items: center; gap: 9px; min-width: 172px; padding: 11px 14px; text-align: left; background: #f8faf7; border: 1px solid #e8eee8; border-radius: 9px; }
.empty-steps b { display: grid; flex: 0 0 22px; height: 22px; place-items: center; color: #527d6c; background: #eaf2ec; border-radius: 50%; font-size: 10px; font-weight: 600; }
.empty-steps strong { display: block; color: #3c5148; font-size: 11px; font-weight: 600; }
.empty-steps span { display: block; margin-top: 1px; color: #9aa59f; font-size: 9px; }
@media (max-width: 1350px) { .works-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.welcome-decoration { right: 10px; }.stat-card > small { display: none; }.latest-copy small { display: none; } }
</style>
