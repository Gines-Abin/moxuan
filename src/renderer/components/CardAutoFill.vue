<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { NAlert, NButton, NCheckbox, NInput, NInputNumber, NModal, NSpin, NTag } from 'naive-ui';
import { CheckCheck, Sparkles, WandSparkles } from 'lucide-vue-next';
import type { CardDraft, CardType } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { errorText, message } from '../utils/api';

const props = defineProps<{ show: boolean; workId: string; chapterId?: string; chapterTitle?: string }>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });

interface DraftItem extends CardDraft {
  key: string;
  selected: boolean;
}

const typeMeta: Record<CardType, string> = {
  character: '角色', world: '世界观', plot: '情节', item: '道具', term: '术语',
};
const categoryFlags = reactive<Record<CardType, boolean>>({
  character: true, world: true, plot: true, item: false, term: false,
});
const count = ref(6);
const instruction = ref('');
const generating = ref(false);
const saving = ref(false);
const drafts = ref<DraftItem[]>([]);
const aiError = ref('');

const selectedCount = computed(() => drafts.value.filter((draft) => draft.selected).length);
const categoryKeys = computed(() => (Object.keys(typeMeta) as CardType[]).filter((type) => categoryFlags[type]));
const fromChapter = computed(() => Boolean(props.chapterId));

watch(() => props.show, (value) => {
  if (!value) return;
  drafts.value = [];
  aiError.value = '';
  if (props.chapterId) {
    (Object.keys(typeMeta) as CardType[]).forEach((type) => { categoryFlags[type] = false; });
    categoryFlags.character = true;
    categoryFlags.world = true;
    categoryFlags.item = true;
    count.value = 8;
    instruction.value = '';
  }
});

function toggleCategory(type: CardType): void {
  categoryFlags[type] = !categoryFlags[type];
}

function usePreset(preset: 'lead' | 'world' | 'cultivation'): void {
  (Object.keys(typeMeta) as CardType[]).forEach((type) => { categoryFlags[type] = false; });
  if (preset === 'lead') {
    categoryFlags.character = true;
    count.value = 1;
    instruction.value = '补齐男主：按“身份、性格、背景、能力、外貌、目标、关系”七个标签逐行填写具体事实，写清目标、阻碍、秘密与说话方式，不要空泛评价。';
  } else if (preset === 'world') {
    categoryFlags.world = true;
    count.value = 5;
    instruction.value = '按世界观模块补齐：时代背景、地理势力、社会规则、禁忌与伏笔，每张卡标题即模块名，写清规则、代价与对普通人的影响。';
  } else {
    categoryFlags.world = true;
    count.value = 1;
    instruction.value = '生成修炼体系，标题为“修炼体系”，内容按“总览、层级（从低到高）、晋升条件、硬规则”四部分逐行填写，层级给出清晰强弱差异与代价。';
  }
  message.info('已填入快捷补齐要求，可直接生成或继续修改');
}

async function generate(): Promise<void> {
  if (generating.value) return;
  if (!categoryKeys.value.length) { message.warning('请至少选择一种设定类型'); return; }
  generating.value = true;
  aiError.value = '';
  try {
    const result = await store.generateCards({
      workId: props.workId,
      chapterId: props.chapterId,
      categories: [...categoryKeys.value],
      instruction: instruction.value.trim() || undefined,
      count: count.value,
    });
    if (!result) return;
    drafts.value = result.map((draft, index) => ({
      ...draft,
      key: `${Date.now()}-${index}`,
      selected: true,
    }));
    message.success(`已生成 ${result.length} 条设定资料，可逐条修改后再保存`);
  } catch (error) {
    aiError.value = errorText(error);
  } finally {
    generating.value = false;
  }
}

async function saveSelected(): Promise<void> {
  if (saving.value) return;
  const targets = drafts.value.filter((draft) => draft.selected && draft.title.trim() && draft.content.trim());
  if (!targets.length) { message.warning('请至少保留一条完整的设定资料'); return; }
  saving.value = true;
  let saved = 0;
  for (const draft of targets) {
    const card = await store.saveCard({
      workId: props.workId,
      type: draft.type,
      title: draft.title.trim(),
      content: draft.content.trim(),
      tags: [...draft.tags],
      pinned: false,
    });
    if (card) saved += 1;
  }
  saving.value = false;
  if (saved) {
    message.success(`已保存 ${saved} 张设定卡`);
    visible.value = false;
  }
}

function toggleAll(value: boolean): void {
  drafts.value.forEach((draft) => { draft.selected = value; });
}
</script>

