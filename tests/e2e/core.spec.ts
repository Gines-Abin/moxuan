import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from 'playwright';

let app: ElectronApplication;
let page: Page;
let server: Server;
let dataDirectory: string;
let baseURL: string;

function jsonResponse(response: import('node:http').ServerResponse, payload: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function streamResponse(response: import('node:http').ServerResponse, text: string): void {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
  response.end(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8 } })}\n\ndata: [DONE]\n\n`);
}

async function selectAiScene(label: string): Promise<void> {
  await page.locator('.assistant-panel .n-select').first().click();
  await page.locator('.n-base-select-option').filter({ hasText: label }).last().click();
}

async function currentContent(workId: string, chapterId: string): Promise<string> {
  return page.evaluate(async ({ workId, chapterId }) => {
    const result = await (window as any).inkforge.chapter.get(workId, chapterId);
    if (result.code !== 0) throw new Error(result.message);
    return result.data.content as string;
  }, { workId, chapterId });
}

async function launchApp(): Promise<void> {
  const executablePath = process.env.INKFORGE_EXECUTABLE_PATH;
  const userDataDirectory = path.join(dataDirectory, 'user-data');
  app = await electron.launch({
    args: executablePath ? [`--user-data-dir=${userDataDirectory}`] : ['.', `--user-data-dir=${userDataDirectory}`],
    ...(executablePath ? { executablePath } : {}),
    cwd: process.cwd(),
    env: { ...process.env, INKFORGE_DATA_DIR: dataDirectory },
  });
  page = await app.firstWindow();
  await page.waitForFunction(() => 'inkforge' in window);
}

test.beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(tmpdir(), 'inkforge-e2e-'));
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += String(chunk); });
    request.on('end', () => {
      const payload = JSON.parse(body || '{}') as { stream?: boolean; messages?: Array<{ content?: string }> };
      const prompt = payload.messages?.[0]?.content ?? '';
      if (prompt.includes('（设定“林晚”待补全）')) {
        streamResponse(response, '引用缺失。');
        return;
      }
      if (prompt.includes('【设定：沈砚｜角色】')) {
        streamResponse(response, '引用命中。');
        return;
      }
      if (prompt === '请仅回复 OK') {
        jsonResponse(response, { choices: [{ message: { content: 'OK' } }] });
        return;
      }
      if (prompt.includes('【短剧创意任务】')) {
        jsonResponse(response, {
          choices: [{ message: { content: JSON.stringify([
            { title: '离婚当天，我成了债主', logline: '被扫地出门，转身收走整栋楼。', synopsis: '苏晚离婚当天发现前夫欠她一笔巨款，决定以债主身份重返公司。' },
            { title: '隐身总裁的替身妻', logline: '她替嫁的植物人，醒来是首富。', synopsis: '林晚替姐姐嫁入豪门，却发现丈夫一直在装睡。' },
          ]) } }],
          usage: { prompt_tokens: 24, completion_tokens: 40 },
        });
        return;
      }
      if (prompt.includes('【分集大纲任务】')) {
        jsonResponse(response, {
          choices: [{ message: { content: JSON.stringify({
            totalOutline: '苏晚离婚后步步反击，从被扫地出门到拿回属于自己的一切。',
            episodes: [
              { title: '第1集 · 离婚当天', summary: '苏晚被净身出户，却发现前夫的公司欠她巨款。' },
              { title: '第2集 · 债主上门', summary: '苏晚以债主身份重返公司，前夫当场失态。' },
            ],
          }) } }],
          usage: { prompt_tokens: 30, completion_tokens: 30 },
        });
        return;
      }
      if (prompt.includes('【单集剧本任务】')) {
        jsonResponse(response, {
          choices: [{ message: { content: prompt.includes('第 1 集')
            ? '第1集\n场景一 内景 民政局 日\n苏晚把离婚证拍在桌上。'
            : '第2集\n场景一 外景 天台 夜\n苏晚转身，反将一军。' } }],
          usage: { prompt_tokens: 30, completion_tokens: 20 },
        });
        return;
      }
      if (prompt.includes('生成一份可执行的故事总纲')) {
        jsonResponse(response, {
          choices: [{ message: { content: '## 故事内核\n\n守夜人追查灯塔失踪案。\n\n## 主线阶段\n\n开端：灯塔熄灭。发展：潮下线索。高潮：真相浮现。结局：守夜人归来。' } }],
          usage: { prompt_tokens: 24, completion_tokens: 16 },
        });
        return;
      }
      if (prompt.includes('拆解为分卷与章节大纲')) {
        jsonResponse(response, {
          choices: [{ message: { content: JSON.stringify([{
            title: '第一卷 · 暗潮',
            summary: '灯塔熄灭后，守夜人循着潮下信件追踪姐姐的踪迹。',
            chapters: [
              { title: '第一章 · 灯塔熄灭', summary: '灯塔在暴雨夜熄灭，守夜人发现姐姐留下的铜钥匙。' },
              { title: '第二章 · 潮下信', summary: '退潮后露出一封被海水浸泡的信，指向废弃码头。' },
            ],
          }]) } }],
          usage: { prompt_tokens: 30, completion_tokens: 22 },
        });
        return;
      }
      if (prompt.includes('生成单章章纲')) {
        jsonResponse(response, {
          choices: [{ message: { content: JSON.stringify({
            title: '第一章 · 灯塔熄灭',
            summary: '灯塔在暴雨夜熄灭，守夜人发现姐姐留下的铜钥匙。',
          }) } }],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        });
        return;
      }
      if (prompt.includes('本章正文中提取')) {
        jsonResponse(response, {
          choices: [{ message: { content: JSON.stringify([
            { type: 'character', title: '沈砚', content: '身份：守夜人\n性格：沉默\n外貌：深色雨衣，右手旧伤', tags: ['主角'] },
            { type: 'world', title: '灯塔', content: '废弃灯塔，暴雨夜熄灭，礁石上留有铜钥匙。', tags: ['场景'] },
            { type: 'item', title: '铜钥匙', content: '姐姐留下的铜钥匙，匙柄刻着潮汐刻度。', tags: ['道具'] },
          ]) } }],
          usage: { prompt_tokens: 30, completion_tokens: 20 },
        });
        return;
      }
      if (prompt.includes('补齐可直接使用的设定资料')) {
        jsonResponse(response, {
          choices: [{ message: { content: JSON.stringify([
            { type: 'character', title: '沈砚 · 守夜人', content: '灯塔守夜人，右手有旧伤，习惯在雨夜记录潮位。', tags: ['主角', '守夜人'] },
            { type: 'world', title: '潮汐城', content: '城市随潮汐升降，退潮时会露出被淹没的旧街。', tags: ['世界规则'] },
          ]) } }],
          usage: { prompt_tokens: 28, completion_tokens: 18 },
        });
        return;
      }
      if (prompt.includes('请直接写出下面章节的正文')) {
        jsonResponse(response, {
          choices: [{ message: { content: '第一章 · 灯塔熄灭\n\n潮声从礁石后传来，沈砚摸到门缝里的铜钥匙。' } }],
          usage: { prompt_tokens: 32, completion_tokens: 20 },
        });
        return;
      }
      if (prompt.includes('请检查《')) {
        jsonResponse(response, {
          choices: [{ message: { content: JSON.stringify([{ issueType: 'character', paragraph: '自然化后的正文。', cardTitle: '主角', explanation: '年龄与设定冲突', suggestion: '统一主角年龄' }]) } }],
          usage: { prompt_tokens: 18, completion_tokens: 6 },
        });
        return;
      }
      if (prompt.includes('请重写下列文字')) {
        streamResponse(response, '自然化后的正文。');
        return;
      }
      if (prompt.includes('请润色《')) {
        streamResponse(response, '润色后的正文。');
        return;
      }
      streamResponse(response, '续写的一小段。');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  await launchApp();
});

test.afterEach(async () => {
  if (app) await app.close().catch(() => undefined);
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
});

test('本地写作到 AI 采纳、一致性处置与导出的完整闭环', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async ({ baseURL }) => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '端到端作品', description: '本地测试' })).data;
    const card = (await api.card.upsert({
      workId: work.workId, type: 'character', title: '主角', content: '主角二十岁', tags: [], pinned: true,
    })).data;
    const outline = (await api.outline.create({ workId: work.workId, title: '第一章', level: 1, parentId: null })).data;
    const provider = (await api.provider.upsert({
      name: '本地模拟模型', baseURL, apiKey: 'local-test-key', modelChat: 'mock-chat',
      isDefault: true, temperature: 0.7, maxTokens: 1024,
    })).data;
    return { workId: work.workId, chapterId: outline.chapter.chapterId, cardId: card.cardId, providerId: provider.id };
  }, { baseURL });
  expect(seed.chapterId).toBeTruthy();

  const securityBoundary = await page.evaluate(() => ({
    apiExposed: typeof (window as any).inkforge?.chapter?.save === 'function',
    nodeGlobalAbsent: typeof (window as any).process === 'undefined',
    requireAbsent: typeof (window as any).require === 'undefined',
    rawIpcAbsent: !('ipcRenderer' in (window as any).inkforge),
  }));
  expect(securityBoundary).toEqual({ apiExposed: true, nodeGlobalAbsent: true, requireAbsent: true, rawIpcAbsent: true });
  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);

  await page.evaluate(({ workId, chapterId }) => {
    window.location.hash = `/work/${workId}/chapter/${chapterId}`;
  }, seed);
  const editor = page.getByLabel('章节正文');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('沈砚十八岁。');
  await expect.poll(() => currentContent(seed.workId, seed.chapterId)).toBe('沈砚十八岁。');
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '生成候选内容' }).click();
  await expect(page.locator('.candidate-text')).toHaveText('续写的一小段。');
  await page.getByRole('button', { name: '采纳并保存' }).click();
  await expect(page.locator('.candidate-section')).toHaveCount(0);
  expect(await currentContent(seed.workId, seed.chapterId)).toContain('续写的一小段。');

  await editor.click();
  await editor.press('Control+A');
  await selectAiScene('润色全文');
  await expect(page.locator('.selection-hint')).toContainText('当前选区');
  await page.getByRole('button', { name: '生成候选内容' }).click();
  await expect(page.locator('.candidate-text')).toHaveText('润色后的正文。');
  await page.getByRole('button', { name: '采纳并保存' }).click();
  await expect(page.locator('.candidate-section')).toHaveCount(0);
  expect(await currentContent(seed.workId, seed.chapterId)).toBe('润色后的正文。');

  await editor.click();
  await editor.press('Control+A');
  await selectAiScene('自然化改写');
  await page.getByRole('button', { name: '生成候选内容' }).click();
  await expect(page.locator('.candidate-text')).toHaveText('自然化后的正文。');
  await page.getByRole('button', { name: '采纳并保存' }).click();
  await expect(page.locator('.candidate-section')).toHaveCount(0);
  expect(await currentContent(seed.workId, seed.chapterId)).toBe('自然化后的正文。');

  await page.getByRole('button', { name: '一致性检查' }).click();
  await page.getByRole('button', { name: '开始检查当前章节' }).click();
  await expect(page.getByText('年龄与设定冲突', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '已修正文' }).click();
  await expect(page.getByText('本轮问题已处置', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('.assistant-tabs .n-tabs-tab').filter({ hasText: '历史快照' }).click();
  await expect(page.locator('.snapshot-list article').first()).toBeVisible();
  await page.getByRole('button', { name: '新建快照' }).click();
  await expect(page.getByText('手动快照已创建', { exact: true })).toBeVisible();

  const exportPath = path.join(dataDirectory, 'chapter-export.md');
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.getByRole('button', { name: '导出本章' }).click();
  await page.locator('.compliance-alert .n-checkbox').first().click();
  await page.locator('.compliance-alert .n-checkbox').nth(1).click();
  await page.getByRole('button', { name: '选择位置并导出' }).click();
  await expect(page.getByText('导出完成', { exact: true })).toBeVisible();
  expect(await readFile(exportPath, 'utf8')).toBe('端到端作品\n\n第一章\n\n自然化后的正文。');
  expect(await page.evaluate(async () => (await (window as any).inkforge.provider.getCompliance()).data)).toBe(false);

  await expect.poll(async () => readFile(path.join(dataDirectory, 'events.log'), 'utf8').catch(() => '')).toContain('export_word_count');
  const eventLog = await readFile(path.join(dataDirectory, 'events.log'), 'utf8');
  for (const eventName of ['chapter_word_count', 'ai_continue', 'ai_call', 'polish_accept', 'knowledge_check_fix', 'export_word_count']) {
    expect(eventLog).toContain(`"event":"${eventName}"`);
  }
  expect(eventLog).not.toContain('local-test-key');
  expect(eventLog).not.toContain(baseURL);
});

test('创作向导生成总纲与三级大纲并创建作品', async () => {
  test.setTimeout(120_000);
  await page.evaluate(async ({ baseURL }) => {
    await (window as any).inkforge.provider.upsert({
      name: '本地模拟模型', baseURL, apiKey: 'local-test-key', modelChat: 'mock-chat',
      isDefault: true, temperature: 0.7, maxTokens: 1024,
    });
  }, { baseURL });

  await page.getByRole('link', { name: '创作向导' }).click();
  await expect(page.getByText('从一个念头，搭好整部书的骨架')).toBeVisible();
  await page.getByRole('button', { name: /灵感火花/ }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByPlaceholder('例如：潮汐尽头').fill('潮汐尽头');
  await page.locator('textarea').fill('灯塔守夜人追查姐姐失踪的真相。');
  await page.getByRole('button', { name: '下一步' }).click();

  await page.getByRole('button', { name: 'AI 生成总纲' }).click();
  await expect(page.locator('textarea')).toHaveValue(/守夜人追查灯塔失踪案/);
  await page.getByRole('button', { name: '下一步' }).click();

  await page.getByRole('button', { name: 'AI 生成卷章大纲' }).click();
  await expect(page.locator('.draft-volume input').first()).toHaveValue('第一卷 · 暗潮');
  await expect(page.locator('.draft-chapter input').first()).toHaveValue('第一章 · 灯塔熄灭');
  await page.getByRole('button', { name: '创建作品并进入' }).click();

  await expect(page.getByRole('heading', { name: '潮汐尽头' })).toBeVisible();
  await expect(page.getByText('第一章 · 灯塔熄灭')).toBeVisible();
  await expect(page.getByText('守夜人追查灯塔失踪案。')).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.list()).data.find((item: any) => item.title === '潮汐尽头');
    const outline = (await api.outline.list(work.workId)).data;
    const master = (await api.outline.getMaster(work.workId)).data;
    return {
      volumes: outline.filter((node: any) => node.level === 1).map((node: any) => node.title),
      chapters: outline.filter((node: any) => node.level === 2).map((node: any) => node.summary),
      master: master.content as string,
    };
  });
  expect(persisted.volumes).toEqual(['第一卷 · 暗潮']);
  expect(persisted.chapters).toHaveLength(2);
  expect(persisted.chapters[0]).toContain('铜钥匙');
  expect(persisted.master).toContain('故事内核');
});

test('自动补齐设定、生成章纲并批量写入正文', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async ({ baseURL }) => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({
      title: '批量创作作品', genre: '悬疑', description: '灯塔守夜人追查姐姐失踪的真相。',
    })).data;
    await api.outline.saveMaster(work.workId, '## 故事内核\n守夜人追查灯塔失踪案。');
    const volume = (await api.outline.create({ workId: work.workId, title: '第一卷 · 暗潮', level: 1, parentId: null })).data.node;
    const chapters: { nodeId: string; chapterId: string }[] = [];
    for (const title of ['第一章 · 灯塔熄灭', '第二章 · 潮下信', '第三章 · 废弃码头']) {
      const created = (await api.outline.create({ workId: work.workId, title, level: 2, parentId: volume.nodeId })).data;
      chapters.push({ nodeId: created.node.nodeId, chapterId: created.chapter.chapterId });
    }
    await api.provider.upsert({
      name: '本地模拟模型', baseURL, apiKey: 'local-test-key', modelChat: 'mock-chat',
      isDefault: true, temperature: 0.8, maxTokens: 1024,
    });
    return { workId: work.workId, chapters };
  }, { baseURL });

  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}`; }, seed);
  await expect(page.getByRole('heading', { name: '批量创作作品' })).toBeVisible();

  await page.getByRole('button', { name: 'AI 补齐' }).click();
  await page.getByRole('button', { name: '生成设定资料' }).click();
  await expect(page.locator('.draft-title input').first()).toHaveValue('沈砚 · 守夜人');
  await page.getByRole('button', { name: '保存选中设定' }).click();
  await expect(page.getByText('已保存 2 张设定卡', { exact: true })).toBeVisible();
  expect(await page.evaluate(async ({ workId }) => {
    return (await (window as any).inkforge.card.list(workId)).data.length;
  }, seed)).toBe(2);

  const chapterSummary = await page.evaluate(async ({ workId, chapters }) => {
    const api = (window as any).inkforge;
    const draft = (await api.outline.generate({
      level: 'chapter', brief: '守夜人追查姐姐失踪的真相。', title: '批量创作作品', genre: '悬疑',
      master: '## 故事内核\n守夜人追查灯塔失踪案。', volumeTitle: '第一卷 · 暗潮', chapterTitle: '第一章 · 灯塔熄灭',
    })).data;
    const updated = (await api.outline.update(workId, chapters[0].nodeId, { summary: draft.chapter.summary })).data;
    return updated.summary as string;
  }, seed);
  expect(chapterSummary).toContain('铜钥匙');

  await page.getByRole('button', { name: 'AI 批量写作' }).click();
  await expect(page.getByText('批量生成与审批', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始批量生成' }).click();
  await expect(page.locator('.draft-item textarea')).toHaveCount(3);
  await expect(page.locator('.draft-item textarea').first()).toHaveValue(/潮声从礁石后传来/);
  await page.getByRole('button', { name: '保存到章节' }).click();
  await expect(page.getByText('已保存 3 章正文，并创建历史快照', { exact: true })).toBeVisible();

  const contents = await page.evaluate(async ({ workId, chapters }) => {
    const api = (window as any).inkforge;
    const result: string[] = [];
    for (const chapter of chapters) {
      result.push((await api.chapter.get(workId, chapter.chapterId)).data.content as string);
    }
    return result;
  }, seed);
  expect(contents).toHaveLength(3);
  contents.forEach((text) => expect(text).toContain('潮声从礁石后传来'));
});

