<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NPopover, NSpin, NTooltip } from 'naive-ui';
import {
  ChevronDown, Database, FolderOpen, LogOut, RefreshCw, Settings, ShieldCheck, Sparkles,
} from 'lucide-vue-next';
import { useAppStore } from '../stores/app';
import { dialog, message, reportError, unwrap } from '../utils/api';
import { formatWordCount } from '../../shared/utils/stats';

const store = useAppStore();
const show = ref(false);
const loadingUsage = ref(false);
const generationCount = ref(0);
const promptTokens = ref(0);
const completionTokens = ref(0);

const version = computed(() => store.appInfo?.version || '—');
const platformLabel = computed(() => {
  const platform = store.appInfo?.platform;
  if (platform === 'win32') return 'Windows x64';
  if (platform === 'darwin') return 'macOS';
  return platform || '本机';
});
const chapterCount = computed(() => store.workspaceStats.works.reduce((sum, item) => sum + item.chapterCount, 0));
const totalTokens = computed(() => promptTokens.value + completionTokens.value);
const tokenText = computed(() => totalTokens.value.toLocaleString('zh-CN'));

async function refreshUsage(): Promise<void> {
  loadingUsage.value = true;
  try {
    const records = unwrap(await window.inkforge.history.list());
    generationCount.value = records.length;
    promptTokens.value = records.reduce((sum, record) => sum + (record.promptTokens ?? 0), 0);
    completionTokens.value = records.reduce((sum, record) => sum + (record.completionTokens ?? 0), 0);
  } catch (error) {
    reportError(error);
  } finally {
    loadingUsage.value = false;
  }
}

watch(show, (value) => {
  if (!value) return;
  void store.loadWorkspaceStats();
  void refreshUsage();
});

async function openDataDir(): Promise<void> {
  try {
    unwrap(await window.inkforge.app.openDataDir());
    message.success('已打开本地数据目录');
  } catch (error) {
    reportError(error);
  }
}

function confirmQuit(): void {
  show.value = false;
  dialog.warning({
    title: '退出墨轩？',
    content: '未保存的正文会先自动保存，然后关闭应用。',
    positiveText: '退出应用',
    negativeText: '取消',
    onPositiveClick: () => {
      void window.inkforge.app.quit().catch(() => undefined);
    },
  });
}
</script>

<template>
  <n-popover
    v-model:show="show"
    trigger="click"
    placement="bottom-end"
    :show-arrow="false"
    :content-style="{ padding: '0', borderRadius: '14px' }"
  >
    <template #trigger>
      <button type="button" class="user-panel-trigger" aria-label="个人面板" :aria-expanded="show">
        <span class="user-avatar">墨</span>
        <span class="user-trigger-copy">
          <strong>本地创作者</strong>
          <small>本机模式</small>
        </span>
        <chevron-down :size="14" :stroke-width="2" />
      </button>
    </template>

    <div class="user-panel" role="dialog" aria-label="个人面板详情">
      <header class="user-panel-head">
        <div class="user-panel-identity">
          <span class="user-avatar large">墨</span>
          <div>
            <strong>本地创作者</strong>
            <span>墨轩 {{ version }} · {{ platformLabel }}</span>
          </div>
        </div>
        <span class="user-panel-mode"><shield-check :size="12" />无需登录</span>
      </header>

      <section class="user-panel-notice">
        <div class="notice-title"><shield-check :size="15" /><strong>纯本地应用，能力有边界</strong></div>
        <p>墨轩不连接账号、云端或计费体系，因此没有会员等级、灵石余额、邀请码、邀请奖励、提现、兑换码、充值或订单。作品、设置与用量数据仅保存在本机。</p>
      </section>

      <section class="user-panel-usage">
        <div class="usage-title">
          <span><database :size="14" />本机用量</span>
          <n-tooltip>
            <template #trigger>
              <button type="button" class="usage-refresh" aria-label="刷新用量" :disabled="loadingUsage" @click="refreshUsage">
                <refresh-cw :size="13" :class="{ spinning: loadingUsage }" />
              </button>
            </template>
            重新统计作品与生成记录
          </n-tooltip>
        </div>
        <n-spin :show="loadingUsage">
          <div class="usage-grid">
            <div><span>作品</span><strong>{{ store.workspaceStats.works.length }}</strong></div>
            <div><span>章节</span><strong>{{ chapterCount }}</strong></div>
            <div><span>累计字数</span><strong>{{ formatWordCount(store.workspaceStats.totalWords) }}</strong></div>
            <div><span>AI 生成</span><strong>{{ generationCount }}<small> 次</small></strong></div>
          </div>
          <div class="usage-tokens">
            <div><span>Tokens 合计</span><strong>{{ tokenText }}</strong></div>
            <small>输入 {{ promptTokens.toLocaleString('zh-CN') }} · 输出 {{ completionTokens.toLocaleString('zh-CN') }}</small>
          </div>
        </n-spin>
        <p class="usage-hint">
          <sparkles :size="12" />仅统计本机生成历史中保留的记录。
          <router-link to="/history" class="usage-more" @click="show = false">查看明细</router-link>
        </p>
      </section>

      <section class="user-panel-data">
        <div class="usage-title"><span><folder-open :size="14" />本地数据目录</span></div>
        <code class="user-panel-path" :title="store.appInfo?.dataDirectory">{{ store.appInfo?.dataDirectory || '正在读取…' }}</code>
        <button type="button" class="user-panel-open" @click="openDataDir">
          <folder-open :size="14" />打开目录
        </button>
      </section>

      <footer class="user-panel-actions">
        <router-link to="/settings" class="user-panel-action" @click="show = false">
          <settings :size="15" />
          <span>偏好设置</span>
        </router-link>
        <button type="button" class="user-panel-action danger" @click="confirmQuit">
          <log-out :size="15" />
          <span>退出应用</span>
        </button>
      </footer>
    </div>
  </n-popover>
</template>
