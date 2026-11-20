<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NAlert, NButton, NInput, NInputNumber, NSelect, NSpin, NTag } from 'naive-ui';
import {
  ArrowLeft, ArrowRight, BookMarked, FileInput, Flame, Layers,
  Network, RefreshCw, Settings2, Shuffle, Sparkles, Upload, WandSparkles,
} from 'lucide-vue-next';
import type { OutlineVolumeDraft, ReferenceExcerpt } from '../../shared/models';
import VolumeDraftEditor from '../components/VolumeDraftEditor.vue';
import { useAppStore } from '../stores/app';
import { errorText, message, unwrap } from '../utils/api';

type WizardMode = 'spark' | 'classic' | 'import' | 'forge';

const store = useAppStore();
const router = useRouter();
const modes: { key: WizardMode; title: string; caption: string; description: string; icon: typeof Sparkles }[] = [
  { key: 'spark', title: '灵感火花', caption: '从一句话开始', description: '给出一个念头、画面或人物，让 AI 长出世界规则、人物关系与主线冲突。', icon: Sparkles },
  { key: 'classic', title: '经典仿写', caption: '借结构，不借内容', description: '描述你欣赏的叙事气质与节奏参考，保留原创设定，借鉴成熟的故事结构。', icon: BookMarked },
  { key: 'import', title: '智能导入', caption: '整理已有素材', description: '粘贴已有的梗概、设定或片段，让 AI 提炼成可执行的总纲与卷章结构。', icon: FileInput },
  { key: 'forge', title: '熔炉仿写', caption: '融合多个灵感', description: '把多个灵感碎片投入熔炉，重组冲突、人物与世界观，锻造成一条新主线。', icon: Flame },
];
const steps = [
  { title: '创作方式', caption: '选择起点' },
  { title: '作品信息', caption: '确定题材与篇幅' },
  { title: '故事总纲', caption: '生成全书主线' },
  { title: '卷章大纲', caption: '拆分卷与章' },
];
const genreOptions = ['长篇小说', '短篇小说', '悬疑推理', '玄幻奇幻', '科幻未来', '都市现实', '历史架空', '剧本', '其他']
  .map((value) => ({ label: value, value }));
const placeholders: Record<WizardMode, string> = {
  spark: '例如：末日倒计时第七天，一个只想活下去的普通人，意外拿到了能重启时间的怀表。',
  classic: '例如：参考古典武侠的章回节奏与群像推进，但故事发生在近未来海上城市。',
  import: '把已有梗概、人物设定或片段粘贴到这里，AI 会整理成结构化大纲。',
  forge: '例如：融合“深海孤岛求生”与“记忆可交易”两个点子，写一部悬疑长篇。',
};

const step = ref(0);
const mode = ref<WizardMode>('spark');
const form = reactive({
  title: '', genre: '长篇小说', description: '', volumeCount: 3, chapterCount: 8,
});
const master = ref('');
const volumes = ref<OutlineVolumeDraft[]>([]);
const reference = ref<ReferenceExcerpt | null>(null);
const pickingReference = ref(false);
const generatingMaster = ref(false);
const generatingVolumes = ref(false);
const creating = ref(false);
const aiError = ref('');
const activeMode = computed(() => modes.find((item) => item.key === mode.value) || modes[0]);