test('章节锁定后只读并拒绝保存，解锁后恢复编辑', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '锁定闭环作品' })).data;
    const outline = (await api.outline.create({ workId: work.workId, title: '第一章', level: 1, parentId: null })).data;
    await api.chapter.save({ workId: work.workId, chapterId: outline.chapter.chapterId, content: '锁定前的正文。', baseRevision: 0 });
    return { workId: work.workId, chapterId: outline.chapter.chapterId };
  });
  await page.evaluate(({ workId, chapterId }) => {
    window.location.hash = `/work/${workId}/chapter/${chapterId}`;
  }, seed);
  const editor = page.getByLabel('章节正文');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');

  await page.getByRole('button', { name: '锁定', exact: true }).click();
  await expect(page.locator('.locked-banner')).toContainText('本章已锁定');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  const blocked = await page.evaluate(async ({ workId, chapterId }) => {
    return (window as any).inkforge.chapter.save({ workId, chapterId, content: '越权覆盖', baseRevision: 1 });
  }, seed);
  expect(blocked.code).toBe(409);
  expect(await currentContent(seed.workId, seed.chapterId)).toBe('锁定前的正文。');

  await page.getByRole('button', { name: '解锁', exact: true }).click();
  await expect(page.locator('.locked-banner')).toHaveCount(0);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('解锁后的新正文。');
  await expect.poll(() => currentContent(seed.workId, seed.chapterId)).toBe('解锁后的新正文。');
});

