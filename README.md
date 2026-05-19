# MindOS - Your Second Brain, OS-Level

<div align="center">

![Version](https://img.shields.io/badge/version-0.6.5-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.5+-lightgray)

**AI 知识管理 + 智能复习系统**

*从信息采集到知识沉淀，从被动学习到主动巩固*

[功能介绍](#核心功能) · [快速开始](#快速开始) · [详细文档](PROJECT_DOC.md) · [更新日志](#更新日志)
# MindOS (Obsidian Plugin) — Your Second Brain, OS-Level

MindOS 是一个 **Obsidian 本地优先**的个人知识管理系统（PKM），将「采集 → 整理 → 检索问答 → 间隔复习」打通成闭环，并坚持：

- **File First，Database Last**：所有数据均存储为 Markdown / JSON，插件挂了数据也可用
- **AI 是助手，不是主宰**：支持审核模式，重要变更由人确认
- **系统自我可读**：schema/ 规则层自解释，未来可迁移可演化

> 当前版本：**v0.6.5（稳定可用）**  
> 开发中：**v0.7（Express 输出引擎）**

---

## 项目概况

| 属性 | 内容 |
|------|------|
| **项目定位** | Obsidian 个人知识管理 + AI 智能复习系统 |
| **当前版本** | v0.6.5 |
| **代码总量** | ~12,000 行 TypeScript + ~5,500 行 CSS |
| **核心文件数** | ~45 个 |
| **复习场景** | 7 个（含自定义） |
| **核心功能点** | 100+ |
| **架构模式** | 模块化 + Store 状态管理 + View 渲染分离 |

---

## 核心功能

### 📥 智能采集 (v0.1+)

- 支持主流 AI 平台：豆包、ChatGPT、Kimi、通义千问、文心一言、Claude
- 从剪贴板或浏览器协议一键采集对话
- 自动识别对话回合，智能聚类分组
- 四阶段 AI 流水线：聚类 → 草稿 → 比对 → 执行
- 支持审核模式，确认后执行操作

### 🧠 自动整理 (v0.1+)

- 调用大模型 API 进行二次处理
- 5 大类自动分类：技术类、职场类、学习类、实操类、理论类
- 智能合并：自动判断是新建页面还是追加到现有页面
- 来源链接智能合并 + 命名美化
- frontmatter 富化（cover/category/summary/wordcount/references）

### 📚 Wiki 三层架构 (v0.1+)

基于 Karpathy LLM Wiki 理念：

- **raw/** - 原始数据层（只读）
- **wiki/** - AI 维护的知识层
- **schema/** - 人类定义的规则

### 🔍 语义检索 (v0.5+)

- 基于向量的全文语义搜索
- 多供应商支持：OpenAI / 智谱 / 阿里云通义
- Page 模式和 Chunk 模式双支持
- 全量索引 + 增量同步 + 自动向量化
- Token 配额管理（每日上限 + 成本预估）

### 💬 RAG 问答 (v0.5+)

- 基于知识库的对话式问答
- 流式输出，实时响应
- 自动引用来源，标注参考页面
- 多轮对话 + 中止机制
- 会话管理，支持导出为笔记

### 🧩 智能复习 (v0.6+)

**双算法支持**：
- **SM-2**：经典间隔重复
- **FSRS-4.5**：现代记忆模型，更精准

**7 大复习场景**：

| 场景 | 数据来源 | 特色 |
|------|----------|------|
| **📖 Wiki 复习** | 用户知识库 | AI 自动提取知识点 |
| **💻 命令行** | 50+ 内置库 | Linux/Git/Docker 命令速记 |
| **🔤 英语单词** | 6 大词库 | CET-4/6/考研/IELTS/TOEFL/GRE |
| **💡 概念定义** | Wiki 页面 | AI 一键生成概念卡 |
| **🌐 多语言短语** | 11 种语言 | 日/韩/西/法/德等 |
| **💼 面试助手** | JD 解析 | 知识盘点 + 模拟面试 |
| **🎲 自定义场景** | 用户模板 | 4 个预设模板 |

### 📊 学习数据看板

- 6 大核心指标：复习数 / 正确率 / 用时 / 新卡片 / 连续天数 / 待复习
- 学习热力图（GitHub 风格，最近 90 天）
- 趋势柱状图（最近 30 天）
- 场景对比 + 卡片库总览
- 周期切换：今日 / 本周 / 本月 / 全部

---

## 设计哲学

```
1. 文件 First，数据库 Last
   所有数据都是 Markdown 或 JSON 文件
   即使插件死了，数据也能用任何编辑器打开

2. AI 是助手，不是主宰
   AI 的任何输出都可被人类否决
   重要决策始终由人确认（审核模式）

3. 系统要自我可读
   schema/ 文件自解释
   未来想换工具时，整套知识能完整迁移
```

---

## 快速开始

### 1. 安装

```bash
# 开发模式
npm install
npm run dev

# 构建生产版本
npm run build
```

将构建产物复制到 Obsidian 插件目录：

```bash
cp main.js manifest.json styles.css ~/.obsidian/plugins/mindos/
```

### 2. 配置

1. 在 Obsidian 设置中启用 MindOS 插件
2. 打开插件设置，配置：
   - API Key（支持 OpenAI / Claude / Kimi 等）
   - 知识库根目录（默认：`Knowledge Base`）
   - Embedding 配置（用于语义检索）

### 3. 使用

| 操作 | 命令 |
|------|------|
| 采集对话 | `mindos-collect` |
| 打开任务中心 | `mindos-open-center` |
| 语义检索 | `mindos-open-search` |
| RAG 问答 | `mindos-open-chat` |
| 打开复习 | `mindos-open-recall` |
| 学习数据看板 | `mindos-recall-dashboard` |
| 卡片管理 | `mindos-recall-card-manager` |
| 面试助手 | `mindos-recall-interview` |
| 重建索引 | `mindos-rebuild-index` |

---

## 更新日志

### v0.7 (进行中) → 输出与表达

#### 已完成
- **4A: Express 输出引擎** - 文章/PPT/简历生成
- **4B: TTS 听力模式** - Web Speech API 单词朗读

#### 待开发
- **4C: 数据迁移** - Anki 互通 / 导入导出

### v0.6.5 (基线版本)

- 死循环修复
- AI 增强知识盘点
- 折叠 UI 优化
- 面试助手返回按钮

### v0.6

- 智能复习系统（SRS 间隔重复：SM-2 + FSRS-4.5）
- 7 大复习场景全覆盖
- 面试助手（JD 解析 + 知识盘点 + 模拟面试）
- 单词记忆（CET-4/6/考研/IELTS/TOEFL/GRE）
- 多语言短语（11 种语言）
- 自定义场景（4 个预设模板）
- Dashboard 数据看板

### v0.5

- 语义检索（向量搜索）
- RAG 问答
- 会话管理与导出
- Token 配额管理

### v0.1 - v0.4

- 基础采集与整理
- Wiki 三层架构
- 四阶段 AI 流水线

---

## 项目统计

| 维度 | 数值 |
|------|------|
| TypeScript 代码 | ~12,000 行 |
| CSS 样式 | ~5,500 行 |
| 核心文件数 | ~45 个 |
| 复习场景数 | 7 个 |
| 预设模板 | 4 个 |
| 内置词库 | 6 个 |
| 种子词条 | 200+ |
| 内置命令 | 50+ |
| 支持语言 | 11 种 |
| 核心功能点 | 100+ |
| 状态管理 Store | 3 个 |
| AI 集成场景 | 8 个 |

### CSS 模块化结构

```
styles/
├── index.css          # 入口文件（@import 汇总）
├── core.css           # 基础组件（按钮/表单/卡片/排版）
├── task-center.css    # 任务中心（topbar/tabbar/布局）
├── retrieve.css       # 检索模块（search/chat）
├── recall.css         # 复习模块（recall 界面）
├── recall-tts.css     # TTS 模式（vocab mask / tts）
└── express.css        # Express 输出模块
```

> **构建说明**：`styles/index.css` 通过 esbuild bundle 为 `styles.css`，根目录 `styles.css` 为构建产物。

---

## 技术栈

| 技术 | 用途 |
|------|------|
| TypeScript | 开发语言 |
| Obsidian API | 插件框架 |
| esbuild | 构建工具 |
| SM-2 / FSRS-4.5 | 间隔重复算法 |

---

详细技术架构请参阅 [PROJECT_DOC.md](PROJECT_DOC.md)。

---

## 许可证

MIT License
## ✨ 核心能力一览

### ✅ 1) 采集与 Wiki 三层知识架构（raw/wiki/schema）
- 浏览器扩展/协议唤起采集 AI 对话（obsidian://mindos）
- 结构化存档到 `raw/conversations`
- 四阶段 AI 流水线：聚类 → 草稿 → 比对 → 执行
- 写入 `wiki/`（entities / concepts / topics / comparisons / overviews）
- 自动维护 `wiki/INDEX.md`
- 支持审核模式（Review Mode）
- 支持旧结构迁移（Migrator）

### ✅ 2) 检索 + 向量化 + RAG 问答（Retrieve）
- 多 Provider embedding（OpenAI / 阿里云 / 智谱 / 自定义等）
- 智能切片、余弦相似度搜索
- Page / Chunk 聚合
- 增量同步 + 自动向量化（文件变更触发）
- Token 配额与成本预估
- RAG 多轮对话（支持流式输出 + 引用）

### ✅ 3) Recall 智能复习系统（SRS）
- 双算法：SM-2 / FSRS
- 7 大复习场景（Wiki / 命令行 / 单词 / 概念 / 多语言 / 面试 / 自定义）
- 卡片管理面板：搜索、过滤、批量操作、编辑器
- 学习数据看板：热力图、趋势、场景对比、卡片库概览
- 面试助手闭环：JD 解析 → 知识盘点 → 模拟面试 → 生成复习卡

### 🧪 4) Express 输出引擎（v0.7 开发中）
- 基于 Wiki 生成文章草稿（大纲优先 → 正文生成 → Markdown 导出）
- 多风格模板：技术博客 / 知乎答题 / 公众号 / 摘要 / 教程等
- 段落级 AI 重写
- 导出到 Wiki 形成“知识变现输出”

---

## 🧱 目录结构（本地优先）

> 所有数据默认位于 `baseFolder`（默认：`Knowledge Base/`）

```text
{baseFolder}/
├── raw/
│   └── conversations/        原始对话存档（不可改）
├── wiki/
│   ├── INDEX.md              自动索引
│   ├── entities/
│   ├── concepts/
│   ├── topics/
│   ├── comparisons/
│   └── overviews/
├── schema/
│   ├── CLAUDE.md             AI 工作说明书（规则层）
│   ├── conventions.md
│   └── page-templates/
└── _system/
    ├── vectors.json          向量索引
    ├── quota.json            Token 配额
    ├── chat-sessions/        RAG 对话历史
    └── recall/               Recall 数据
        ├── cards/
        ├── sessions/
        ├── stats/
        ├── wordlists/
        ├── interview/
        └── custom-scenarios.json