type SparkKey = 'track' | 'world' | 'protagonist' | 'power' | 'conflict';
const sparkSlots: { key: SparkKey; label: string; hint: string; options: string[] }[] = [
  {
    key: 'track', label: '赛道题材', hint: '悬疑、玄幻、科幻、现实……',
    options: ['近未来悬疑', '东方玄幻', '都市异能', '历史架空', '末日废土', '海洋冒险', '赛博科幻', '民俗灵异'],
  },
  {
    key: 'world', label: '世界设定', hint: '一条最关键的世界规则',
    options: [
      '记忆可以被买卖，但卖出后无法找回', '每逢满月，城市会多出一条不存在的街',
      '所有人十八岁必须选择一种职业并终身不得更改', '潮汐每天上涨一米，陆地正在消失',
      '梦境会被官方记录并作为证据', '文字写下的誓言会真实生效', '死者可以留下七天的回声', '时间以拍卖行的形式流通',
    ],
  },
  {
    key: 'protagonist', label: '主角设定', hint: '身份、目标与缺口',
    options: [
      '只想活下去的灯塔守夜人', '被逐出师门的档案修复师', '替人顶罪的底层拳手',
      '能听见谎言的实习记者', '带着女儿逃亡的前特工', '失去全部记忆的赏金猎人',
      '被家族遗忘的庶子', '在小城开旧书店的中年人',
    ],
  },
  {
    key: 'power', label: '金手指', hint: '能力、限制与代价',
    options: [
      '能重启时间，但每次都会失去一段记忆', '可以借走他人的一项技能二十四小时',
      '看见他人头顶的死亡倒计时', '在梦中进入别人的过去', '写下的故事会短暂成为现实',
      '能听懂动物说出的秘密', '受伤后可以读取伤口主人的最后画面', '拥有一本会自己补充线索的旧笔记本',
    ],
  },
  {
    key: 'conflict', label: '核心冲突', hint: '主角最想做成、又最难做成的事',
    options: [
      '在倒计时结束前找回失踪的姐姐', '揭开城市潮汐背后的真相', '洗清一项从未犯过的罪名',
      '阻止一场所有人都认为不会发生的灾难', '在记忆被彻底清空前留下证据',
      '保护一个不该被保护的人', '夺回被家族夺走的名字', '让死去的人重新被世界记住',
    ],
  },
];
const sparks = reactive<Record<SparkKey, string>>({ track: '', world: '', protagonist: '', power: '', conflict: '' });
const sparkFilled = computed(() => sparkSlots.every((slot) => Boolean(sparks[slot.key])));
const sparkBrief = computed(() => sparkSlots
  .map((slot) => `【${slot.label}】${sparks[slot.key] || '待定'}`)
  .join('\n'));