test('季规划应用到分卷后按季分组展示', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '季规划作品' })).data;
    const volume = (await api.outline.create({ workId: work.workId, title: '第一卷 · 暗潮', level: 1, parentId: null })).data.node;
    await api.outline.create({ workId: work.workId, title: '第一章 · 旧标题', level: 2, parentId: volume.nodeId });
    const applied = (await api.outline.applySeasons({
      workId: work.workId,
      volumeId: volume.nodeId,
      seasons: [
        { title: '第一季 · 潮起', summary: '灯塔熄灭，主角发现铜钥匙。', chapters: [{ title: '第一章 · 灯塔熄灭', summary: '发现钥匙' }, { title: '第二章 · 潮下信', summary: '退潮露出旧街' }] },
        { title: '第二季 · 暗流', summary: '追查码头。', chapters: [{ title: '第三章 · 废弃码头', summary: '第一次正面冲突' }] },
      ],
    })).data;
    return { workId: work.workId, seasonCount: applied.seasons.length, chapterCount: applied.nodes.length };
  });
  expect(seed.seasonCount).toBe(2);
  expect(seed.chapterCount).toBe(3);

  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}`; }, seed);
  await expect(page.getByRole('heading', { name: '季规划作品' })).toBeVisible();
  await expect(page.locator('.season-label').filter({ hasText: '第一季 · 潮起' })).toBeVisible();
  await expect(page.locator('.season-label').filter({ hasText: '第二季 · 暗流' })).toBeVisible();
  await expect(page.locator('.season-label').first()).toContainText('2 章');
  await expect(page.locator('.chapter-copy > span').filter({ hasText: '第一章 · 灯塔熄灭' })).toBeVisible();
  await expect(page.locator('.chapter-copy > span').filter({ hasText: '第三章 · 废弃码头' })).toBeVisible();
});

test('完结页展示进度并导出整书与阅读页', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '完结测试作品' })).data;
    const volume = (await api.outline.create({ workId: work.workId, title: '第一卷 · 终局', level: 1, parentId: null })).data.node;
    const first = (await api.outline.create({ workId: work.workId, title: '第一章 · 归潮', level: 2, parentId: volume.nodeId })).data;
    const second = (await api.outline.create({ workId: work.workId, title: '第二章 · 灯塔', level: 2, parentId: volume.nodeId })).data;
    await api.chapter.save({ workId: work.workId, chapterId: first.chapter.chapterId, content: '第一章正文。', baseRevision: 0 });
    await api.chapter.save({ workId: work.workId, chapterId: second.chapter.chapterId, content: '第二章正文。', baseRevision: 0 });
    return { workId: work.workId };
  });
  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}/finish`; }, seed);
  await expect(page.getByRole('heading', { name: '完结测试作品 · 完结检查' })).toBeVisible();
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  await expect(page.getByText('100%', { exact: true })).toBeVisible();

  const exportPath = path.join(dataDirectory, 'book-export.md');
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.getByRole('button', { name: '导出整书' }).click();
  const compliance = page.locator('.compliance-alert .n-checkbox');
  if (await compliance.count()) {
    await compliance.first().click();
    await compliance.nth(1).click();
  }
  await page.getByRole('button', { name: '选择位置并导出' }).click();
  await expect(page.getByText('导出完成', { exact: true })).toBeVisible();
  const exported = await readFile(exportPath, 'utf8');
  expect(exported).toContain('第一章正文。');
  expect(exported).toContain('第二章正文。');

  const sharePath = path.join(dataDirectory, 'book-share.html');
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, sharePath);
  await page.locator('.format-options .n-radio-button').filter({ hasText: '阅读页' }).click();
  await expect(page.locator('.adaptation-tip')).toContainText('不包含账号、邀请码、访问统计或邀请奖励');
  await page.getByRole('button', { name: '选择位置并导出' }).click();
  await expect.poll(async () => {
    try { return await readFile(sharePath, 'utf8'); } catch { return ''; }
  }).toContain('<!doctype html>');
  const sharePage = await readFile(sharePath, 'utf8');
  expect(sharePage).toContain('完结测试作品');
  expect(sharePage).toContain('第一章 · 归潮');
  expect(sharePage).toContain('第一章正文。');
  expect(sharePage).toContain('第二章正文。');
  expect(sharePage).toContain('不包含账号、邀请码、访问统计或邀请奖励');
});