<template>
  <n-modal v-model:show="visible" preset="card" :title="fromChapter ? '从本章提取资产' : '自动补齐设定资料'" class="autofill-modal" :mask-closable="!generating && !saving">
    <p class="autofill-note">{{ fromChapter ? `AI 只从「${chapterTitle || '本章正文'}」中提取实际出现的角色、场景与道具，不新增正文没有的内容。提取结果先进入预览，确认后才写入设定库。` : 'AI 会依据故事总纲与已有设定，补齐角色、世界观与情节资料。角色卡统一按「标签：正文」保存，世界卡标题即模块名。生成结果先进入预览，确认后才写入设定库。' }}</p>

    <div v-if="!fromChapter" class="preset-row"><span>快捷补齐</span><button @click="usePreset('lead')">补齐男主</button><button @click="usePreset('world')">世界观模块</button><button @click="usePreset('cultivation')">修炼体系</button></div>

    <div class="autofill-options">
      <div class="option-block">
        <label class="form-label">补齐类型</label>
        <div class="type-row">
          <n-checkbox
            v-for="(label, type) in typeMeta"
            :key="type"
            :checked="categoryFlags[type]"
            @update:checked="toggleCategory(type as CardType)"
          >
            {{ label }}
          </n-checkbox>
        </div>
      </div>
      <div class="option-block count-block">
        <label class="form-label">生成条数</label>
        <n-input-number v-model:value="count" :min="1" :max="20" size="small" />
      </div>
    </div>
    <label class="form-label field-gap">补充要求（可选）</label>
    <n-input v-model:value="instruction" type="textarea" :rows="2" maxlength="500" placeholder="例如：重点补齐反派的动机与海上城市的权力结构。" />

    <div class="autofill-toolbar">
      <n-button type="primary" secondary :loading="generating" :disabled="saving" @click="generate">
        <template #icon><wand-sparkles :size="15" /></template>{{ drafts.length ? '重新生成' : '生成设定资料' }}
      </n-button>
      <span v-if="drafts.length" class="selected-hint">已勾选 {{ selectedCount }} / {{ drafts.length }} 条</span>
    </div>

    <n-alert v-if="aiError" type="error" :bordered="false" class="autofill-error">
      <strong>生成未完成</strong><p>{{ aiError }}</p>
      <n-button size="small" secondary @click="generate"><template #icon><sparkles :size="13" /></template>重试</n-button>
    </n-alert>

    <n-spin :show="generating">
      <div v-if="drafts.length" class="draft-list">
        <article v-for="draft in drafts" :key="draft.key" class="draft-card" :class="{ muted: !draft.selected }">
          <div class="draft-head">
            <n-checkbox v-model:checked="draft.selected" />
            <n-tag size="small" :bordered="false" type="success">{{ typeMeta[draft.type] }}</n-tag>
            <n-input v-model:value="draft.title" size="small" maxlength="100" class="draft-title" placeholder="设定名称" />
          </div>
          <n-input v-model:value="draft.content" type="textarea" :rows="4" maxlength="3000" show-count placeholder="设定内容" />
          <div v-if="draft.tags.length" class="draft-tags">
            <span v-for="tag in draft.tags" :key="tag"># {{ tag }}</span>
          </div>
        </article>
      </div>
      <div v-else class="autofill-empty">
        <wand-sparkles :size="30" :stroke-width="1.3" />
        <h3>{{ fromChapter ? '把本章人物与场景收进设定库' : '让设定先长出来' }}</h3>
        <p>{{ fromChapter ? '点击生成，AI 会按正文核对角色、场景与道具，避免把未出场内容写进设定。' : '选择类型后生成，AI 会避免与已有设定重复，并让内容与总纲保持一致。' }}</p>
      </div>
    </n-spin>

    <div class="modal-footer">
      <div v-if="drafts.length" class="select-actions">
        <button @click="toggleAll(true)"><check-check :size="13" />全选</button>
        <button @click="toggleAll(false)">全不选</button>
      </div>
      <n-button @click="visible = false">取消</n-button>
      <n-button type="primary" :loading="saving" :disabled="!drafts.length || generating" @click="saveSelected">
        保存选中设定
      </n-button>
    </div>
  </n-modal>
</template>

<style scoped>
.autofill-modal { width: 760px; }
.autofill-note { margin: 0 0 14px; color: #7e8f85; font-size: 11px; line-height: 1.8; }
.preset-row { display: flex; align-items: center; gap: 6px; padding: 8px 10px; margin-bottom: 12px; background: #f5f8f3; border-radius: 7px; }
.preset-row > span { margin-right: 3px; color: #8a9a90; font-size: 9px; }
.preset-row button { padding: 4px 8px; color: #5d806b; cursor: pointer; background: #fff; border: 1px solid #dde7de; border-radius: 5px; font-size: 9px; }
.preset-row button:hover { color: #2c6b55; border-color: #a9c4b4; }
.autofill-options { display: flex; justify-content: space-between; gap: 20px; }
.type-row { display: flex; flex-wrap: wrap; gap: 12px; padding-top: 6px; }
.count-block :deep(.n-input-number) { width: 100px; }
.field-gap { margin-top: 15px; }
.autofill-toolbar { display: flex; align-items: center; gap: 12px; margin: 15px 0 12px; }
.selected-hint { color: #8b9a91; font-size: 10px; }
.autofill-error { margin-bottom: 12px; }
.autofill-error p { margin: 4px 0 8px; font-size: 11px; }
.draft-list { display: flex; max-height: 430px; flex-direction: column; gap: 11px; padding-right: 5px; overflow-y: auto; }
.draft-card { padding: 12px; background: #fbfcfa; border: 1px solid #e2e9e2; border-radius: 9px; }
.draft-card.muted { opacity: .5; }
.draft-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.draft-title { flex: 1; }
.draft-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.draft-tags span { color: #7c9787; font-size: 9px; }
.autofill-empty { display: flex; min-height: 190px; flex-direction: column; align-items: center; justify-content: center; color: #9aa89f; text-align: center; }
.autofill-empty h3 { margin: 8px 0 5px; color: #52685c; font-size: 13px; }
.autofill-empty p { max-width: 360px; margin: 0; font-size: 10px; line-height: 1.75; }
.select-actions { display: flex; gap: 10px; margin-right: auto; }
.select-actions button { display: flex; align-items: center; gap: 4px; color: #6b8878; cursor: pointer; background: none; border: 0; font-size: 10px; }
.select-actions button:hover { color: #2b6b55; }
</style>
