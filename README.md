# 墨轩 MoXuan

墨轩是一款 Windows 本地 AI 写作工作台，面向网文与短剧创作，帮助作者把「作品 → 设定 → 大纲 → 正文 → 润色 → 一致性检查 → 导出」串成一条完整链路。所有作品与配置都保存在本机，不依赖账号或云端。

## 主要功能

- **作品与大纲**：作品分组、本地渐变封面、创作向导、故事总纲、分卷 / 季 / 章节三级大纲。
- **设定库**：角色、世界观、情节、道具、术语设定卡，支持从当前章节自动提取，提示词可用 `@设定-角色-沈砚` 引用。
- **AI 写作**：续写、黄金三章、批量正文、润色、降低 AI 痕迹；续写会携带「上一章结尾原文」作为衔接锚点，减少跳场景。
- **一致性与完结**：设定一致性检查、章节锁定、整书查找替换、整书排版、完结页进度。
- **导出**：TXT / Markdown、离线阅读页（单文件 HTML）、短剧改编资料包；导出全部为本地免费能力。
- **剧本工作台**：短剧创意 → 分集大纲 → 分集正文 → 导出，支持导入 TXT / Markdown / DOCX。
- **本地用量**：生成历史、Token 用量趋势与失败排查提示，数据仅来自本机记录。

## 技术栈

Electron 35 + Vue 3 + TypeScript + Pinia + Naive UI + TipTap，构建工具为 Vite 与 electron-builder；测试使用 Vitest 与 Playwright（Electron E2E）。

## 开发

```powershell
npm install
npm run dev        # 启动开发环境
npm run typecheck  # 类型检查
npm run lint       # ESLint
npm run test       # Vitest 单元 / 服务 / IPC 测试
npm run test:e2e   # 构建后运行 Electron E2E
npm run dist       # 生成 Windows x64 安装包
```

## 数据位置

- 默认数据目录：`%USERPROFILE%\Documents\墨轩`，可用环境变量 `INKFORGE_DATA_DIR` 覆盖。
- 首次启动会把旧的 `墨枢 InkForge` 目录迁移到 `墨轩`。
- 章节正文以 UTF-8 Markdown 保存，作品、设定、大纲与配置为本地 JSON；API Key 使用系统安全存储加密。
- 卸载程序不会删除作品数据。

## 边界说明

- 纯本地应用：没有账号、会员、充值、订单或云端同步，界面中也不会伪造这些能力。
- AI 生成质量取决于你自行配置的模型服务（Base URL、API Key、模型名），应用不内置模型额度。
- 安装包未做商业代码签名，Windows 可能提示未知发布者，请核对来源与 SHA-256。

## 安装包

最新 Windows x64 安装包见仓库 Releases（`MoXuan-Setup-*.exe`），同页提供 SHA-256 校验值。