test('全局查找替换跳过锁定章节，章节可跨卷移动', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '替换与移动作品' })).data;
    const firstVolume = (await api.outline.create({ workId: work.workId, title: '第一卷 · 起点', level: 1, parentId: null })).data.node;
    const secondVolume = (await api.outline.create({ workId: work.workId, title: '第二卷 · 回声', level: 1, parentId: null })).data.node;
    const first = (await api.outline.create({ workId: work.workId, title: '第一章 · 雨夜', level: 2, parentId: firstVolume.nodeId })).data;
    const second = (await api.outline.create({ workId: work.workId, title: '第二章 · 潮声', level: 2, parentId: secondVolume.nodeId })).data;
    await api.chapter.save({ workId: work.workId, chapterId: first.chapter.chapterId, content: '沈砚走进雨夜。', baseRevision: 0 });
    await api.chapter.save({ workId: work.workId, chapterId: second.chapter.chapterId, content: '林晚在雨夜听见雨夜。', baseRevision: 0 });
    await api.chapter.lock({ workId: work.workId, chapterId: second.chapter.chapterId, locked: true });
    return {
      workId: work.workId, firstChapterId: first.chapter.chapterId, secondChapterId: second.chapter.chapterId,
      firstNodeId: first.node.nodeId, secondVolumeId: secondVolume.nodeId,
    };
  });

  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}`; }, seed);
  await expect(page.getByRole('heading', { name: '替换与移动作品' })).toBeVisible();
  await page.getByRole('button', { name: '查找替换' }).click();
  await page.locator('.replace-form .n-input input').nth(0).fill('雨夜');
  await page.locator('.replace-form .n-input input').nth(1).fill('深夜');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.locator('.hit-row')).toHaveCount(2);
  await expect(page.locator('.hit-row').filter({ hasText: '已锁定 · 跳过替换' })).toHaveCount(1);
  await page.getByRole('button', { name: '全部替换' }).click();
  await page.getByRole('button', { name: '开始替换' }).click();
  await expect(page.getByText('已替换 1 个章节，跳过 1 个锁定章节', { exact: true })).toBeVisible();
  await page.locator('.replace-modal').getByRole('button', { name: '关闭' }).click();

  const contents = await page.evaluate(async ({ workId, firstChapterId, secondChapterId }) => {
    const api = (window as any).inkforge;
    return {
      first: (await api.chapter.get(workId, firstChapterId)).data.content as string,
      second: (await api.chapter.get(workId, secondChapterId)).data.content as string,
    };
  }, seed);
  expect(contents.first).toBe('沈砚走进深夜。');
  expect(contents.second).toBe('林晚在雨夜听见雨夜。');

  const chapterRow = page.locator('.chapter-row').filter({ hasText: '第一章 · 雨夜' }).first();
  await chapterRow.locator('.chapter-actions button').last().click();
  await page.locator('.n-dropdown-option').filter({ hasText: '移动到分卷' }).click();
  const moveModal = page.locator('.n-modal').filter({ hasText: '移动章节到其他分卷' });
  await expect(moveModal).toBeVisible();
  await moveModal.locator('.n-select').click();
  await page.locator('.n-base-select-option').filter({ hasText: '第二卷 · 回声' }).click();
  await moveModal.getByRole('button', { name: '确认移动' }).click();
  await expect(page.getByText('「第一章 · 雨夜」已移动到目标分卷', { exact: true })).toBeVisible();

  const moved = await page.evaluate(async ({ workId, firstNodeId }) => {
    const outline = (await (window as any).inkforge.outline.list(workId)).data;
    return outline.find((node: any) => node.nodeId === firstNodeId);
  }, seed);
  expect(moved.parentId).toBe(seed.secondVolumeId);
  expect(moved.seasonId).toBeNull();
});

test('整书排版跳过锁定章节，设定资料可批量导入', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '排版与导入作品' })).data;
    const volume = (await api.outline.create({ workId: work.workId, title: '第一卷 · 潮声', level: 1, parentId: null })).data.node;
    const first = (await api.outline.create({ workId: work.workId, title: '第一章 · 潮声', level: 2, parentId: volume.nodeId })).data;
    const second = (await api.outline.create({ workId: work.workId, title: '第二章 · 暗礁', level: 2, parentId: volume.nodeId })).data;
    await api.chapter.save({ workId: work.workId, chapterId: first.chapter.chapterId, content: '第一段  \n\n\n\n第二段\u3000\u3000', baseRevision: 0 });
    await api.chapter.save({ workId: work.workId, chapterId: second.chapter.chapterId, content: '锁定章  ', baseRevision: 0 });
    await api.chapter.lock({ workId: work.workId, chapterId: second.chapter.chapterId, locked: true });
    return { workId: work.workId, firstChapterId: first.chapter.chapterId, secondChapterId: second.chapter.chapterId };
  });

  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}`; }, seed);
  await expect(page.getByRole('heading', { name: '排版与导入作品' })).toBeVisible();
  await page.getByRole('button', { name: '整书排版' }).click();
  await page.getByRole('button', { name: '开始排版' }).click();
  await expect(page.getByText('排版完成：修改 1 章，跳过 1 个锁定章节', { exact: true })).toBeVisible();

  const contents = await page.evaluate(async ({ workId, firstChapterId, secondChapterId }) => {
    const api = (window as any).inkforge;
    return {
      first: (await api.chapter.get(workId, firstChapterId)).data.content as string,
      second: (await api.chapter.get(workId, secondChapterId)).data.content as string,
    };
  }, seed);
  expect(contents.first).toBe('第一段\n\n第二段');
  expect(contents.second).toBe('锁定章  ');

  await page.getByRole('button', { name: /设定卡/ }).click();
  await page.getByRole('button', { name: '批量导入' }).click();
  const importModal = page.locator('.card-import-modal');
  await expect(importModal).toBeVisible();
  await importModal.locator('textarea').fill('沈砚\n身份：主角，嗅觉异常敏锐\n---\n林晚\n身份：灯塔守夜人');
  await expect(importModal.getByText('识别到 2 张卡')).toBeVisible();
  await importModal.getByRole('button', { name: '导入 2 张' }).click();
  await expect(page.getByText('已导入 2 张设定卡', { exact: true })).toBeVisible();

  const cards = await page.evaluate(async ({ workId }) => {
    const list = (await (window as any).inkforge.card.list(workId)).data as Array<{ title: string }>;
    return list.map((card) => card.title);
  }, seed);
  expect(cards.sort()).toEqual(['沈砚', '林晚'].sort());
});

test('编辑器阅读设置可调整字体、字号与背景并持久化', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '阅读设置作品' })).data;
    const volume = (await api.outline.create({ workId: work.workId, title: '第一卷', level: 1, parentId: null })).data.node;
    const chapter = (await api.outline.create({ workId: work.workId, title: '第一章 · 海风', level: 2, parentId: volume.nodeId })).data;
    await api.chapter.save({ workId: work.workId, chapterId: chapter.chapter.chapterId, content: '海风从窗缝里钻进来。', baseRevision: 0 });
    return { workId: work.workId, chapterId: chapter.chapter.chapterId };
  });
  await page.evaluate(({ workId, chapterId }) => { window.location.hash = `/work/${workId}/chapter/${chapterId}`; }, seed);
  await expect(page.locator('.ink-editor-content')).toBeVisible();
  await page.getByTitle('阅读与字体设置').click();
  await page.locator('.theme-swatches button[title="米黄"]').click();
  const sizeInput = page.locator('.reading-settings .n-input-number input');
  await sizeInput.fill('18');
  await sizeInput.press('Enter');
  await expect.poll(() => page.locator('.ink-editor-content').evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe('rgb(247, 239, 223)');
  await expect.poll(() => page.locator('.ink-editor-content').evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('18px');
  const stored = await page.evaluate(() => localStorage.getItem('inkforge.editor-prefs'));
  expect(stored).toContain('sepia');
  expect(stored).toContain('"fontSize":18');
});