function pickOption(options: string[], current: string): string {
  const pool = options.filter((option) => option !== current);
  const candidates = pool.length ? pool : options;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function drawSpark(key: SparkKey): void {
  const slot = sparkSlots.find((item) => item.key === key);
  if (!slot) return;
  sparks[key] = pickOption(slot.options, sparks[key]);
}

function drawAllSparks(): void {
  sparkSlots.forEach((slot) => drawSpark(slot.key));
}

function clearSparks(): void {
  sparkSlots.forEach((slot) => { sparks[slot.key] = ''; });
}

function adoptSparks(): void {
  if (!sparkFilled.value) { message.warning('请先把五个格子都抽满'); return; }
  form.description = `${sparkBrief.value}\n\n请据此立项：写清主角目标、最大阻碍、世界规则的代价与主线推进。`;
  step.value = 1;
  message.success('抽卡结果已写成故事想法，补充作品名即可继续');
}

async function pickReference(): Promise<void> {
  if (pickingReference.value) return;
  pickingReference.value = true;
  try {
    const picked = unwrap(await window.inkforge.reference.pickTxt());
    if (picked) {
      reference.value = picked;
      message.success(`已载入《${picked.fileName}》片段，将作为题材与节奏参考`);
    }
  } catch (error) {
    message.error(errorText(error));
  } finally {
    pickingReference.value = false;
  }
}

const referenceExcerpt = computed(() => reference.value?.excerpt);

function goNext(): void {
  if (step.value === 1) {
    if (!form.title.trim()) { message.warning('请先为作品起一个名字'); return; }
    if (!form.description.trim()) { message.warning('请用一两句话写下故事想法或创作要求'); return; }
  }
  step.value = Math.min(steps.length - 1, step.value + 1);
  aiError.value = '';
}

async function generateMaster(): Promise<void> {
  if (generatingMaster.value) return;
  if (!form.title.trim() || !form.description.trim()) { message.warning('请先填写作品名与故事想法'); return; }
  generatingMaster.value = true;
  aiError.value = '';
  try {
    const draft = unwrap(await window.inkforge.outline.generate({
      level: 'master',
      brief: form.description.trim(),
      title: form.title.trim(),
      genre: form.genre,
      volumeCount: form.volumeCount,
      chapterCount: form.chapterCount,
      reference: referenceExcerpt.value,
    }));
    master.value = draft.master;
    message.success('总纲已生成，可直接修改后再继续');
  } catch (error) {
    aiError.value = errorText(error);
  } finally {
    generatingMaster.value = false;
  }
}

async function generateVolumes(): Promise<void> {
  if (generatingVolumes.value) return;
  if (!form.title.trim() || !form.description.trim()) { message.warning('请先填写作品名与故事想法'); return; }
  generatingVolumes.value = true;
  aiError.value = '';
  try {
    const draft = unwrap(await window.inkforge.outline.generate({
      level: 'volume',
      brief: form.description.trim(),
      title: form.title.trim(),
      genre: form.genre,
      master: master.value,
      volumeCount: form.volumeCount,
      chapterCount: form.chapterCount,
      reference: referenceExcerpt.value,
    }));
    volumes.value = draft.volumes;
    message.success(`已生成 ${draft.volumes.length} 卷大纲`);
  } catch (error) {
    aiError.value = errorText(error);
  } finally {
    generatingVolumes.value = false;
  }
}

async function createWork(): Promise<void> {
  if (creating.value) return;
  if (!form.title.trim()) { message.warning('请先填写作品名'); step.value = 1; return; }
  creating.value = true;
  try {
    const work = await store.createWork({
      title: form.title.trim(),
      genre: form.genre || undefined,
      description: form.description.trim() || undefined,
    });
    if (!work) return;
    if (master.value.trim()) await store.saveMasterOutline(work.workId, master.value.trim());
    if (volumes.value.length) await store.applyOutlineDraft(work.workId, volumes.value);
    message.success(volumes.value.length ? '作品与三级大纲已创建' : '作品已创建，可以继续搭建大纲');
    await router.push(`/work/${work.workId}`);
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <div class="page wizard-page">
    <section class="wizard-card paper-card">
      <header class="wizard-head">
        <div>
          <span class="wizard-kicker">CREATION WIZARD</span>
          <h2>从一个念头，搭好整部书的骨架</h2>
          <p>按步骤确认创作方式、作品信息与三级大纲，确认后才会写入本地作品。</p>
        </div>
        <ol class="wizard-steps">
          <li v-for="(item, index) in steps" :key="item.title" :class="{ active: index === step, done: index < step }">
            <span>{{ index + 1 }}</span>
            <div><strong>{{ item.title }}</strong><small>{{ item.caption }}</small></div>
          </li>
        </ol>
      </header>

      <div class="wizard-body">
        <template v-if="step === 0">
          <div class="mode-grid">
            <button
              v-for="item in modes"
              :key="item.key"
              class="mode-card"
              :class="{ selected: mode === item.key }"
              @click="mode = item.key"
            >
              <span class="mode-icon"><component :is="item.icon" :size="20" :stroke-width="1.7" /></span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.caption }}</small>
              <p>{{ item.description }}</p>
            </button>
          </div>
          <div v-if="mode === 'spark'" class="spark-panel">
            <div class="spark-head">
              <div><strong>灵感火花抽卡</strong><small>逐格抽取故事要素，再合成为立项要点</small></div>
              <div class="spark-actions">
                <n-button size="small" secondary @click="drawAllSparks"><template #icon><shuffle :size="13" /></template>抽一套</n-button>
                <n-button size="small" quaternary @click="clearSparks">清空</n-button>
              </div>
            </div>
            <div class="spark-grid">
              <div v-for="slot in sparkSlots" :key="slot.key" class="spark-slot" :class="{ filled: sparks[slot.key] }">
                <div class="spark-slot-head">
                  <span>{{ slot.label }}</span>
                  <button @click="drawSpark(slot.key)"><refresh-cw :size="11" />换一张</button>
                </div>
                <p>{{ sparks[slot.key] || slot.hint }}</p>
              </div>
            </div>
            <div class="spark-footer">
              <span>抽卡结果只是起点，写入后仍可在下一步继续修改。</span>
              <n-button size="small" type="primary" :disabled="!sparkFilled" @click="adoptSparks">
                写成立项要点<template #icon><arrow-right :size="13" /></template>
              </n-button>
            </div>
          </div>
        </template>

        <template v-else-if="step === 1">
          <div class="wizard-form">
            <label class="form-label required">作品名称</label>
            <n-input v-model:value="form.title" maxlength="80" show-count placeholder="例如：潮汐尽头" />
            <div class="form-row">
              <div>
                <label class="form-label field-gap">作品分类</label>
                <n-select v-model:value="form.genre" :options="genreOptions" />
              </div>
              <div>
                <label class="form-label field-gap">篇幅规划</label>
                <div class="plan-row">
                  <n-input-number v-model:value="form.volumeCount" :min="1" :max="12" size="small" />
                  <span>卷</span>
                  <n-input-number v-model:value="form.chapterCount" :min="1" :max="40" size="small" />
                  <span>章 / 卷</span>
                </div>
              </div>
            </div>
            <label class="form-label field-gap required">{{ activeMode.title }}：故事想法</label>
            <n-input
              v-model:value="form.description"
              type="textarea"
              :rows="8"
              maxlength="3000"
              show-count
              :placeholder="placeholders[mode]"
            />
            <div class="reference-block">
              <div class="reference-head">
                <div><book-marked :size="14" /><strong>同类参考书</strong><small>可选，仅用于分析题材定位与叙事节奏</small></div>
                <n-button size="tiny" secondary :loading="pickingReference" @click="pickReference"><template #icon><upload :size="12" /></template>上传 TXT</n-button>
              </div>
              <p v-if="reference" class="reference-file">
                {{ reference.fileName }} · {{ reference.charCount.toLocaleString() }} 字，取前 {{ reference.excerpt.length }} 字作为结构参考
                <button @click="reference = null">移除</button>
              </p>
              <p v-else class="reference-empty">上传一部同类型作品，AI 会在总纲与卷章提示词中参考其节奏结构，并明确禁止复制原文、人物名与专有名词。</p>
            </div>
            <p class="form-hint">写清主角、目标、最大阻碍和想要的结局，生成的大纲会更贴近你的设想。</p>
          </div>
        </template>

        <template v-else-if="step === 2">
          <div class="step-toolbar">
            <div><layers :size="16" /><strong>故事总纲</strong><n-tag v-if="master" size="small" :bordered="false" type="success">已生成</n-tag></div>
            <n-button type="primary" secondary :loading="generatingMaster" @click="generateMaster">
              <template #icon><wand-sparkles :size="15" /></template>{{ master ? '重新生成' : 'AI 生成总纲' }}
            </n-button>
          </div>
          <n-alert v-if="aiError && !generatingMaster" type="error" :bordered="false" class="step-error">
            <strong>生成未完成</strong><p>{{ aiError }}</p>
            <div class="error-actions">
              <n-button size="small" secondary @click="generateMaster"><template #icon><refresh-cw :size="13" /></template>重试</n-button>
              <n-button size="small" quaternary @click="router.push('/settings')"><template #icon><settings-2 :size="13" /></template>检查模型设置</n-button>
            </div>
          </n-alert>
          <n-spin :show="generatingMaster">
            <n-input
              v-model:value="master"
              type="textarea"
              :rows="18"
              maxlength="20000"
              show-count
              placeholder="可以直接手写总纲，或点击右上角让 AI 生成：故事内核、主线阶段、主要人物、世界规则与伏笔……"
            />
          </n-spin>
          <p class="form-hint">总纲是三级大纲的第一层。它会作为卷纲和章纲生成的依据，也可以留空稍后补充。</p>
        </template>

        <template v-else>
          <div class="step-toolbar">
            <div><network :size="16" /><strong>分卷与章节大纲</strong><n-tag v-if="volumes.length" size="small" :bordered="false" type="success">{{ volumes.length }} 卷</n-tag></div>
            <n-button type="primary" secondary :loading="generatingVolumes" @click="generateVolumes">
              <template #icon><wand-sparkles :size="15" /></template>{{ volumes.length ? '重新生成' : 'AI 生成卷章大纲' }}
            </n-button>
          </div>
          <n-alert v-if="aiError && !generatingVolumes" type="error" :bordered="false" class="step-error">
            <strong>生成未完成</strong><p>{{ aiError }}</p>
            <div class="error-actions">
              <n-button size="small" secondary @click="generateVolumes"><template #icon><refresh-cw :size="13" /></template>重试</n-button>
              <n-button size="small" quaternary @click="router.push('/settings')"><template #icon><settings-2 :size="13" /></template>检查模型设置</n-button>
            </div>
          </n-alert>
          <n-spin :show="generatingVolumes">
            <div v-if="volumes.length" class="wizard-volumes">
              <volume-draft-editor v-model:volumes="volumes" />
            </div>
            <div v-else class="wizard-empty">
              <network :size="34" :stroke-width="1.3" />
              <h3>还没有卷章大纲</h3>
              <p>可以选择 AI 生成，也可以直接创建空作品，进入作品空间后手动搭建。</p>
            </div>
          </n-spin>
          <p class="form-hint">确认创建后会一次性写入分卷与章节节点，章节正文保持为空，随时可以开始写作。</p>
        </template>
      </div>

      <footer class="wizard-footer">
        <n-button v-if="step > 0" quaternary :disabled="creating" @click="step -= 1">
          <template #icon><arrow-left :size="15" /></template>上一步
        </n-button>
        <span class="footer-spacer" />
        <n-button v-if="step < steps.length - 1" type="primary" @click="goNext">
          下一步<template #icon><arrow-right :size="15" /></template>
        </n-button>
        <n-button v-else type="primary" :loading="creating" @click="createWork">
          <template #icon><sparkles :size="16" /></template>创建作品并进入
        </n-button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.wizard-card { padding: 24px 26px 20px; }
.wizard-head { display: flex; justify-content: space-between; gap: 26px; padding-bottom: 18px; border-bottom: 1px solid #e9ede8; }
.wizard-kicker { color: #8aa294; font-size: 8px; font-weight: 600; letter-spacing: 1.8px; }
.wizard-head h2 { margin: 9px 0 7px; color: #2b4338; font-family: "STSong", "SimSun", serif; font-size: 22px; font-weight: 600; }
.wizard-head p { margin: 0; color: #86948c; font-size: 11px; }
.wizard-steps { display: flex; gap: 6px; padding: 0; margin: 2px 0 0; list-style: none; }
.wizard-steps li { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 7px; }
.wizard-steps li > span { display: grid; flex: 0 0 22px; height: 22px; place-items: center; color: #9aa89f; background: #eef2ed; border-radius: 50%; font-size: 10px; }
.wizard-steps strong, .wizard-steps small { display: block; white-space: nowrap; }
.wizard-steps strong { color: #7e8f85; font-size: 10px; font-weight: 600; }
.wizard-steps small { color: #a3aea7; font-size: 8px; }
.wizard-steps li.active { background: #eef4ef; }
.wizard-steps li.active > span { color: #fff; background: #42705c; }
.wizard-steps li.active strong { color: #2f5143; }
.wizard-steps li.done > span { color: #3d6b57; background: #dcebe0; }
.wizard-body { min-height: 355px; padding: 20px 0 10px; }
.mode-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 13px; }
.mode-card { display: flex; min-height: 208px; flex-direction: column; align-items: flex-start; gap: 6px; padding: 18px 16px; text-align: left; cursor: pointer; background: #fbfcfa; border: 1px solid #e2e9e2; border-radius: 10px; transition: border-color .16s, box-shadow .16s, transform .16s; }
.mode-card:hover { border-color: #b7ccbd; transform: translateY(-2px); }
.mode-card.selected { background: #f1f6f1; border-color: #5f8b74; box-shadow: 0 6px 18px rgba(45,88,67,.09); }
.mode-icon { display: grid; width: 38px; height: 38px; margin-bottom: 5px; place-items: center; color: #4f7a66; background: #e9f1ea; border-radius: 9px; }
.mode-card strong { color: #355245; font-size: 13px; font-weight: 600; }
.mode-card small { color: #8ca095; font-size: 9px; }
.mode-card p { margin: 4px 0 0; color: #84948b; font-size: 10px; line-height: 1.75; }
.wizard-form { max-width: 760px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.plan-row { display: flex; align-items: center; gap: 7px; color: #8b9a92; font-size: 10px; }
.plan-row :deep(.n-input-number) { width: 86px; }
.form-hint { margin: 9px 0 0; color: #98a49c; font-size: 10px; line-height: 1.7; }
.step-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
.step-toolbar > div { display: flex; align-items: center; gap: 8px; color: #4c6f5d; }
.step-toolbar strong { color: #355246; font-size: 13px; font-weight: 600; }
.step-error { margin-bottom: 12px; }
.step-error p { margin: 4px 0 8px; font-size: 11px; }
.error-actions { display: flex; gap: 8px; }
.wizard-volumes { max-height: 400px; padding-right: 5px; overflow-y: auto; }
.wizard-empty { display: flex; min-height: 250px; flex-direction: column; align-items: center; justify-content: center; color: #9aa89f; text-align: center; }
.wizard-empty h3 { margin: 9px 0 6px; color: #52685c; font-size: 13px; }
.wizard-empty p { max-width: 390px; margin: 0; font-size: 10px; line-height: 1.75; }
.wizard-footer { display: flex; align-items: center; padding-top: 14px; border-top: 1px solid #e9ede8; }
.footer-spacer { flex: 1; }
.spark-panel { padding: 14px; margin-top: 16px; background: linear-gradient(135deg, #f5f9f4, #fbfcfa); border: 1px solid #e4ebe4; border-radius: 10px; }
.spark-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 11px; }
.spark-head strong, .spark-head small { display: block; }
.spark-head strong { color: #3c584a; font-size: 12px; }
.spark-head small { margin-top: 2px; color: #93a198; font-size: 9px; }
.spark-actions { display: flex; gap: 6px; }
.spark-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 9px; }
.spark-slot { display: flex; min-height: 112px; flex-direction: column; padding: 10px; background: #fff; border: 1px dashed #dde6de; border-radius: 8px; }
.spark-slot.filled { background: #f4f9f4; border-style: solid; border-color: #c3d7c8; }
.spark-slot-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.spark-slot-head span { color: #547061; font-size: 10px; font-weight: 600; }
.spark-slot-head button { display: flex; align-items: center; gap: 3px; padding: 2px 4px; color: #8a9c90; cursor: pointer; background: none; border: 0; font-size: 8px; }
.spark-slot-head button:hover { color: #2b6b55; }
.spark-slot p { margin: 8px 0 0; color: #85958b; font-size: 10px; line-height: 1.7; }
.spark-slot.filled p { color: #40574c; }
.spark-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
.spark-footer span { color: #98a49c; font-size: 9px; }
.reference-block { padding: 11px 12px; margin-top: 14px; background: #f7faf6; border: 1px solid #e4ebe4; border-radius: 8px; }
.reference-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.reference-head > div { display: flex; align-items: center; gap: 6px; color: #4c705e; }
.reference-head strong { color: #3c584a; font-size: 10px; font-weight: 600; }
.reference-head small { color: #98a49c; font-size: 9px; }
.reference-file, .reference-empty { margin: 7px 0 0; color: #7f9086; font-size: 10px; line-height: 1.7; }
.reference-file button { padding: 0; margin-left: 6px; color: #4f7a66; cursor: pointer; background: none; border: 0; font-size: 9px; text-decoration: underline; }
.reference-empty { color: #9aa79f; }
@media (max-width: 1200px) { .wizard-steps small { display: none; }.mode-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.spark-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
