<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  NAlert, NButton, NDrawer, NDrawerContent, NInput, NModal, NSelect, NSpin, NTag,
} from 'naive-ui';
import {
  AlertTriangle, CheckCircle2, EyeOff, Lightbulb, LocateFixed, Pencil,
  RotateCcw, ScanSearch, WandSparkles,
} from 'lucide-vue-next';
import type { Card, ConsistencyIssue } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { createRequestId, errorText, message, reportError, unwrap } from '../utils/api';

const props = defineProps<{
  show: boolean;
  workId: string;
  chapterId: string;
  revision: number;
}>();
const emit = defineEmits<{
  'update:show': [value: boolean];
  locate: [issue: ConsistencyIssue];
}>();
const store = useAppStore();
const visible = computed({ get: () => props.show, set: (value) => emit('update:show', value) });
const selectedCards = ref<string[]>([]);
const issues = ref<ConsistencyIssue[]>([]);
const ignoredIssues = ref<ConsistencyIssue[]>([]);
const checking = ref(false);
const checked = ref(false);
const checkError = ref('');
const fixedCount = ref(0);
const showIgnored = ref(false);
const busyIssueId = ref('');
const showCardEditor = ref(false);
const savingCard = ref(false);
const editingCard = ref<Card | null>(null);
const activeFixIssue = ref<ConsistencyIssue | null>(null);
const cardForm = reactive({ title: '', content: '' });
const consistencyTemplateId = 'builtin-consistency';
const cardOptions = computed(() => store.cards.filter((card) => !card.deletedAt).map((card) => ({ label: card.title, value: card.cardId })));

watch(() => props.show, (show) => {
  if (!show) return;
  selectedCards.value = store.pinnedCards.map((card) => card.cardId);
  issues.value = [];
  ignoredIssues.value = [];
  checking.value = false;
  checked.value = false;
  checkError.value = '';
  fixedCount.value = 0;
  showIgnored.value = false;
  showCardEditor.value = false;
});

async function check(): Promise<void> {
  if (checking.value) return;
  checkError.value = '';
  checked.value = false;
  if (!store.activeProvider) {
    checkError.value = '请先在设置中配置并启用模型服务';
    return;
  }
  if (!store.cards.some((card) => !card.deletedAt)) {
    checkError.value = '请先创建设定卡，再进行一致性检查';
    return;
  }
  checking.value = true;
  issues.value = [];
  ignoredIssues.value = [];
  fixedCount.value = 0;
  try {
    issues.value = unwrap(await window.inkforge.consistency.check({
      requestId: createRequestId(), workId: props.workId, chapterId: props.chapterId,
      scene: 'continue', cardIds: [...selectedCards.value], targetChars: 1200,
      baseRevision: props.revision, strategy: 'natural', templateId: consistencyTemplateId,
    }));
    checked.value = true;
  } catch (error) {
    checkError.value = errorText(error);
  } finally {
    checking.value = false;
  }
}

function removeIssue(issue: ConsistencyIssue): void {
  issues.value = issues.value.filter((item) => item.id !== issue.id);
}

async function recordFix(issue: ConsistencyIssue, action: 'text' | 'card'): Promise<boolean> {
  busyIssueId.value = issue.id;
  try {
    unwrap(await window.inkforge.consistency.recordFix({
      workId: props.workId, chapterId: props.chapterId, issueId: issue.id,
      issueType: issue.issueType || 'setting_conflict', scene: 'consistency',
      templateId: consistencyTemplateId, action,
    }));
    return true;
  } catch (error) {
    reportError(error);
    return false;
  } finally {
    busyIssueId.value = '';
  }
}

async function markTextFixed(issue: ConsistencyIssue): Promise<void> {
  if (!(await recordFix(issue, 'text'))) return;
  removeIssue(issue);
  fixedCount.value += 1;
  message.success('已记录正文修正');
}

function ignore(issue: ConsistencyIssue): void {
  removeIssue(issue);
  ignoredIssues.value.push(issue);
}

function restore(issue: ConsistencyIssue): void {
  ignoredIssues.value = ignoredIssues.value.filter((item) => item.id !== issue.id);
  issues.value.push(issue);
  if (!ignoredIssues.value.length) showIgnored.value = false;
}

function openCardEditor(issue: ConsistencyIssue): void {
  const card = store.cards.find((item) => !item.deletedAt && item.title === issue.cardTitle);
  if (!card) {
    message.warning(`未找到名为“${issue.cardTitle}”的设定卡，请先在作品设定库中核对`);
    return;
  }
  editingCard.value = card;
  activeFixIssue.value = issue;
  Object.assign(cardForm, { title: card.title, content: card.content });
  showCardEditor.value = true;
}

