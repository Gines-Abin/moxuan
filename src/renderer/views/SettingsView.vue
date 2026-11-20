<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NAlert, NButton, NInput, NInputNumber, NModal, NSpin, NSwitch, NTag, NTooltip,
} from 'naive-ui';
import {
  Check, CloudCog, Cpu, HardDrive, KeyRound, LockKeyhole, Pencil, Plus, Server,
  Settings2, ShieldCheck, Sparkles, Trash2, Wifi, LifeBuoy,
} from 'lucide-vue-next';
import type { PublicProvider } from '../../shared/models';
import { useAppStore } from '../stores/app';
import { dialog, message, reportError, unwrap } from '../utils/api';

type ProviderForm = {
  id?: string; name: string; baseURL: string; apiKey: string; modelChat: string;
  isDefault: boolean; temperature: number; maxTokens: number;
};
type Preset = { key: string; name: string; baseURL: string; modelChat: string; hint: string };

const store = useAppStore();
const showEditor = ref(false);
const saving = ref(false);
const testingId = ref('');
const activatingId = ref('');
const editingId = ref<string | null>(null);
const form = reactive<ProviderForm>({ name: '', baseURL: '', apiKey: '', modelChat: '', isDefault: false, temperature: 0.7, maxTokens: 4096 });
const presets: Preset[] = [
  { key: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', modelChat: 'deepseek-chat', hint: '高性价比中文创作' },
  { key: 'openai', name: 'OpenAI', baseURL: 'https://api.openai.com/v1', modelChat: 'gpt-4o-mini', hint: '兼容 OpenAI API' },
  { key: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', modelChat: 'llama3.1', hint: '本地运行，无需密钥' },
];
const editingProvider = computed(() => store.providers.find((provider) => provider.id === editingId.value));

onMounted(() => {
  if (!store.providers.length) void store.loadProviders();
});

function openCreate(preset?: Preset): void {
  editingId.value = null;
  Object.assign(form, {
    id: undefined, name: preset?.name || '', baseURL: preset?.baseURL || '', apiKey: '',
    modelChat: preset?.modelChat || '', isDefault: store.providers.length === 0, temperature: 0.7, maxTokens: 4096,
  });
  showEditor.value = true;
}

function openEdit(provider: PublicProvider): void {
  editingId.value = provider.id;
  Object.assign(form, {
    id: provider.id, name: provider.name, baseURL: provider.baseURL, apiKey: '', modelChat: provider.modelChat,
    isDefault: provider.isDefault, temperature: provider.temperature, maxTokens: provider.maxTokens,
  });
  showEditor.value = true;
}

async function save(): Promise<void> {
  if (!form.name.trim() || !form.baseURL.trim() || !form.modelChat.trim()) {
    message.warning('请完整填写服务名称、Base URL 和对话模型');
    return;
  }
  try { new URL(form.baseURL); } catch { message.warning('Base URL 格式不正确，请包含 http:// 或 https://'); return; }
  saving.value = true;
  const result = await store.saveProvider({
    id: editingId.value || undefined, name: form.name.trim(), baseURL: form.baseURL.trim().replace(/\/$/, ''),
    apiKey: form.apiKey || undefined, modelChat: form.modelChat.trim(), isDefault: form.isDefault,
    temperature: form.temperature, maxTokens: form.maxTokens,
  });
  saving.value = false;
  if (result) { showEditor.value = false; message.success(editingId.value ? '模型服务配置已更新' : '模型服务已添加'); }
}

async function test(provider: PublicProvider): Promise<void> {
  testingId.value = provider.id;
  try {
    const result = unwrap(await window.inkforge.provider.test(provider.id));
    message.success(`连接成功，延迟 ${result.latencyMs} ms`);
  } catch (error) {
    reportError(error);
  } finally {
    testingId.value = '';
  }
}

async function activate(provider: PublicProvider): Promise<void> {
  activatingId.value = provider.id;
  if (await store.activateProvider(provider.id)) message.success(`已启用 ${provider.name}`);
  activatingId.value = '';
}

function remove(provider: PublicProvider): void {
  dialog.warning({
    title: `删除模型服务“${provider.name}”？`,
    content: provider.isDefault ? '这是当前启用的服务。删除后，AI 生成与一致性检查将不可用，直到你启用其他服务。' : '仅删除此服务配置，不会影响任何作品、正文或设定卡。',
    positiveText: '确认删除', negativeText: '取消',
    onPositiveClick: async () => { if (await store.deleteProvider(provider.id)) message.success('模型服务配置已删除'); },
  });
}

async function changeCompliance(value: boolean): Promise<void> {
  if (await store.setExportCompliance(value)) message.success(value ? '导出时将显示合规提示' : '已关闭导出前合规提示');
}
</script>

<template>
  <div class="page settings-page">
    <div class="page-header"><div><h2>模型与偏好设置</h2><p>连接你信任的模型服务，管理本地写作体验。</p></div><n-button type="primary" @click="openCreate()"><template #icon><plus :size="16" /></template>添加模型服务</n-button></div>
    <div class="settings-layout">
      <div class="settings-main">
        <section class="settings-section paper-card">
          <div class="section-title"><div><h3><cloud-cog :size="17" />模型服务</h3><p>用于 AI 续写、润色与一致性检查。密钥由本地后端安全保存。</p></div><span>{{ store.providers.length }} 个服务</span></div>
          <div class="preset-row"><span>快速添加</span><button v-for="preset in presets" :key="preset.key" @click="openCreate(preset)"><cpu :size="14" /><div><strong>{{ preset.name }}</strong><small>{{ preset.hint }}</small></div><plus :size="13" /></button></div>
          <n-spin :show="store.loadingProviders">
            <div v-if="store.providers.length" class="provider-list">
              <article v-for="provider in store.providers" :key="provider.id" class="provider-item" :class="{ active: provider.isDefault }">
                <div class="provider-logo"><server :size="20" /></div>
                <div class="provider-info"><div class="provider-name"><strong>{{ provider.name }}</strong><n-tag v-if="provider.isDefault" size="small" type="success" :bordered="false"><template #icon><check :size="10" /></template>当前启用</n-tag></div><span class="provider-url mono">{{ provider.baseURL }}</span><div class="provider-meta"><span>{{ provider.modelChat }}</span><i /><span>温度 {{ provider.temperature }}</span><i /><span>{{ provider.maxTokens }} tokens</span><i /><span :class="{ 'key-missing': !provider.hasApiKey }"><key-round :size="11" />{{ provider.hasApiKey ? '密钥已保存' : '未配置密钥' }}</span></div></div>
                <div class="provider-actions"><n-button v-if="!provider.isDefault" size="small" type="primary" secondary :loading="activatingId === provider.id" @click="activate(provider)">启用</n-button><n-button size="small" quaternary :loading="testingId === provider.id" @click="test(provider)"><template #icon><wifi :size="14" /></template>测试</n-button><n-tooltip><template #trigger><button @click="openEdit(provider)"><pencil :size="15" /></button></template>编辑配置</n-tooltip><n-tooltip><template #trigger><button class="danger" @click="remove(provider)"><trash2 :size="15" /></button></template>删除配置</n-tooltip></div>
              </article>
            </div>
            <div v-else class="provider-empty"><div class="empty-icon"><cloud-cog :size="27" /></div><h3>还没有模型服务</h3><p>从上方选择一个预设，填写 API 地址与密钥。配置完成前，正文写作和自动保存仍可正常使用。</p><n-button type="primary" @click="openCreate(presets[0])">配置 DeepSeek</n-button></div>
          </n-spin>
        </section>
        <section class="settings-section paper-card export-settings"><div class="section-title"><div><h3><settings2 :size="17" />导出偏好</h3><p>管理导出作品前的内容确认流程。</p></div></div><div class="setting-switch-row"><div><strong>导出前显示合规提示</strong><p>每次导出时展示人工审校与 AI 发布合规声明，需确认后才能继续。</p></div><n-switch :value="store.showExportCompliance" @update:value="changeCompliance" /></div></section>
      </div>
      <aside class="settings-side">
        <section class="paper-card privacy-card"><div class="privacy-shield"><shield-check :size="25" /></div><h3>隐私与数据边界</h3><p class="privacy-lead">你的创作，应当由你掌握。</p><div class="privacy-point"><hard-drive :size="16" /><div><strong>文稿本地保存</strong><p>作品、章节、设定与快照保存在本机数据目录，不提供云同步。</p></div></div><div class="privacy-point"><key-round :size="16" /><div><strong>密钥不在界面明文展示</strong><p>渲染层只读取“是否已配置”，不会读取已保存的密钥内容。</p></div></div><div class="privacy-point"><lock-keyhole :size="16" /><div><strong>按需发送上下文</strong><p>调用 AI 时，章节正文与所选设定会发送给你启用的模型服务，请审阅其隐私政策。</p></div></div><div v-if="store.appInfo" class="data-path"><span>本地数据目录</span><code>{{ store.appInfo.dataDirectory }}</code><small>{{ store.appInfo.platform }} · v{{ store.appInfo.version }}</small></div></section>
        <section class="paper-card troubleshoot-card">
          <div class="troubleshoot-head"><life-buoy :size="17" /><div><h3>AI 调用排查</h3><p>请求失败时，按错误提示检查以下位置。</p></div></div>
          <div class="troubleshoot-item"><strong>余额或配额不足（402）</strong><span>到模型服务商控制台充值或提高额度；墨轩内没有充值、会员与订单入口。</span></div>
          <div class="troubleshoot-item"><strong>密钥无效或无权访问（401/403）</strong><span>重新保存 API Key，或确认该密钥可访问当前模型。</span></div>
          <div class="troubleshoot-item"><strong>请求过于频繁（429）</strong><span>稍后重试，或在设置中启用另一个模型服务。</span></div>
          <div class="troubleshoot-item"><strong>连接失败或超时</strong><span>检查 Base URL、网络，以及本地 Ollama 是否已启动。</span></div>
        </section>
        <section class="paper-card compliance-card"><div><sparkles :size="17" /><h3>AI 发布合规声明</h3></div><p>AI 生成内容仅作为创作辅助，不代表事实陈述或专业建议。发布前请进行人工审校，确认不侵犯他人著作权、隐私及其他合法权益。</p><p>请遵守所在地法律法规和发布平台规则，按要求标识 AI 生成或辅助创作内容。最终内容由使用者负责。</p></section>
      </aside>
    </div>

    <n-modal v-model:show="showEditor" preset="card" :title="editingId ? '编辑模型服务' : '添加模型服务'" class="provider-modal" :mask-closable="!saving">
      <div class="provider-presets-inline"><span>使用预设</span><button v-for="preset in presets" :key="preset.key" @click="Object.assign(form, { name: preset.name, baseURL: preset.baseURL, modelChat: preset.modelChat })">{{ preset.name }}</button></div>
      <label class="form-label required field-gap">服务名称</label><n-input v-model:value="form.name" maxlength="80" placeholder="例如：我的 DeepSeek" />
      <label class="form-label required field-gap">Base URL</label><n-input v-model:value="form.baseURL" placeholder="https://api.example.com/v1"><template #prefix><server :size="14" /></template></n-input><p class="form-tip">通常以 /v1 结尾；Ollama 本地默认地址为 http://127.0.0.1:11434/v1</p>
      <label class="form-label field-gap">API Key</label><n-input v-model:value="form.apiKey" type="password" show-password-on="click" :placeholder="editingProvider?.hasApiKey ? '留空则保留已保存的密钥' : '输入 API Key；本地 Ollama 可留空'" autocomplete="off"><template #prefix><key-round :size="14" /></template></n-input><p v-if="editingProvider?.hasApiKey" class="form-tip">当前服务已保存密钥。仅在需要替换时输入新密钥。</p>
      <div class="provider-form-grid field-gap"><div><label class="form-label required">对话模型</label><n-input v-model:value="form.modelChat" placeholder="例如：deepseek-chat" /></div><div><label class="form-label">最大输出 Tokens</label><n-input-number v-model:value="form.maxTokens" :min="128" :max="131072" :step="512" /></div></div>
      <div class="provider-form-grid field-gap"><div><label class="form-label">生成温度</label><n-input-number v-model:value="form.temperature" :min="0" :max="2" :step="0.1" :precision="1" /></div><div class="default-switch"><label class="form-label">默认服务</label><n-switch v-model:value="form.isDefault"><template #checked>启用</template><template #unchecked>不启用</template></n-switch></div></div>
      <n-alert type="info" :bordered="false" class="provider-note">保存后可先执行连接测试。测试会实际请求模型服务，可能产生少量 API 费用。</n-alert>
      <div class="modal-footer"><n-button @click="showEditor = false">取消</n-button><n-button type="primary" :loading="saving" @click="save">保存配置</n-button></div>
    </n-modal>
  </div>
</template>

<style scoped>
.settings-layout { display: grid; grid-template-columns: minmax(0,1.8fr) minmax(275px,.7fr); gap: 17px; align-items: start; }.settings-main { display: flex; flex-direction: column; gap: 15px; }.settings-section { padding: 19px; }.settings-section .section-title { align-items: flex-start; }.settings-section .section-title > div > h3 { margin-bottom: 5px; }.settings-section .section-title p { margin: 0 0 0 25px; color: #97a299; font-size: 9px; }.preset-row { display: flex; align-items: center; gap: 8px; padding: 12px; margin: 14px 0; background: #f7f9f5; border-radius: 8px; }.preset-row > span { margin-right: 2px; color: #8e9b92; font-size: 9px; }.preset-row > button { display: flex; flex: 1; align-items: center; gap: 7px; min-width: 0; padding: 8px; color: #658172; text-align: left; cursor: pointer; background: #fff; border: 1px solid #e1e7e0; border-radius: 7px; }.preset-row > button:hover { border-color: #abc3b2; }.preset-row > button > div { flex: 1; min-width: 0; }.preset-row strong,.preset-row small { display: block; }.preset-row strong { color: #496256; font-size: 10px; }.preset-row small { margin-top: 3px; overflow: hidden; color: #9aa59d; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.provider-list { display: flex; flex-direction: column; gap: 9px; }.provider-item { display: flex; align-items: center; gap: 12px; padding: 13px; border: 1px solid #e4e9e3; border-radius: 9px; }.provider-item.active { background: #fbfdfb; border-color: #bdd3c3; }.provider-logo { display: grid; flex: 0 0 39px; height: 40px; place-items: center; color: #6c8b7b; background: #edf3ee; border-radius: 8px; }.provider-item.active .provider-logo { color: #376c57; background: #e4efe6; }.provider-info { flex: 1; min-width: 0; }.provider-name { display: flex; align-items: center; gap: 7px; }.provider-name strong { color: #3c5448; font-size: 12px; }.provider-url { display: block; margin: 5px 0; overflow: hidden; color: #88958d; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.provider-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #96a199; font-size: 8px; }.provider-meta i { width: 1px; height: 8px; background: #dfe5df; }.provider-meta span { display: flex; align-items: center; gap: 3px; }.provider-meta .key-missing { color: #ad8145; }.provider-actions { display: flex; align-items: center; gap: 2px; }.provider-actions > button:not(.n-button) { display: grid; width: 28px; height: 28px; place-items: center; color: #809087; cursor: pointer; background: transparent; border: 0; border-radius: 5px; }.provider-actions > button:not(.n-button):hover { color: #326c57; background: #edf3ee; }.provider-actions > button.danger:hover { color: #b64f49; background: #fbefed; }.provider-empty { display: flex; min-height: 250px; flex-direction: column; align-items: center; justify-content: center; text-align: center; }.provider-empty h3 { margin: 0 0 7px; color: #50655a; font-size: 13px; }.provider-empty p { max-width: 380px; margin: 0 0 16px; color: #95a198; font-size: 10px; line-height: 1.8; }.export-settings { padding-bottom: 15px; }.setting-switch-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0 0; border-top: 1px solid #edf0ec; }.setting-switch-row strong { color: #4e6257; font-size: 11px; }.setting-switch-row p { margin: 5px 0 0; color: #96a199; font-size: 9px; }.settings-side { display: flex; flex-direction: column; gap: 14px; }.privacy-card { padding: 21px; }.privacy-shield { display: grid; width: 45px; height: 46px; margin-bottom: 13px; place-items: center; color: #42735e; background: #e6f0e7; border-radius: 11px; }.privacy-card h3 { margin: 0 0 5px; color: #3a5648; font-size: 14px; }.privacy-lead { margin: 0 0 18px; color: #8d9b91; font-size: 10px; }.privacy-point { display: flex; align-items: flex-start; gap: 9px; padding: 12px 0; color: #729080; border-top: 1px solid #edf0ec; }.privacy-point strong { color: #54685c; font-size: 10px; }.privacy-point p { margin: 5px 0 0; color: #8d9a91; font-size: 9px; line-height: 1.75; }.data-path { padding: 10px; margin-top: 9px; background: #f5f7f3; border-radius: 7px; }.data-path span,.data-path code,.data-path small { display: block; }.data-path span { margin-bottom: 5px; color: #87968c; font-size: 8px; }.data-path code { overflow-wrap: anywhere; color: #6b8073; font-size: 8px; line-height: 1.6; }.data-path small { margin-top: 6px; color: #a0aaa3; font-size: 8px; }.compliance-card { padding: 18px; background: #faf8f1; border-color: #e9e3d2; }.compliance-card > div { display: flex; align-items: center; gap: 7px; color: #9a7e4b; }.compliance-card h3 { margin: 0; color: #756746; font-size: 11px; }.compliance-card p { margin: 10px 0 0; color: #93886d; font-size: 9px; line-height: 1.85; }.provider-modal { width: 590px; }.provider-presets-inline { display: flex; align-items: center; gap: 6px; }.provider-presets-inline > span { margin-right: 3px; color: #8e9a92; font-size: 9px; }.provider-presets-inline button { padding: 5px 10px; color: #537a67; cursor: pointer; background: #eef4ee; border: 1px solid #e0e9e0; border-radius: 5px; font-size: 9px; }.provider-presets-inline button:hover { border-color: #a9c1b0; }.field-gap { margin-top: 16px; }.provider-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.provider-form-grid .n-input-number { width: 100%; }.default-switch { padding-left: 8px; }.provider-note { margin-top: 18px; font-size: 10px; }
.troubleshoot-card { padding: 18px; }
.troubleshoot-head { display: flex; align-items: flex-start; gap: 8px; color: #667f72; }
.troubleshoot-head h3 { margin: 0; color: #486154; font-size: 12px; }
.troubleshoot-head p { margin: 4px 0 0; color: #97a299; font-size: 9px; }
.troubleshoot-item { padding: 9px 0 0; margin-top: 9px; border-top: 1px solid #edf0ec; }
.troubleshoot-item strong { display: block; color: #586d61; font-size: 9px; }
.troubleshoot-item span { display: block; margin-top: 4px; color: #93a097; font-size: 8px; line-height: 1.7; }
@media(max-width:1250px){.settings-layout{grid-template-columns:minmax(0,1.6fr) 270px}.provider-meta i,.provider-meta span:nth-of-type(3){display:none}.provider-actions{flex-wrap:wrap;justify-content:flex-end;max-width:150px}.preset-row{flex-wrap:wrap}.preset-row>span{width:100%}}
</style>
