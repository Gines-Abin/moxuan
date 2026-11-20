<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { NConfigProvider, NDialogProvider, NMessageProvider, NTooltip } from 'naive-ui';
import {
  BookOpenText, Clapperboard, Feather, FolderKanban, History, LibraryBig, LockKeyhole,
  PenLine, Settings, SlidersHorizontal, Sparkles,
} from 'lucide-vue-next';
import { useAppStore } from './stores/app';
import RecoveryBanner from './components/RecoveryBanner.vue';
import UserPanel from './components/UserPanel.vue';

const route = useRoute();
const store = useAppStore();
const activeWork = computed(() => store.activeWork);

const themeOverrides = {
  common: {
    primaryColor: '#236557',
    primaryColorHover: '#2d7564',
    primaryColorPressed: '#194e42',
    primaryColorSuppl: '#2d7564',
    successColor: '#2f7562',
    warningColor: '#b88036',
    errorColor: '#b7504c',
    borderRadius: '8px',
    borderRadiusSmall: '6px',
    fontFamily: '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    textColorBase: '#24342f',
    bodyColor: '#f3f5f2',
  },
  Button: { heightMedium: '36px', fontWeight: '500' },
  Card: { borderRadius: '12px', borderColor: '#e2e7e1' },
  Input: { borderRadius: '8px' },
};

const navigation = [
  { path: '/', label: '工作台', hint: '作品与创作概览', icon: FolderKanban },
  { path: '/wizard', label: '创作向导', hint: '从灵感生成三级大纲', icon: Sparkles },
  { path: '/scripts', label: '剧本工作台', hint: '元素到分集正文', icon: Clapperboard },
  { path: '/prompts', label: '提示词库', hint: '管理 AI 写作模板', icon: LibraryBig },
  { path: '/history', label: '生成历史', hint: '找回 AI 生成内容', icon: History },
  { path: '/settings', label: '设置', hint: '模型与本地偏好', icon: SlidersHorizontal },
];

const pageTitle = computed(() => String(route.meta.title || '工作台'));
const pageSubtitle = computed(() => String(route.meta.subtitle || ''));

function acknowledgeQuit(): void {
  if (route.name === 'chapter') return;
  void window.inkforge.app.flushComplete(true).catch(() => undefined);
}

onMounted(() => {
  void store.loadInitial();
  window.addEventListener('inkforge:before-quit', acknowledgeQuit);
});

onBeforeUnmount(() => {
  window.removeEventListener('inkforge:before-quit', acknowledgeQuit);
});
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-shell">
          <aside class="app-sidebar">
            <div class="brand-block">
              <div class="brand-mark"><feather :size="23" :stroke-width="1.8" /></div>
              <div>
                <div class="brand-name">墨轩 <span>MoXuan</span></div>
                <div class="brand-caption">本地 AI 写作工作台</div>
              </div>
            </div>

            <div class="sidebar-section-label">创作空间</div>
            <nav class="sidebar-nav" aria-label="主导航">
              <router-link
                v-for="item in navigation"
                :key="item.path"
                :to="item.path"
                class="sidebar-link"
                :class="{ active: item.path === '/' ? route.path === '/' : route.path.startsWith(item.path) }"
              >
                <component :is="item.icon" :size="19" :stroke-width="1.8" />
                <span>{{ item.label }}</span>
                <span class="nav-dot" />
              </router-link>
            </nav>

            <div v-if="activeWork" class="sidebar-work">
              <div class="sidebar-section-label">正在创作</div>
              <router-link :to="`/work/${activeWork.workId}`" class="current-work-card">
                <div class="current-work-icon"><book-open-text :size="18" /></div>
                <div class="current-work-copy">
                  <strong>{{ activeWork.title }}</strong>
                  <span>{{ activeWork.genre || '未分类作品' }}</span>
                </div>
                <pen-line :size="15" />
              </router-link>
            </div>

            <div class="sidebar-bottom">
              <div class="local-status">
                <lock-keyhole :size="15" />
                <div><strong>内容保存在本地</strong><span>你的故事，由你掌控</span></div>
              </div>
              <router-link to="/settings" class="sidebar-settings">
                <settings :size="17" />
                <span>偏好设置</span>
                <span class="version">{{ store.appInfo?.version || '1.0.0' }}</span>
              </router-link>
            </div>
          </aside>

          <section class="app-main">
            <header class="context-bar">
              <div class="context-title">
                <h1>{{ pageTitle }}</h1>
                <span class="context-divider" />
                <p>{{ pageSubtitle }}</p>
              </div>
              <div class="context-actions">
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <div class="privacy-chip"><lock-keyhole :size="14" /><span>本地优先</span></div>
                  </template>
                  文稿与设定仅通过你配置的模型服务处理
                </n-tooltip>
                <UserPanel />
              </div>
            </header>
            <RecoveryBanner />
            <main class="view-container">
              <router-view v-slot="{ Component }">
                <transition name="page-fade" mode="out-in">
                  <component :is="Component" />
                </transition>
              </router-view>
            </main>
          </section>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