test('工作台展示累计字数与作品进度，并可继续写作', async () => {
  test.setTimeout(120_000);
  await expect(page.locator('.empty-steps')).toBeVisible();
  await expect(page.locator('.empty-steps li')).toHaveCount(3);

  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '工作台统计作品' })).data;
    const volume = (await api.outline.create({ workId: work.workId, title: '第一卷', level: 1, parentId: null })).data.node;
    const first = (await api.outline.create({ workId: work.workId, title: '第一章 · 起点', level: 2, parentId: volume.nodeId })).data;
    const second = (await api.outline.create({ workId: work.workId, title: '第二章 · 回声', level: 2, parentId: volume.nodeId })).data;
    await api.chapter.save({ workId: work.workId, chapterId: first.chapter.chapterId, content: '第一段正文。', baseRevision: 0 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await api.chapter.save({ workId: work.workId, chapterId: second.chapter.chapterId, content: '第二段正文。', baseRevision: 0 });
    return { workId: work.workId, secondChapterId: second.chapter.chapterId };
  });

  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);
  await expect(page.getByRole('heading', { name: /继续你的故事/ })).toBeVisible();

  const statCards = page.locator('.stats-grid .stat-card');
  await expect(statCards.nth(0)).toContainText('累计字数');
  await expect(statCards.nth(0).locator('strong')).toHaveText('12');
  await expect(statCards.nth(1)).toContainText('创作天数');
  await expect(statCards.nth(1).locator('strong')).toHaveText('1');
  await expect(statCards.nth(2)).toContainText('共 1 部 · 归档 0');
  await expect(page.locator('.work-card').filter({ hasText: '工作台统计作品' }).locator('.work-genre'))
    .toHaveText('未分类 · 12 字 · 3 章');

  await page.locator('.stats-grid .resume-btn').click();
  await expect(page).toHaveURL(new RegExp(`/work/${seed.workId}/chapter/${seed.secondChapterId}`));
  await expect(page.locator('.ink-editor-content')).toContainText('第二段正文。');
});

test('未满自动保存时间强杀进程后仍能恢复最新草稿', async () => {
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '崩溃恢复作品' })).data;
    const outline = (await api.outline.create({ workId: work.workId, title: '第一章', level: 1, parentId: null })).data;
    return { workId: work.workId, chapterId: outline.chapter.chapterId };
  });
  await page.evaluate(({ workId, chapterId }) => {
    window.location.hash = `/work/${workId}/chapter/${chapterId}`;
  }, seed);
  const editor = page.getByLabel('章节正文');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.fill('强杀前尚未自动保存的正文。');
  const draftPath = path.join(dataDirectory, 'works', seed.workId, 'chapters', `${seed.chapterId}.md.tmp`);
  await expect.poll(() => readFile(draftPath, 'utf8').catch(() => '')).toBe('强杀前尚未自动保存的正文。');
  expect(await currentContent(seed.workId, seed.chapterId)).toBe('');

  const child = app.process();
  if (!child.pid) throw new Error('无法取得 Electron 进程 ID');
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  await promisify(execFile)('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  await exited;
  expect(await readFile(draftPath, 'utf8')).toBe('强杀前尚未自动保存的正文。');

  await launchApp();
  expect(await readFile(draftPath, 'utf8')).toBe('强杀前尚未自动保存的正文。');
  const recovery = await page.evaluate(async () => (await (window as any).inkforge.recovery.list()));
  expect(recovery).toMatchObject({
    code: 0,
    data: [{ workId: seed.workId, chapterId: seed.chapterId, content: '强杀前尚未自动保存的正文。' }],
  });
  await expect(page.getByText('发现未恢复的临时草稿')).toBeVisible();
  await page.getByRole('button', { name: '恢复草稿' }).click();
  await expect(page.getByText('临时草稿已恢复到对应章节', { exact: true })).toBeVisible();
  expect(await currentContent(seed.workId, seed.chapterId)).toBe('强杀前尚未自动保存的正文。');
  const remaining = await page.evaluate(async () => (await (window as any).inkforge.recovery.list()).data);
  expect(remaining).toEqual([]);
});