async function saveCardFix(): Promise<void> {
  const card = editingCard.value;
  const issue = activeFixIssue.value;
  if (!card || !issue) return;
  if (!cardForm.title.trim() || !cardForm.content.trim()) {
    message.warning('设定名称和内容不能为空');
    return;
  }
  savingCard.value = true;
  const saved = await store.saveCard({
    ...card, title: cardForm.title.trim(), content: cardForm.content.trim(),
  });
  if (saved && await recordFix(issue, 'card')) {
    removeIssue(issue);
    fixedCount.value += 1;
    showCardEditor.value = false;
    message.success('设定卡已更新，并记录一致性修正');
  }
  savingCard.value = false;
}
</script>

<template>
  <n-drawer v-model:show="visible" :width="500" placement="right">
    <n-drawer-content closable>
      <template #header><div class="consistency-title"><scan-search :size="19" />一致性检查</div></template>
      <div class="check-intro"><strong>对照设定，检查本章细节</strong><p>检查角色言行、世界规则与关键道具是否和设定卡冲突。结果由 AI 生成，请结合上下文人工判断。</p></div>
      <label class="form-label">对照设定卡</label>
      <n-select v-model:value="selectedCards" multiple :options="cardOptions" placeholder="不选择则使用全部设定卡" :disabled="checking" />
      <n-button type="primary" block class="check-button" :loading="checking" @click="check"><template #icon><scan-search :size="16" /></template>{{ checking ? '正在逐段检查' : checked || checkError ? '重新检查当前章节' : '开始检查当前章节' }}</n-button>
      <n-alert v-if="checkError && !checking" type="error" :bordered="false" class="check-error">
        <strong>检查未完成</strong><p>{{ checkError }}</p><n-button size="small" secondary @click="check"><template #icon><rotate-ccw :size="13" /></template>重试</n-button>
      </n-alert>
      <n-spin :show="checking">
        <div v-if="issues.length" class="issue-summary"><alert-triangle :size="16" /><span>发现 {{ issues.length }} 处待处理的不一致</span></div>
        <div v-if="issues.length" class="issues-list">
          <article v-for="(issue, index) in issues" :key="issue.id" class="issue-card">
            <div class="issue-number">{{ String(index + 1).padStart(2, '0') }}</div>
            <div class="issue-body">
              <n-tag size="small" type="warning" :bordered="false">{{ issue.cardTitle || '设定对照' }}</n-tag>
              <blockquote>{{ issue.paragraph || '模型未提供可定位原文' }}</blockquote>
              <h4>可能的问题</h4><p>{{ issue.explanation }}</p>
              <div class="suggestion"><lightbulb :size="15" /><div><strong>修改建议</strong><p>{{ issue.suggestion }}</p></div></div>
              <div class="issue-actions">
                <n-button size="tiny" secondary :disabled="!issue.paragraph" @click="emit('locate', issue)"><template #icon><locate-fixed :size="12" /></template>定位正文</n-button>
                <n-button size="tiny" type="primary" secondary :loading="busyIssueId === issue.id" @click="markTextFixed(issue)"><template #icon><CheckCircle2 :size="12" /></template>已修正文</n-button>
                <n-button size="tiny" quaternary :disabled="busyIssueId === issue.id" @click="openCardEditor(issue)"><template #icon><pencil :size="12" /></template>改设定</n-button>
                <n-button size="tiny" quaternary :disabled="busyIssueId === issue.id" @click="ignore(issue)"><template #icon><eye-off :size="12" /></template>忽略</n-button>
              </div>
            </div>
          </article>
        </div>
        <div v-else-if="checked && !checking" class="check-empty success"><check-circle2 :size="35" :stroke-width="1.4" /><h3>{{ fixedCount ? '本轮问题已处置' : '暂未发现明显冲突' }}</h3><p>{{ fixedCount ? `已记录 ${fixedCount} 条修正；如有需要，可重新检查当前章节。` : '当前章节与所选设定卡没有明显矛盾。仍建议你通读正文，确认语义与情节连贯。' }}</p></div>
        <div v-else-if="!checking && !checkError" class="check-empty"><wand-sparkles :size="34" :stroke-width="1.3" /><h3>准备检查</h3><p>选择需要对照的设定卡，然后点击开始检查。检查期间仍可继续写作。</p></div>
      </n-spin>
      <section v-if="ignoredIssues.length" class="ignored-section">
        <button class="ignored-toggle" @click="showIgnored = !showIgnored">已忽略 {{ ignoredIssues.length }} 条<span>{{ showIgnored ? '收起' : '查看与恢复' }}</span></button>
        <div v-if="showIgnored" class="ignored-list"><article v-for="issue in ignoredIssues" :key="issue.id"><div><strong>{{ issue.cardTitle }}</strong><p>{{ issue.explanation }}</p></div><n-button size="tiny" quaternary @click="restore(issue)"><template #icon><rotate-ccw :size="12" /></template>恢复</n-button></article></div>
      </section>
    </n-drawer-content>
  </n-drawer>

  <n-modal v-model:show="showCardEditor" preset="card" title="修改关联设定卡" class="consistency-card-editor" :mask-closable="!savingCard">
    <p class="editor-note">保存后会把当前问题记录为“通过修改设定解决”。若设定本身无误，请关闭此窗口并选择定位正文。</p>
    <label class="form-label required">设定名称</label><n-input v-model:value="cardForm.title" maxlength="100" :disabled="savingCard" />
    <label class="form-label required field-gap">设定内容</label><n-input v-model:value="cardForm.content" type="textarea" :rows="10" maxlength="12000" show-count :disabled="savingCard" />
    <div class="modal-footer"><n-button :disabled="savingCard" @click="showCardEditor = false">取消</n-button><n-button type="primary" :loading="savingCard" @click="saveCardFix">保存并记录修正</n-button></div>
  </n-modal>
