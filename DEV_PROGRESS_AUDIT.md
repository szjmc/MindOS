# MindOS 开发进度排查报告

> 排查日期：2026-09-09 · 分支：`arena/01a0868c-mindos`（基于 `main` @ `bf766cc`）
> 方式：本地代码审计 + 编译/构建/测试验证 + GitHub 仓库动态核对

---

## 1. 一句话结论

**代码实际进度已远超文档描述**（v0.8/v0.9 的功能都已落地，v1.0 号已启用），
但仓库刚被压缩成单个 `v1.0` 提交、文档严重滞后、存在 106 个类型错误、
约 1.2 万行重构遗留死代码，且**没有任何可运行的测试**。属于"功能跑得快、工程化欠账多"的状态。

---

## 2. 版本与仓库状态

| 项目 | 现状 | 问题 |
|------|------|------|
| Git 历史 | 仅 1 个提交 `bf766cc "v1.0"`（2026-09-09 今天推送） | 历史被 squash 重写，v0.1→v0.6.5 的演进记录全部丢失 |
| 早期痕迹 | GitHub 上残留 2 个已合并 PR（#1 生成项目文档、#2，2026-05） | 是唯一的早期开发记录 |
| GitHub Releases | **无** | `versions.json` 声明 1.0.0，但未发布 release/安装包 |
| 版本号 | `package.json`/`manifest.json` = **1.0.0** | README 徽章写 1.0.0，正文却写 **v0.6.5**；PROJECT_DOC 通篇 v0.6.5；`versions.json` 还留着 0.4.5 → 三处互相矛盾 |

## 3. 代码规模：文档数据已过时约 3 倍

| 指标 | 文档声称 | 实测 |
|------|---------|------|
| TypeScript | ~12,000 行 / ~45 文件 | **47,226 行 / 129 文件** |
| CSS | ~5,500 行 | **14,398 行**（17 个模块 css + 1 个 `.bak`） |
| 其中死代码 | — | **26 个重复旧文件、12,145 行**（见 §5） |

## 4. 功能进度：实际代码 vs 文档路线图

### ✅ 已实现且已注册到插件（main.ts 中可见命令/视图）

| 路线图阶段 | 功能 | 代码证据 |
|-----------|------|---------|
| v0.1–v0.6 全部 | 采集、四阶段流水线、Wiki 三层、语义检索、RAG、SRS 复习、面试、词库 | 与文档一致 |
| v0.7-4A | Express 文章生成（多风格模板，含周报风格） | `src/modules/express/` |
| v0.7-4B | TTS 听力模式 | `core/tts-service.ts` |
| v0.7「下一步」 | **智能卡片关联**（文档写"下一步"，实际已完成） | `recall/card-relations/` 4 个文件 + 2 条命令 |
| **v0.8** Connect | 反向链接增强、矛盾检测、自动链接挖掘、智能萃取 | `connect/backlink/` 6 个文件，视图已注册 |
| **v0.9** Evolve | 版本历史+时间线、健康度报告、知识空白雷达、演化面板 | `wiki/version-*`、`health-report`、`knowledge-gaps`，命令已注册 |
| 其他 | 情境感知（context-awareness） | `retrieve/context-awareness*` 3 个文件 + 命令 |

### ❌ 文档声称 ✅ 但代码中不存在（文档虚标）

- **PPT 大纲生成（Marp/Slidev/PPTX 导出）** —— express 模块中无相关代码
- **简历生成器（STAR 格式）** —— 无相关代码

### 🔄 确实未实现（与文档一致）

- v0.7-4C 数据迁移：Anki 导出/导入、完整备份、云同步指南（全仓库无 anki/apkg/backup 实现）
- v0.8 知识图谱可视化（D3）——未见图谱视图
- v0.8 自动标签建议、v0.9 知识衰减/成熟度标记、v1.0 Agent 全部未见

## 5. 工程健康问题（按严重度排序）

| # | 问题 | 证据 / 影响 |
|---|------|------------|
| 1 | **测试为零，且测试脚本直接报错** | `jest.config.js` 指向 `tests/` 目录，该目录不存在 → `npm test` 报 Validation Error。package.json 声明了 jest/ts-jest/@types/jest 却一个测试都没写 |
| 2 | **106 个 TypeScript strict 错误** | `tsc --noEmit` 实测。重灾区：`context-awareness-renderer.ts`(18)、`knowledge-gaps-renderer.ts`(12)、`view-recall.ts`(10)、`capture-service.ts`(10)、`service-container.ts`(5) 等。esbuild 不做类型检查，所以 `npm run build` 仍能产出 1.1MB 的 `main.js` —— **构建"绿"是假象** |
| 3 | **约 1.2 万行重构死代码** | recall 模块重构成子目录（`core/`、`generators/`、`interview/`…）后，26 个旧扁平文件未删除；`index.ts` 只引用新路径。其中 `tts-service.ts` 新旧两份完全相同，其余多份已产生内容分叉，极易误导后续开发 |
| 4 | **ESLint 形同虚设** | 存在 `eslint.config.mts`，但 eslint 不在依赖里，也没有 `lint` 脚本 |
| 5 | 产物入库 | 根目录 `styles.css`（338KB）是 esbuild 从 `styles/index.css` 生成的产物却被提交；`styles/styles.css.bak` 备份文件残留 |
| 6 | 历史与发布缺失 | 单提交仓库、无 tag、无 Release，插件无法通过常规渠道安装 |

## 6. 建议的下一步（按优先级）

1. **清理死代码**：删除 `src/modules/recall/` 下 26 个未被引用的旧文件（-12,145 行）及 `styles/styles.css.bak`
2. **修类型错误**：106 个错误集中在 5~6 个渲染器/视图文件，多为 `Element → HTMLElement`、属性未初始化（`!`）类小修，可批量清掉，让 `tsc --noEmit` 变绿并可挂进 CI
3. **补最小测试**：先给 `srs-engine`（纯算法、易测）写首批单测，恢复 `npm test` 可用性
4. **对齐文档与版本**：统一为 1.0.0（或说明 1.0 仅是打包号），更新路线图状态；删除/标注未实现的 PPT、简历功能
5. **打通发布**：打 git tag `1.0.0` + GitHub Release（附 `main.js`/`manifest.json`/`styles.css`）
6. **继续功能线**：按文档优先级，4C 数据迁移（Anki 互通）是下一个最有价值的功能缺口

---

### 附：本次排查执行的验证命令

```bash
git log / gh api commits / gh pr list        # 仓库与协作动态
node node_modules/typescript/bin/tsc --noEmit # → 106 errors
node esbuild.config.mjs --prod                # → main.js 1.1MB 构建成功
node node_modules/jest/bin/jest.js            # → Validation Error（tests/ 不存在）
grep/diff 重复文件比对                          # → 26 个死文件 / 12,145 行
```