test('新建作品可填写基础信息并在作品资料中修改', async () => {
  test.setTimeout(120_000);
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByPlaceholder('例如：山河故人').fill('资料测试');
  await page.getByPlaceholder('例如：轻松幽默、快节奏、第一人称限知').fill('冷峻克制');
  await page.getByPlaceholder('例如 200000').fill('150000');
  await page.getByPlaceholder('选填').fill('番茄小说');
  await page.getByPlaceholder('例如：不要新增设定、每章结尾留钩子、避免大段说明……').fill('每章结尾留钩子');
  await page.getByRole('button', { name: '创建并进入' }).click();
  await expect(page.getByRole('heading', { name: '资料测试', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '作品资料' }).click();
  await expect(page.getByPlaceholder('例如：轻松幽默、快节奏、第一人称限知')).toHaveValue('冷峻克制');
  await page.getByPlaceholder('例如：轻松幽默、快节奏、第一人称限知').fill('快节奏');
  await page.getByRole('button', { name: '保存资料' }).click();
  await expect(page.getByText('作品资料已更新', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '作品资料' }).click();
  await expect(page.getByPlaceholder('例如：轻松幽默、快节奏、第一人称限知')).toHaveValue('快节奏');
  await expect(page.getByPlaceholder('例如 200000')).toHaveValue('150000');
});

test('设定卡可弃用、显示弃用与恢复，专注写作可隐藏助手', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '聚焦作品', style: '冷峻' })).data;
    const node = (await api.outline.create({ workId: work.workId, title: '第一章', level: 1, parentId: null })).data;
    await api.chapter.save({ workId: work.workId, chapterId: node.chapter.chapterId, content: '海风穿过灯塔。', baseRevision: 0 });
    await api.card.upsert({ workId: work.workId, type: 'character', title: '沈砚', content: '守夜人', tags: [], pinned: false });
    return { workId: work.workId, chapterId: node.chapter.chapterId };
  });

  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}`; }, seed);
  await expect(page.getByRole('heading', { name: '聚焦作品', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /设定卡/ }).click();
  const card = page.locator('.setting-card').filter({ hasText: '沈砚' });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: '弃用', exact: true }).click();
  await expect(page.locator('.setting-card').filter({ hasText: '沈砚' })).toBeHidden();
  await page.locator('.deprecated-toggle').click();
  await expect(page.locator('.setting-card').filter({ hasText: '沈砚' })).toContainText('已弃用');
  await page.locator('.setting-card').filter({ hasText: '沈砚' }).getByRole('button', { name: '恢复启用' }).click();
  await expect(page.locator('.setting-card').filter({ hasText: '沈砚' })).not.toContainText('已弃用');

  await page.evaluate(({ workId, chapterId }) => { window.location.hash = `/work/${workId}/chapter/${chapterId}`; }, seed);
  await expect(page.locator('.assistant-panel')).toBeVisible();
  await page.getByRole('button', { name: '专注写作' }).click();
  await expect(page.locator('.assistant-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: '退出专注' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.assistant-panel')).toBeVisible();
});

test('提示词选择器支持搜索筛选、参数提示与记忆上次选择', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '提示词作品' })).data;
    const node = (await api.outline.create({ workId: work.workId, title: '第一章', level: 1, parentId: null })).data;
    await api.chapter.save({ workId: work.workId, chapterId: node.chapter.chapterId, content: '雨落在长街上。', baseRevision: 0 });
    await api.prompt.upsert({ name: '冷峻快节奏续写', scene: 'continue', content: '请用{{文风偏好}}的笔法续写《{{workTitle}}》，承接：{{content}}' });
    return { workId: work.workId, chapterId: node.chapter.chapterId };
  });

  await page.evaluate(({ workId, chapterId }) => { window.location.hash = `/work/${workId}/chapter/${chapterId}`; }, seed);
  await expect(page.locator('.prompt-pick')).toContainText('使用系统默认模板');
  await page.locator('.prompt-pick').click();
  await expect(page.locator('.prompt-picker')).toBeVisible();
  await expect(page.locator('.picker-card').first()).toContainText('待填');
  await expect(page.locator('.picker-card').first()).toContainText('系统默认');

  const search = page.getByPlaceholder('搜索标题或内容，例如：续写、快节奏、强冲突');
  await search.fill('不存在的模板');
  await expect(page.locator('.picker-empty')).toBeVisible();
  await search.fill('冷峻');
  const card = page.locator('.picker-card').filter({ hasText: '冷峻快节奏续写' });
  await expect(card).toContainText('待填 1');
  await card.click();
  await page.getByRole('button', { name: '确认选择' }).click();
  await expect(page.locator('.prompt-pick')).toContainText('冷峻快节奏续写');
  await expect(page.locator('.prompt-vars')).toContainText('文风偏好');
  await page.locator('.prompt-vars input').fill('冷峻克制');
  await expect(page.locator('.prompt-vars input')).toHaveValue('冷峻克制');

  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);
  await expect(page.locator('.prompt-pick')).toContainText('冷峻快节奏续写');
  await page.locator('.prompt-pick').click();
  await page.getByPlaceholder('搜索标题或内容，例如：续写、快节奏、强冲突').fill('冷峻');
  await expect(page.locator('.picker-card').filter({ hasText: '冷峻快节奏续写' })).toContainText('使用 1 次');
});

test('提示词库展示描述标签并可一键打开最近章节', async () => {
  test.setTimeout(120_000);
  await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '提示词库作品' })).data;
    const node = (await api.outline.create({ workId: work.workId, title: '第一章', level: 1, parentId: null })).data;
    await api.chapter.save({ workId: work.workId, chapterId: node.chapter.chapterId, content: '风从山谷吹来。', baseRevision: 0 });
    await api.prompt.upsert({
      name: '山风续写', scene: 'continue', content: '按{{文风偏好}}续写《{{workTitle}}》',
      description: '适用山谷场景续写', tags: ['山野', '冷峻'],
    });
  });

  await page.evaluate(() => { window.location.hash = '/prompts'; });
  const card = page.locator('.prompt-card').filter({ hasText: '山风续写' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('适用山谷场景续写');
  await expect(card).toContainText('待填 1');
  await expect(card).toContainText('山野');
  await expect(card).toContainText('冷峻');

  await card.getByRole('button', { name: '使用模板' }).click();
  await expect(page.getByText('选择作品后会打开最近编辑的章节')).toBeVisible();
  await page.getByRole('button', { name: '打开章节' }).click();
  await expect(page.locator('.prompt-pick')).toContainText('山风续写');
  await expect(page.locator('.prompt-vars')).toContainText('文风偏好');

  await page.locator('.prompt-pick').click();
  await page.locator('.picker-toolbar input').fill('山野');
  await expect(page.locator('.picker-card').filter({ hasText: '山风续写' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('从本章提取角色、场景与道具并写入设定库', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async ({ baseURL }) => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({
      title: '提取资产作品', visualRatio: '9:16', visualStyle: '国风厚涂', visualNotes: '冷色调、雨夜',
    })).data;
    await api.provider.upsert({
      name: '本地模拟模型', baseURL, apiKey: 'local-test-key', modelChat: 'mock-chat',
      isDefault: true, temperature: 0.7, maxTokens: 1024,
    });
    const node = (await api.outline.create({ workId: work.workId, title: '第一章 · 灯塔', level: 1, parentId: null })).data;
    await api.chapter.save({
      workId: work.workId, chapterId: node.chapter.chapterId,
      content: '雨夜，沈砚在废弃灯塔捡到姐姐留下的铜钥匙。', baseRevision: 0,
    });
    return { workId: work.workId, chapterId: node.chapter.chapterId };
  }, { baseURL });

  await page.evaluate(({ workId, chapterId }) => {
    window.location.hash = `/work/${workId}/chapter/${chapterId}`;
  }, seed);
  await page.getByRole('button', { name: /从本章提取角色/ }).click();
  await expect(page.locator('.autofill-modal')).toContainText('只从');
  await page.getByRole('button', { name: '生成设定资料' }).click();
  await expect(page.locator('.draft-card')).toHaveCount(3);
  const draftTitles = page.locator('.draft-card .draft-title input');
  await expect(draftTitles).toHaveCount(3);
  await expect(draftTitles.nth(0)).toHaveValue('沈砚');
  await expect(draftTitles.nth(1)).toHaveValue('灯塔');
  await expect(draftTitles.nth(2)).toHaveValue('铜钥匙');
  await page.getByRole('button', { name: '保存选中设定' }).click();
  await expect(page.getByText('已保存 3 张设定卡', { exact: true })).toBeVisible();

  const saved = await page.evaluate(async (workId) => ({
    cards: (await (window as any).inkforge.card.list(workId)).data.map((card: any) => card.title),
    works: (await (window as any).inkforge.work.list()).data,
  }), seed.workId);
  expect(saved.cards).toEqual(expect.arrayContaining(['沈砚', '灯塔', '铜钥匙']));
  const work = saved.works.find((item: any) => item.workId === seed.workId);
  expect(work.visualRatio).toBe('9:16');
  expect(work.visualStyle).toBe('国风厚涂');
});

test('导出改编资料包包含视觉设定、资产与章节清单', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({
      title: '改编资料作品', genre: '悬疑', description: '守夜人的追查',
      visualRatio: '16:9', visualStyle: '国风厚涂', visualNotes: '冷色调',
    })).data;
    await api.card.upsert({ workId: work.workId, type: 'character', title: '沈砚', content: '身份：守夜人', tags: ['主角'], pinned: false });
    await api.card.upsert({ workId: work.workId, type: 'item', title: '铜钥匙', content: '刻着潮汐刻度。', tags: [], pinned: false });
    const volume = (await api.outline.create({ workId: work.workId, title: '第一卷 · 潮起', level: 1, parentId: null })).data.node;
    const node = (await api.outline.create({ workId: work.workId, title: '第一章 · 灯塔', level: 2, parentId: volume.nodeId })).data;
    await api.chapter.save({ workId: work.workId, chapterId: node.chapter.chapterId, content: '灯塔熄灭。', baseRevision: 0 });
    await api.outline.saveMaster(work.workId, '守夜人追查灯塔失踪案。');
    return { workId: work.workId };
  });

  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}/finish`; }, seed);
  await expect(page.getByRole('heading', { name: '改编资料作品 · 完结检查' })).toBeVisible();
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导出整书' })).toBeEnabled();
  const exportPath = path.join(dataDirectory, 'adaptation-pack.md');
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.getByRole('button', { name: '导出整书' }).click();
  await page.locator('.format-options .n-radio-button').filter({ hasText: '资料包' }).click();
  await expect(page.getByText('已选 1 章')).toBeVisible();
  await page.locator('.adaptation-include').click();
  const compliance = page.locator('.compliance-alert .n-checkbox');
  if (await compliance.count()) {
    await compliance.first().click();
    await compliance.nth(1).click();
  }
  await page.getByRole('button', { name: '选择位置并导出' }).click();
  await expect(page.getByText('导出完成', { exact: true })).toBeVisible();

  const pack = await readFile(exportPath, 'utf8');
  expect(pack).toContain('# 《改编资料作品》改编资料包');
  expect(pack).toContain('- 画幅比例：16:9');
  expect(pack).toContain('- 画风预设：国风厚涂');
  expect(pack).toContain('**沈砚**');
  expect(pack).toContain('**铜钥匙**');
  expect(pack).toContain('第一章 · 灯塔');
  expect(pack).toContain('守夜人追查灯塔失踪案。');
  expect(pack).toContain('## 二、短剧改编提示词');
  expect(pack).toContain('灯塔熄灭。');
  expect(pack).toContain('## 六、所选章节正文');
});