</template>

<style scoped>
.consistency-title { display: flex; align-items: center; gap: 8px; color: #345247; }.check-intro { padding: 14px; margin-bottom: 18px; background: #f1f5f0; border-radius: 9px; }.check-intro strong { color: #426055; font-size: 12px; }.check-intro p { margin: 6px 0 0; color: #7d8e84; font-size: 10px; line-height: 1.8; }.check-button { margin: 14px 0 19px; }.check-error { margin-bottom: 16px; }.check-error strong { font-size: 11px; }.check-error p { margin: 4px 0 10px; font-size: 10px; line-height: 1.7; }.issue-summary { display: flex; align-items: center; gap: 7px; padding: 10px 12px; margin-bottom: 12px; color: #9a713b; background: #fff7e9; border-radius: 7px; font-size: 11px; }.issues-list { display: flex; flex-direction: column; gap: 12px; }.issue-card { display: flex; gap: 11px; padding: 14px; background: #fff; border: 1px solid #e5e7e1; border-radius: 10px; }.issue-number { color: #b4bcb5; font-family: Georgia, serif; font-size: 17px; }.issue-body { flex: 1; min-width: 0; }.issue-body blockquote { padding: 9px 11px; margin: 11px 0; color: #6e7c74; background: #f7f8f5; border-left: 2px solid #c8a267; font-size: 11px; line-height: 1.7; white-space: pre-wrap; }.issue-body h4 { margin: 12px 0 5px; color: #52655a; font-size: 11px; }.issue-body > p { margin: 0; color: #77867d; font-size: 11px; line-height: 1.75; }.suggestion { display: flex; gap: 8px; padding: 10px; margin-top: 12px; color: #54806b; background: #edf5ef; border-radius: 7px; }.suggestion strong { font-size: 10px; }.suggestion p { margin: 4px 0 0; color: #6d8376; font-size: 10px; line-height: 1.7; }.issue-actions { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }.check-empty { display: flex; min-height: 250px; flex-direction: column; align-items: center; justify-content: center; padding: 30px; color: #86a092; text-align: center; }.check-empty.success { color: #589074; }.check-empty h3 { margin: 13px 0 7px; color: #52675c; font-size: 14px; }.check-empty p { max-width: 320px; margin: 0; color: #95a199; font-size: 11px; line-height: 1.8; }.ignored-section { padding-top: 16px; margin-top: 16px; border-top: 1px solid #e8ece7; }.ignored-toggle { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 6px 0; color: #829087; cursor: pointer; background: transparent; border: 0; font-size: 10px; }.ignored-toggle span { color: #4f7865; }.ignored-list { margin-top: 8px; }.ignored-list article { display: flex; align-items: flex-start; gap: 8px; padding: 10px 0; border-bottom: 1px solid #edf0ec; }.ignored-list article > div { flex: 1; }.ignored-list strong { color: #6c7b72; font-size: 10px; }.ignored-list p { margin: 4px 0 0; color: #97a199; font-size: 9px; line-height: 1.6; }.consistency-card-editor { width: 580px; }.editor-note { padding: 10px 12px; margin: 0 0 16px; color: #857454; background: #faf6eb; border-radius: 7px; font-size: 10px; line-height: 1.7; }.field-gap { margin-top: 17px; }
</style>
