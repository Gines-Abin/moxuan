import { createRouter, createWebHashHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('./views/DashboardView.vue'),
      meta: { title: '工作台', subtitle: '从一个念头，到一部完整作品' },
    },
    {
      path: '/wizard',
      name: 'wizard',
      component: () => import('./views/WizardView.vue'),
      meta: { title: '创作向导', subtitle: '从灵感到三级大纲，搭好故事骨架' },
    },
    {
      path: '/work/:workId',
      name: 'work',
      component: () => import('./views/WorkView.vue'),
      meta: { title: '作品空间', subtitle: '组织故事脉络，沉淀作品设定' },
    },
    {
      path: '/work/:workId/finish',
      name: 'finish',
      component: () => import('./views/FinishView.vue'),
      meta: { title: '完结检查', subtitle: '通读全书，收束线索，交付完整作品' },
    },
    {
      path: '/work/:workId/chapter/:chapterId',
      name: 'chapter',
      component: () => import('./views/ChapterEditorView.vue'),
      meta: { title: '章节写作', subtitle: '专注文字，让灵感自然延展' },
    },
    {
      path: '/scripts',
      name: 'scripts',
      component: () => import('./views/ScriptsView.vue'),
      meta: { title: '剧本工作台', subtitle: '元素到分集正文，三步完成短剧剧本' },
    },
    {
      path: '/prompts',
      name: 'prompts',
      component: () => import('./views/PromptsView.vue'),
      meta: { title: '提示词库', subtitle: '管理适合你的 AI 写作指令' },
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('./views/HistoryView.vue'),
      meta: { title: '生成历史', subtitle: '找回生成过的内容，查看本地 token 消耗' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { title: '设置', subtitle: '模型服务、隐私与导出偏好' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.afterEach((to) => {
  document.title = `${String(to.meta.title || '工作台')} · 墨轩 MoXuan`;
});