test('生成历史记录 AI 内容与 token，支持搜索筛选、复制、删除与清空', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async ({ baseURL }) => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '历史记录作品', genre: '悬疑' })).data;
    const outline = (await api.outline.create({ workId: work.workId, title: '第一章 · 灯塔', level: 1, parentId: null })).data;
    await api.provider.upsert({
      name: '本地模拟模型', baseURL, apiKey: 'local-test-key', modelChat: 'mock-chat',
      isDefault: true, temperature: 0.7, maxTokens: 1024,
    });
    return { workId: work.workId, chapterId: outline.chapter.chapterId };
  }, { baseURL });

  const openEditor = async (): Promise<void> => {
    await page.evaluate(({ workId, chapterId }) => { window.location.hash = `/work/${workId}/chapter/${chapterId}`; }, seed);
    await expect(page.getByLabel('章节正文')).toBeVisible();
  };
  const generateAndAdopt = async (): Promise<void> => {
    await page.getByRole('button', { name: '生成候选内容' }).click();
    await expect(page.locator('.candidate-text')).toHaveText('续写的一小段。');
    await page.getByRole('button', { name: '采纳并保存' }).click();
    await expect(page.locator('.candidate-section')).toHaveCount(0);
    await expect.poll(async () => page.evaluate(async () => (await (window as any).inkforge.history.list()).data.length))
      .toBeGreaterThan(0);
  };

  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);
  await openEditor();
  await page.getByLabel('章节正文').fill('沈砚十八岁。');
  await expect.poll(() => currentContent(seed.workId, seed.chapterId)).toBe('沈砚十八岁。');
  await generateAndAdopt();

  const record = await page.evaluate(async () => (await (window as any).inkforge.history.list()).data[0]);
  expect(record).toMatchObject({
    kind: 'continue', workTitle: '历史记录作品', chapterTitle: '第一章 · 灯塔',
    promptName: '续写正文', model: 'mock-chat', promptTokens: 20, completionTokens: 8,
  });
  expect(record.content).toBe('续写的一小段。');

  await page.getByRole('link', { name: '生成历史' }).click();
  await expect(page.getByRole('heading', { name: '生成历史' })).toBeVisible();
  await expect(page.locator('.history-card')).toHaveCount(1);
  const card = page.locator('.history-card').first();
  await expect(card).toContainText('历史记录作品');
  await expect(card).toContainText('第一章 · 灯塔');
  await expect(card).toContainText('提示词：续写正文');
  await expect(card).toContainText('输入 20 tokens');
  await expect(card).toContainText('输出 8 tokens');
  await expect(card).toContainText('续写的一小段。');

  const usageTiles = page.locator('.usage-tiles > div');
  await expect(usageTiles.nth(0)).toContainText('今日');
  await expect(usageTiles.nth(0).locator('strong')).toHaveText('28');
  await expect(usageTiles.nth(1).locator('strong')).toHaveText('28');
  await expect(usageTiles.nth(2).locator('strong')).toHaveText('28');
  await expect(page.locator('.model-list')).toContainText('mock-chat');
  await expect(page.locator('.usage-panel')).toContainText('不提供充值、会员或订单');

  const search = page.getByPlaceholder('搜索作品、章节、提示词或内容');
  await search.fill('不存在的关键词');
  await expect(page.getByText('没有匹配的生成记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空筛选条件' }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);

  await page.locator('.kind-filters button').filter({ hasText: '润色' }).click();
  await expect(page.getByText('没有匹配的生成记录', { exact: true })).toBeVisible();
  await page.locator('.kind-filters button').filter({ hasText: '全部' }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);

  await page.locator('.copy-button').click();
  await expect(page.getByText('已复制生成内容', { exact: true })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('续写的一小段。');

  await page.locator('.delete-button').click();
  await page.locator('.n-dialog').getByRole('button', { name: '确认删除' }).click();
  await expect(page.getByText('生成记录已删除', { exact: true })).toBeVisible();
  await expect(page.getByText('还没有生成记录', { exact: true })).toBeVisible();

  await openEditor();
  await generateAndAdopt();
  await page.getByRole('link', { name: '生成历史' }).click();
  await expect(page.locator('.history-card')).toHaveCount(1);
  await page.getByRole('button', { name: '清空历史' }).first().click();
  await page.locator('.n-dialog').getByRole('button', { name: '清空历史' }).click();
  await expect(page.getByText('生成历史已清空', { exact: true })).toBeVisible();
  await expect(page.getByText('还没有生成记录', { exact: true })).toBeVisible();
  expect(await page.evaluate(async () => (await (window as any).inkforge.history.list()).data.length)).toBe(0);
});

test('提示词可用 @设定 引用当前作品设定卡，缺失时标注待补全', async () => {
  test.setTimeout(120_000);
  const seed = await page.evaluate(async ({ baseURL }) => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '设定引用作品', genre: '悬疑' })).data;
    const node = (await api.outline.create({ workId: work.workId, title: '第一章 · 灯塔', level: 1, parentId: null })).data;
    await api.chapter.save({ workId: work.workId, chapterId: node.chapter.chapterId, content: '沈砚抬头看向灯塔。', baseRevision: 0 });
    await api.card.upsert({
      workId: work.workId, type: 'character', title: '沈砚', content: '身份：守夜人\n性格：克制', tags: ['主角'], pinned: false,
    });
    await api.prompt.upsert({ name: '引用设定续写', scene: 'continue', content: '请续写《{{workTitle}}》。\n@设定-角色-沈砚\n【正文】\n{{content}}' });
    await api.prompt.upsert({ name: '缺失设定续写', scene: 'continue', content: '请续写《{{workTitle}}》。\n@设定-角色-林晚\n【正文】\n{{content}}' });
    await api.provider.upsert({
      name: '本地模拟模型', baseURL, apiKey: 'local-test-key', modelChat: 'mock-chat',
      isDefault: true, temperature: 0.7, maxTokens: 1024,
    });
    return { workId: work.workId, chapterId: node.chapter.chapterId };
  }, { baseURL });

  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);
  await page.evaluate(({ workId, chapterId }) => { window.location.hash = `/work/${workId}/chapter/${chapterId}`; }, seed);
  await expect(page.getByLabel('章节正文')).toBeVisible();

  const pickTemplate = async (name: string): Promise<void> => {
    await page.locator('.prompt-pick').click();
    await page.getByPlaceholder('搜索标题或内容，例如：续写、快节奏、强冲突').fill(name);
    await page.locator('.picker-card').filter({ hasText: name }).click();
    await page.getByRole('button', { name: '确认选择' }).click();
    await expect(page.locator('.prompt-pick')).toContainText(name);
  };

  await pickTemplate('引用设定续写');
  await page.getByRole('button', { name: '生成候选内容' }).click();
  await expect(page.locator('.candidate-text')).toHaveText('引用命中。');

  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);
  await expect(page.getByLabel('章节正文')).toBeVisible();
  await pickTemplate('缺失设定续写');
  await page.getByRole('button', { name: '生成候选内容' }).click();
  await expect(page.locator('.candidate-text')).toHaveText('引用缺失。');

  await page.evaluate(({ workId }) => { window.location.hash = `/work/${workId}`; }, seed);
  await page.getByRole('button', { name: /设定卡/ }).click();
  await expect(page.getByText('作品设定库', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '复制引用 @设定-角色-沈砚' }).click();
  await expect(page.getByText('已复制引用 @设定-角色-沈砚', { exact: true })).toBeVisible();
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('@设定-角色-沈砚');
});

test('头像个人面板展示本机用量与数据目录，并说明不提供账号能力', async () => {
  test.setTimeout(120_000);
  await page.evaluate(async () => {
    const api = (window as any).inkforge;
    const work = (await api.work.create({ title: '个人面板作品' })).data;
    const node = (await api.outline.create({ workId: work.workId, title: '第一章 · 本机', level: 1, parentId: null })).data;
    await api.chapter.save({
      workId: work.workId, chapterId: node.chapter.chapterId, content: '第一段正文。', baseRevision: 0,
    });
  });

  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);
  await page.getByRole('button', { name: '个人面板', exact: true }).click();

  const panel = page.getByRole('dialog', { name: '个人面板详情' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('没有会员等级、灵石余额、邀请码、邀请奖励、提现、兑换码、充值或订单');
  await expect(panel.locator('.usage-grid > div').nth(0)).toContainText('作品');
  await expect(panel.locator('.usage-grid > div').nth(0).locator('strong')).toHaveText('1');
  await expect(panel.locator('.usage-grid > div').nth(1).locator('strong')).toHaveText('1');
  await expect(panel.locator('.usage-grid > div').nth(2).locator('strong')).toHaveText('6');
  await expect(panel.locator('.usage-grid > div').nth(3)).toContainText('AI 生成');
  await expect(panel.locator('.user-panel-path')).toContainText(dataDirectory);
  await expect(panel.getByRole('button', { name: '打开目录' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '退出应用' })).toBeVisible();
  await expect(panel.getByRole('link', { name: '偏好设置' })).toBeVisible();
});

test('剧本工作台从元素创意到分集正文并导出全部', async () => {
  test.setTimeout(120_000);
  await page.evaluate(async ({ baseURL }) => {
    await (window as any).inkforge.provider.upsert({
      name: '本地模拟模型', baseURL, apiKey: 'local-test-key', modelChat: 'mock-chat',
      isDefault: true, temperature: 0.7, maxTokens: 1024,
    });
  }, { baseURL });

  await page.evaluate(() => { window.location.hash = '/scripts'; });
  await expect(page.getByRole('heading', { name: '剧本创作工作台' })).toBeVisible();
  await page.getByRole('button', { name: '新建剧本项目' }).first().click();

  const modal = page.locator('.script-create-modal');
  await expect(modal).toBeVisible();
  await modal.locator('.script-title input').fill('离婚当天，我成了债主');
  await modal.locator('.element-chip').filter({ hasText: '逆袭' }).click();
  await modal.locator('.element-chip').filter({ hasText: '爽感' }).click();
  await modal.locator('.create-episode-count input').fill('2');
  await modal.locator('.create-episode-count input').press('Tab');
  await modal.getByRole('button', { name: '创建并开始' }).click();
  await expect(page.getByRole('heading', { name: '离婚当天，我成了债主' })).toBeVisible();
  await expect(page.locator('.step-card')).toHaveCount(3);

  await page.getByRole('button', { name: '生成短剧创意' }).click();
  await expect(page.locator('.idea-card')).toHaveCount(2);
  await page.locator('.idea-card').first().click();
  await expect(page.locator('.idea-card').first()).toContainText('已选创意');

  await page.getByRole('button', { name: '生成总大纲' }).click();
  await expect(page.locator('.episode-row')).toHaveCount(2);
  await expect(page.locator('.episode-row').first()).toContainText('第1集 · 离婚当天');
  await expect(page.locator('.episode-row').nth(1)).toContainText('第2集 · 债主上门');

  await page.getByRole('button', { name: '生成全部' }).click();
  await expect(page.locator('.episode-progress')).toContainText('已完成 2 / 2 集', { timeout: 30_000 });
  await page.locator('.episode-item').first().click();
  await expect(page.locator('.episode-text textarea')).toHaveValue(/苏晚把离婚证拍在桌上/);

  const exportPath = path.join(dataDirectory, 'script-export.md');
  await app.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.locator('.export-all').click();
  await expect(page.getByText(/已导出：/).first()).toBeVisible({ timeout: 15_000 });
  const script = await readFile(exportPath, 'utf8');
  expect(script).toContain('# 《离婚当天，我成了债主》分集剧本');
  expect(script).toContain('## 二、选定创意');
  expect(script).toContain('第1集 · 离婚当天');
  expect(script).toContain('第2集 · 债主上门');
  expect(script).toContain('苏晚把离婚证拍在桌上。');
});

test('作品分组、本地封面与分组删除后回到全部', async () => {
  test.setTimeout(120_000);
  await page.evaluate(async () => {
    await (window as any).inkforge.work.create({ title: '分组测试作品', genre: '短篇小说' });
  });
  await page.reload();
  await page.waitForFunction(() => 'inkforge' in window);

  const card = page.locator('.work-card').filter({ hasText: '分组测试作品' });
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: '添加分组' }).click();
  await page.locator('.group-modal input').fill('短篇');
  await page.locator('.group-submit').click();
  await expect(page.locator('.group-tab').filter({ hasText: '短篇' })).toHaveClass(/active/);
  await expect(card).toHaveCount(0);

  await page.locator('.group-tab').filter({ hasText: '全部' }).click();
  await card.locator('[aria-label="移入分组"]').click();
  await page.locator('.move-group-select').click();
  await page.locator('.n-base-select-option').filter({ hasText: '短篇' }).last().click();
  await page.locator('.move-submit').click();
  await expect(page.locator('.group-tab').filter({ hasText: '短篇' })).toContainText('1');
  await page.locator('.group-tab').filter({ hasText: '短篇' }).click();
  await expect(card).toBeVisible();
  await expect(card).toContainText('短篇');

  await card.locator('[aria-label="生成或更换封面"]').click();
  await expect(page.getByText('已生成本地占位封面', { exact: true })).toBeVisible();
  await expect(card.locator('.work-cover')).toBeVisible();
  const theme = await card.locator('.work-cover').getAttribute('data-theme');
  expect(theme).toBeTruthy();

  await page.locator('.group-tab').filter({ hasText: '短篇' }).locator('.group-remove').click();
  await page.getByRole('button', { name: '删除分组', exact: true }).click();
  await expect(page.locator('.group-tab').filter({ hasText: '短篇' })).toHaveCount(0);
  await expect(page.getByText('分组已删除，作品已回到全部', { exact: true })).toBeVisible();
  await page.locator('.group-tab').filter({ hasText: '全部' }).click();
  await expect(card).toBeVisible();
  await expect(card.locator('.work-genre')).not.toContainText('· 短篇');
  await expect(card.locator('.work-cover')).toBeVisible();
});

test('剧本列表支持导入 TXT 与搜索', async () => {
  test.setTimeout(120_000);
  const filePath = path.join(dataDirectory, '导入剧本.txt');
  await writeFile(filePath, '第一幕 开场\n苏晚走进民政局。\n\n第二幕 反转\n前夫追了进来。', 'utf8');
  await app.evaluate(async ({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, filePath);

  await page.evaluate(() => { window.location.hash = '/scripts'; });
  await expect(page.getByRole('heading', { name: '剧本创作工作台' })).toBeVisible();
  await page.getByRole('button', { name: '导入剧本' }).click();
  await expect(page.getByRole('heading', { name: '导入剧本' })).toBeVisible();
  await expect(page.locator('.episode-row')).toHaveCount(2);
  await expect(page.locator('.episode-row').first()).toContainText('第一幕');

  await page.getByRole('button', { name: '返回我的剧本' }).click();
  const search = page.locator('.script-search input');
  await search.fill('不存在的剧本');
  await expect(page.getByText('没有找到相关剧本', { exact: true })).toBeVisible();
  await search.fill('导入');
  await expect(page.locator('.project-card').filter({ hasText: '导入剧本' })).toBeVisible();
});


