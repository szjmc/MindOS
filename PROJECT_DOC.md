# MindOS 技术文档

---

## 1. 项目概述

### 1.1 项目简介

**MindOS** 是一款面向 Obsidian 的 AI 知识管理与智能复习插件，致力于构建"第二层大脑"级别的知识管理系统。

| 属性 | 值 |
|------|-----|
| 项目名称 | MindOS - Your Second Brain, OS-Level |
| 版本 | v1.1.0 |
| 类型 | Obsidian 插件 |
| 开发语言 | TypeScript |
| 代码总量 | ~36,900 行 TypeScript + ~14,400 行 CSS |
| 核心文件数 | ~109 个 |
| 核心理念 | 采集 → 整理 → 检索 → 复习 |

### 1.2 核心功能矩阵

| 模块 | 功能描述 | 版本 | 状态 |
|------|---------|------|------|
| **智能采集** | 从剪贴板/browser协议采集AI对话，自动分类整理 | v0.1 | ✅ |
| **知识管理** | Wiki三层架构：raw → wiki → schema | v0.1 | ✅ |
| **语义检索** | 基于向量的全文检索 | v0.5 | ✅ |
| **RAG问答** | 基于知识库的对话式问答 | v0.5 | ✅ |
| **智能复习** | SRS间隔重复算法（SM-2/FSRS） | v0.6 | ✅ |
| **面试助手** | JD解析、知识盘点、模拟面试 | v0.6 | ✅ |
| **单词记忆** | 内置主流词库，支持多模式复习 | v0.6 | ✅ |
| **多语言短语** | 日语/韩语/西班牙语等短语记忆 | v0.6 | ✅ |
| **自定义场景** | 用户自定义复习卡片模板 | v0.6 | ✅ |

### 1.3 设计哲学

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

## 2. 架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       MindOS Plugin                            │
│                         (main.ts)                              │
├─────────────────────────────────────────────────────────────────┤
│                      UI Layer                                  │
│   ┌──────────┬──────────┬──────────┬──────────┐               │
│   │  采集     │  检索     │  问答     │  复习     │               │
│   └──────────┴──────────┴──────────┴──────────┘               │
├─────────────────────────────────────────────────────────────────┤
│                      Store Layer                               │
│   ┌──────────┐ ┌──────────────┐ ┌──────────────┐              │
│   │TaskStore │ │RetrieveStore │ │RecallStore   │              │
│   └──────────┘ └──────────────┘ └──────────────┘              │
├─────────────────────────────────────────────────────────────────┤
│                      Core Modules                              │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐    │
│  │ Pipeline Engine                                       │    │
│  │  AIClient → WorkflowEngine → ActionExecutor          │    │
│  └───────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐    │
│  │ Wiki Manager                                          │    │
│  │  SchemaManager → IndexManager → Migrator             │    │
│  └───────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐    │
│  │ Retrieve Module (v0.5)                                │    │
│  │  EmbeddingClient → VectorStore → SemanticSearch       │    │
│  │  → RAGChat → QuotaManager                            │    │
│  └───────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐    │
│  │ Recall Module (v0.6)                                  │    │
│  │  SRSEngine → RecallCardStore → AICardGenerator       │    │
│  │  + 场景生成器: Wiki/Command/Vocab/Interview/Concept  │    │
│  │  + 面试助手: JDAnalyzer → GapAnalyzer → MockInterviewer│ │
│  └───────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  Karpathy LLM Wiki 三层知识架构                                │
│  ├── raw/      原始素材层（不可改）                            │
│  ├── wiki/     知识层（AI 全权维护）                          │
│  └── schema/   规则层（人类编写）                            │
├─────────────────────────────────────────────────────────────────┤
│  系统数据层 _system/                                           │
│  ├── vectors.json        向量索引                              │
│  ├── quota.json          配额                                  │
│  ├── chat-sessions/      对话历史                              │
│  └── recall/             复习模块数据                           │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
src/
├── core/                    # 核心模块
│   ├── types.ts             # 类型定义（~600 行）
│   ├── constants.ts         # 常量配置（~250 行）
│   ├── store.ts             # 状态管理（Task/Retrieve/Recall）
│   └── utils.ts             # 工具函数
├── modules/
│   ├── pipeline/            # 工作流引擎
│   │   ├── ai-client.ts     # AI API 客户端
│   │   ├── workflow-engine.ts # 智能合并流水线
│   │   ├── action-executor.ts # Action执行器
│   │   └── similarity.ts     # 相似度评分
│   ├── wiki/                # Wiki管理
│   │   ├── schema-manager.ts # 模板管理
│   │   ├── index-manager.ts  # 索引重建
│   │   └── migrator.ts       # 数据迁移
│   ├── retrieve/            # 检索模块 (v0.5)
│   │   ├── embedding-client.ts # 向量化客户端
│   │   ├── vector-store.ts    # 向量存储
│   │   ├── embedding-manager.ts # 向量化管理
│   │   ├── semantic-search.ts  # 语义搜索
│   │   ├── rag-chat.ts        # RAG对话
│   │   ├── token-estimator.ts # Token估算
│   │   ├── quota-manager.ts   # 配额管理
│   │   ├── chunker.ts         # 文本切片
│   │   ├── chat-session-store.ts # 会话存储
│   │   └── view-retrieve.ts    # 检索视图
│   ├── recall/              # 复习模块 (v0.6)
│   │   ├── srs-engine.ts      # SRS算法引擎
│   │   ├── recall-card-store.ts # 卡片存储
│   │   ├── ai-card-generator.ts # AI生成卡片
│   │   ├── view-recall.ts      # 复习界面
│   │   ├── dashboard-service.ts # 数据统计
│   │   ├── dashboard-view.ts   # 数据看板
│   │   ├── recall-card-manager-view.ts # 卡片管理
│   │   ├── recall-wiki-generator.ts   # Wiki场景
│   │   ├── recall-command-generator.ts # 命令场景
│   │   ├── recall-vocab-generator.ts   # 单词场景
│   │   ├── recall-concept-generator.ts # 概念场景
│   │   ├── recall-phrase-generator.ts  # 短语场景
│   │   ├── word-list-store.ts   # 词库存储
│   │   ├── builtin-vocab-data.ts # 内置词库数据
│   │   ├── jd-analyzer.ts       # JD解析
│   │   ├── gap-analyzer.ts      # 知识盘点
│   │   ├── interview-store.ts   # 面试数据存储
│   │   ├── interview-view.ts    # 面试界面
│   │   ├── mock-interviewer.ts  # 模拟面试官
│   │   ├── mock-interview-view.ts # 模拟面试界面
│   │   ├── custom-scenario-store.ts # 自定义场景
│   │   └── various_modals.ts    # 各类弹窗组件
│   └── express/              # 输出模块 (v0.7)
│       └── ...               # 文章/PPT/简历生成
└── ui/
    └── settings-tab.ts      # 设置页面

styles/                      # CSS 模块化 (v0.7 重构)
├── index.css                # 入口文件（@import 汇总）
├── core.css                 # 基础组件（按钮/表单/卡片/排版）
├── task-center.css          # 任务中心（topbar/tabbar/布局）
├── retrieve.css              # 检索模块（search/chat）
├── recall.css                # 复习模块（recall 界面）
├── recall-tts.css            # TTS 模式（vocab mask / tts）
└── express.css               # Express 输出模块
```

> **构建说明**：`styles/index.css` 通过 esbuild bundle 为根目录 `styles.css`（构建产物，不再手写）

---

## 3. 核心模块详解

### 3.1 Core 模块

#### 3.1.1 types.ts - 类型定义

项目的核心类型定义，包含：

| 类型分类 | 核心接口 | 用途 |
|---------|---------|------|
| **检索相关** | `ChunkMeta`, `VectorIndex`, `SearchResult`, `ChatSession` | v0.5 语义检索 |
| **任务相关** | `TaskState`, `WikiAction`, `PipelineState`, `DiffDecision` | 工作流管理 |
| **复习相关** | `RecallCard`, `SRSData`, `RecallSession`, `RecallDailyStats` | v0.6 复习系统 |
| **面试相关** | `JDAnalysis`, `SkillRequirement`, `InterviewQuestion` | 面试助手 |
| **自定义场景** | `CustomScenario`, `CustomFieldDef`, `CustomCardMetadata` | 自定义卡片 |

#### 3.1.2 store.ts - 状态管理

实现了三个响应式状态存储：

| Store | 职责 | 核心方法 |
|-------|------|---------|
| **TaskStore** | 采集任务状态 | `setStatus()`, `log()`, `addPendingActions()` |
| **RetrieveStore** | 检索/聊天状态 | `setSearchResults()`, `upsertSession()`, `setChatting()` |
| **RecallStore** | 复习状态 | `startSession()`, `flipCard()`, `advanceSession()` |

#### 3.1.3 utils.ts - 工具函数

| 函数 | 功能 |
|------|------|
| `normalizeText()` | 文本规范化（换行、空格处理） |
| `simpleHash()` | 简单哈希算法 |
| `parseFrontmatter()` | YAML 前置元数据解析 |
| `buildFrontmatter()` | 构建 YAML 前置元数据 |
| `generateUID()` | 生成唯一标识符 |

---

### 3.2 Pipeline 模块

#### 3.2.1 workflow-engine.ts - 智能合并流水线

**完整流程**：

```
浏览器扩展 → 协议唤起 → 解析回合
      ↓
    四阶段 AI 流水线
      ├── 阶段1：聚类     → 把回合按主题分组
      ├── 阶段2：草稿     → AI 生成结构化草稿
      ├── 阶段3：比对     → 与现有 Wiki 对比，决定 merge/create/discard
      └── 阶段4：执行     → 生成 actions
      ↓
   用户审核（可选）→ 写入 wiki/
      ↓
   自动向量化（积累 5 个变更触发）
```

**Pipeline 阶段说明**：

| 阶段 | 名称 | 职责 | AI 调用 |
|------|------|------|---------|
| `cluster` | 回合聚类 | 判断哪些回合讨论同一主题 | 是 |
| `draft` | 整理草稿 | 将同主题回合整理成结构化草稿 | 是 |
| `diff` | 差异比对 | 对比草稿与现有Wiki，决定 merge/create/discard | 是 |
| `execute` | 生成动作 | 将决策转换为可执行的 WikiAction | 否 |

**v0.6 优化亮点**：
- 来源链接智能合并（同来源 block 共享一个链接）
- 显示名格式化：`日期—来源—主题`
- 笔记 frontmatter 美化

#### 3.2.2 ai-client.ts - AI API 客户端

封装了与大模型的交互，支持：
- **聚类** (`clusterRounds`)
- **草稿生成** (`draftFromCluster`)
- **差异比对** (`diffWithCandidates`)
- **简介生成** (`generateBrief`)

支持重试机制，自动处理 API 错误。

---

### 3.3 Retrieve 模块 (v0.5)

#### 3.3.1 embedding-client.ts - 向量化客户端

支持多供应商：OpenAI / 智谱 / 阿里云通义

#### 3.3.2 vector-store.ts - 向量存储

本地 JSON 文件存储，核心功能：
- `upsertChunks()` - 添加/更新向量
- `search()` - 余弦相似度搜索
- `removeByPath()` - 删除文件相关向量

#### 3.3.3 semantic-search.ts - 语义搜索

支持两种模式：
- **Page 模式**：按页面聚合，同一页面合并结果
- **Chunk 模式**：每个 chunk 独立返回

#### 3.3.4 rag-chat.ts - RAG 对话

实现基于知识库的问答，支持流式输出和引用标注。

#### 3.3.5 quota-manager.ts - 配额管理

- 每日 Token 限额控制
- 历史使用记录
- 成本预估

---

### 3.4 Recall 模块 (v0.6)

#### 3.4.1 srs-engine.ts - SRS 算法引擎

支持两种间隔重复算法：

| 算法 | 特点 | 参数 |
|------|------|------|
| **SM-2** | 经典算法，简单可靠 | `easeFactor`, `interval`, `repetitions` |
| **FSRS-4.5** | 现代算法，更精准 | `stability`, `difficulty` |

**评分系统**：
```
1 = Again（完全不会）→ 重置间隔
2 = Hard（困难）     → 短间隔
3 = Good（正确）     → 标准间隔
4 = Easy（很简单）   → 长间隔（×1.3 bonus）
```

**核心方法**：
- `review(card, rating)` - 处理复习评分
- `createInitialSRS()` - 创建初始 SRS 数据
- `isDueToday(srs)` - 判断卡片是否到期

#### 3.4.2 recall-card-store.ts - 卡片存储

文件系统存储结构：
```
_system/recall/
├── cards/
│   ├── wiki/*.json
│   ├── vocab/*.json
│   ├── interview/*.json
│   ├── concept/*.json
│   ├── phrase/*.json
│   ├── command/*.json
│   └── custom/*.json
├── sessions/*.json    # 复习会话记录
├── stats/
│   ├── 2024-01-01.json
│   └── ...
├── wordlists/
│   ├── lists.json
│   ├── cet4.json
│   ├── cet6.json
│   └── ...
├── interview/
│   └── jd_*.json
└── custom-scenarios.json
```

#### 3.4.3 场景生成器

| 场景 | 生成器 | 数据来源 | 特色 |
|------|-------|----------|------|
| Wiki | `recall-wiki-generator.ts` | 用户知识库 | AI 自动提取知识点 |
| 命令 | `recall-command-generator.ts` | 50+ 内置库 | Linux/Git/Docker 命令 |
| 单词 | `recall-vocab-generator.ts` | 6 大词库 | 4 种复习模式 |
| 概念 | `recall-concept-generator.ts` | Wiki concept 页面 | AI 一键生成概念卡 |
| 短语 | `recall-phrase-generator.ts` | 11 种语言 | 罗马音/拼音标注 |
| 面试 | JD + GapAnalyzer | JD 解析 | 知识盘点 + 模拟面试 |
| 自定义 | `custom-scenario-store.ts` | 用户模板 | 4 个预设模板 |

#### 3.4.4 面试助手完整闭环

```
1. 粘贴 JD
   ↓
2. AI 解析（公司/职位/技能/职责）
   ↓
3. 知识盘点（两种模式）
   ├── 本地盘点：对照 Wiki，给出准备度报告
   └── AI 增强：调用 AI 生成缺失知识 → 走采集流程 → 保存到 Wiki → 重新盘点
   ↓
4. 模拟面试
   ├── AI 智能出题（70% 技术 + 30% 行为，重点出薄弱项）
   ├── 答题评估（0-100 分 + 优点/不足/改进建议/模范答案）
   └── 一键保存为复习卡
```

#### 3.4.5 Dashboard 数据看板

- **6 大核心指标**：复习数 / 正确率 / 用时 / 新卡片 / 连续天数 / 待复习
- **学习热力图**：GitHub 风格，最近 90 天
- **趋势柱状图**：最近 30 天，颜色区分正确率
- **场景对比**：按复习数排序
- **卡片库总览**：状态分布 + 场景分布
- **周期切换**：今日 / 本周 / 本月 / 全部

---

## 4. 数据结构

### 4.1 Wiki 三层架构

```
{vault}/
├── raw/                     # 原始数据层（只读）
│   └── conversations/       # 对话存档
│       └── 20240101123000-对话名.md
├── wiki/                    # 知识层（AI维护）
│   ├── INDEX.md             # 自动生成的索引
│   ├── entities/            # 实体页（人物/工具/产品）
│   ├── concepts/            # 概念页（思想/方法）
│   ├── topics/             # 主题页（综合知识）
│   ├── comparisons/        # 对比页（A vs B）
│   └── overviews/          # 概述页（领域全景）
├── schema/                  # 规则层（人类定义）
│   ├── CLAUDE.md           # AI 工作说明书
│   ├── conventions.md      # 命名规范
│   ├── page-templates/     # 5 种页面模板
│   └── workflows/          # 工作流定义
└── _system/                 # 系统数据
    ├── vectors.json         # 向量索引
    ├── quota.json           # 配额记录
    ├── chat-sessions/       # 聊天会话
    └── recall/              # 复习数据
```

### 4.2 核心数据模型

#### RecallCard - 复习卡片

```typescript
interface RecallCard {
  id: string;                    // 唯一标识
  scenario: RecallScenario;      // 场景类型
  front: string;                 // 正面内容
  back: string;                  // 背面内容
  hints?: string[];              // 提示
  examples?: string[];           // 例句
  metadata?: Record<string, any>; // 元数据
  srs: SRSData;                  // SRS算法数据
  stats: RecallCardStats;        // 统计数据
  tags: string[];                // 标签
  status: RecallCardStatus;      // 状态
  createdAt: string;
  updatedAt: string;
}
```

#### SRSData - SRS 算法数据

```typescript
interface SRSData {
  algorithm: "sm2" | "fsrs";     // 算法类型
  interval: number;              // 当前间隔天数
  repetitions: number;           // 重复次数
  easeFactor: number;            // SM-2: 难度因子
  stability: number;             // FSRS: 稳定性
  difficulty: number;            // FSRS: 难度
  nextReview: string;            // 下次复习日期
  lastReview: string;            // 上次复习日期
  lastRating: RecallRating | 0;  // 上次评分
}
```

---

## 5. 关键依赖

### 5.1 第三方依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `obsidian` | ^1.5.12 | Obsidian API |
| `typescript` | ^5.4.5 | 类型检查 |
| `esbuild` | ^0.25.0 | 构建工具 |
| `tslib` | ^2.6.3 | TypeScript 运行时 |

### 5.2 外部服务

| 服务 | 用途 | 配置项 |
|------|------|-------|
| **OpenAI/Claude/Kimi/豆包** | 主模型 API | `apiBaseUrl`, `apiKey`, `model` |
| **阿里云通义/智谱** | Embedding API | `embeddingApiBaseUrl`, `embeddingApiKey` |

---

## 6. 运行与开发

### 6.1 安装依赖

```bash
npm install
```

### 6.2 开发模式

```bash
npm run dev
```

启动 esbuild 监听模式，自动重新编译。

### 6.3 构建生产版本

```bash
npm run build
```

### 6.4 Obsidian 插件加载

1. 构建成功后，在 `.obsidian/plugins/` 目录创建 `mindos` 文件夹
2. 复制 `main.js`, `manifest.json`, `styles.css` 到该目录
3. 重启 Obsidian，在设置中启用 MindOS

---

## 7. 主要 API 接口

### 7.1 插件命令

| 命令 ID | 名称 | 功能 |
|---------|------|------|
| `mindos-collect` | 采集并整理 AI 对话 | 从剪贴板采集 |
| `mindos-open-center` | 打开任务中心 | 打开主界面 |
| `mindos-rebuild-index` | 重建 Wiki INDEX | 更新索引文件 |
| `mindos-vectorize-all` | 全量向量化索引 | 重建向量库 |
| `mindos-sync-incremental` | 增量同步向量索引 | 更新变更文件 |
| `mindos-open-search` | 打开语义检索 | 检索标签页 |
| `mindos-open-chat` | 打开 RAG 问答 | 聊天标签页 |
| `mindos-open-recall` | 打开复习模块 | 复习标签页 |
| `mindos-recall-dashboard` | 打开学习数据看板 | 统计面板 |
| `mindos-recall-card-manager` | 打开卡片管理面板 | 卡片管理 |
| `mindos-recall-interview` | 打开面试助手 | 面试模块 |

### 7.2 协议处理

支持 `mindos://` 协议：

```
mindos://?mode=clipboard&source=browser&title=xxx&content=xxx
```

---

## 8. 版本演进

| 版本 | 主要特性 | 时间 | 关键交付 |
|------|---------|------|---------|
| **v0.1** | 基础采集 | 2024 Q1 | 浏览器扩展采集 AI 对话 |
| **v0.2** | 单回合整理 | - | 一对一 AI 整理 |
| **v0.3** | 任务中心 + 流水线 | - | 多回合并行处理 |
| **v0.4** | LLM Wiki 三层架构 | - | raw/wiki/schema |
| **v0.4.5** | MindOS 品牌化 | - | 改名 + 模块化重构 |
| **v0.5** | 语义检索 + RAG | 2024 Q2 | 向量化+语义搜索+RAG |
| **v0.6.0** | Recall 复习核心 | 2024 Q3 | SRS + 7 大场景 |
| **v0.6.1** | UI 修复 | - | 输入框失焦/历史折叠 |
| **v0.6.2** | 来源链接优化 | - | 日期—来源—主题 |
| **v0.6.3** | 来源链接智能分组 | - | 同来源 block 共享 |
| **v0.6.4** | AI 回答修复 | - | 流式输出修复 |
| **v0.6.5** | 死循环修复 | - | 面试助手返回按钮 |
| **v0.7** | 输出与表达 | - | Express 文章生成 + TTS 听力 + 智能卡片关联 |
| **v0.8** | Connect 关联引擎 | - | 反向链接增强/矛盾检测/自动链接挖掘/智能萃取 |
| **v0.9** | Evolve 知识演化 | - | 版本历史/健康度报告/知识空白雷达/演化面板 |
| **v1.0.0** | 工程化整合 | 2026 | 死代码清理 + 类型全绿 + 单元测试 + 文档对齐 |
| **v1.1.0** | 数据迁移（4C） | 2026 | Anki 文本/CSV/MD/JSON 导出 + 多格式导入 + 一键备份恢复 |

---

## 9. 配置说明

### 9.1 默认配置

```typescript
const DEFAULT_SETTINGS = {
  baseFolder: "Knowledge Base",    // 知识库根目录
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.1,
  
  // Embedding 配置
  embeddingProvider: "aliyun",
  embeddingModel: "text-embedding-v3",
  embeddingDim: 1024,
  
  // RAG 配置
  ragEnabled: true,
  ragTopK: 5,
  ragTemperature: 0.3,
  
  // 复习配置
  recallSRSAlgorithm: "sm2",
  recallNewCardsPerDay: 20,
  recallReviewLimit: 100,
  
  // 配额配置
  dailyTokenLimit: 1000000,
};
```

---

## 10. 核心功能完整清单

### 已实现（共 100+ 个功能点）

#### 采集与 Wiki
- [x] 浏览器扩展采集 AI 对话（ChatGPT/Claude/Kimi/豆包/通义/文心）
- [x] 协议唤起（`obsidian://mindos`）
- [x] 四阶段流水线（聚类/草稿/比对/执行）
- [x] 智能合并（merge/create/discard）
- [x] 用户审核模式
- [x] 自动 INDEX.md 维护
- [x] 缺失 brief 一键补全
- [x] 旧版本迁移
- [x] 来源链接智能合并 + 命名美化
- [x] frontmatter 富化

#### 检索与问答
- [x] 多 Provider Embedding 支持
- [x] 智能切片（章节为主）
- [x] 全量/增量/自动向量化
- [x] 余弦相似度搜索
- [x] Page/Chunk 双模式
- [x] Token 配额 + 成本预估
- [x] 多轮 RAG 对话
- [x] 流式输出 + 中止机制
- [x] 引用展示
- [x] 对话历史折叠
- [x] 对话导出为 Wiki 笔记

#### Recall 复习系统
- [x] SM-2 + FSRS 双算法
- [x] 翻转卡片 + 答题输入
- [x] 4 档评分（1/2/3/4 快捷键）
- [x] 复习会话总结
- [x] 每日统计
- [x] 7 大场景全覆盖
- [x] 卡片管理面板（搜索/过滤/批量）
- [x] 卡片编辑器
- [x] 卡片预览弹窗
- [x] 面试助手完整闭环
- [x] 模拟面试 + AI 评估
- [x] 自定义场景（字段+模板+AI）
- [x] 4 个预设模板
- [x] Dashboard 数据看板
- [x] AI 增强知识盘点

#### Express 输出（v0.7）
- [x] 多风格文章生成（技术博客/公众号/邮件周报等）
- [x] AI 大纲构建 + 草稿编辑导出
- [x] TTS 听力模式（Web Speech API）
- [x] 智能卡片关联推荐（向量相似度 + 标签/场景加成）

#### Connect 关联引擎（v0.8）
- [x] 反向链接增强（含引用上下文）
- [x] AI 矛盾检测
- [x] 自动链接挖掘
- [x] 智能萃取面板
- [ ] 知识图谱可视化（待开发）

#### Evolve 知识演化（v0.9）
- [x] 版本历史 + 可视化 diff + 时间线
- [x] 知识库健康度报告
- [x] 知识空白雷达
- [ ] 知识衰减提醒 / 自动重构（待开发）

#### 工程化（v1.0.0）
- [x] 死代码清理（-26 个遗留文件 / -12,145 行）
- [x] TypeScript strict 全绿（修复 100+ 错误）
- [x] 单元测试体系（37 个用例：SRS / 相似度 / Token 估算）

#### 数据迁移（v1.1.0，路线图 4C）
- [x] 导出 Anki 文本（官方 `#` 指令，Anki 直接导入）
- [x] 导出 CSV / Markdown 归档 / JSON 无损
- [x] 导入 MindOS JSON / Anki 文本 / CSV / TSV（表头识别 + 引号转义 + 去重）
- [x] 一键备份（卡片 + 插件数据）与恢复
- [x] 迁移模块单元测试（21 个用例，含往返无损）

---

## 11. 项目统计

| 维度 | 数值 |
|------|------|
| TypeScript 代码 | ~36,900 行 |
| CSS 样式 | ~14,400 行（模块化） |
| 核心文件数 | ~109 个 |
| 复习场景数 | 7 个 |
| 预设模板 | 4 个 |
| 内置词库 | 6 个（CET4/6/考研/IELTS/TOEFL/GRE） |
| 种子词条 | 200+ |
| 内置命令 | 26 个 |
| 支持语言 | 11 种 |
| 核心功能点 | 120+ |
| 状态管理 Store | 3 个 |
| AI 集成场景 | 10+ 个 |
| 单元测试 | 58 个 |

---

## 12. 开发路线图

### 12.1 路线图总览

```
v0.6（已完成）
  ├── 采集 / 检索 / 问答 / 复习  四大核心 Tab
  └── Recall 7 大场景 + 数据看板

v0.7（已基本完成）  → 输出与表达
  ├── 4A: Express 输出引擎 → ✅ 文章生成已完成（PPT/简历待开发）
  ├── 4B: TTS 听力模式 → ✅ 已完成
  ├── 智能卡片关联 → ✅ 已完成（向量相似度推荐）
  └── 4C: 数据迁移 → ✅ 已完成（Anki 文本/CSV/MD/JSON 导出 + 导入 + 备份，v1.1）

v0.8（已基本完成）  → 知识连接
  └── Connect 关联引擎：反向链接/矛盾检测/自动链接挖掘 ✅（知识图谱待开发）

v0.9（已基本完成）  → 知识演化
  └── Evolve：版本历史/健康度报告/知识空白雷达 ✅（衰减/自动重构待开发）

v1.0（进行中）  → 工程化 + 智能体
  ├── 工程化整合：死代码清理 + 类型全绿 + 单元测试 ✅
  └── Agent（主动 AI/对话式 PKM）→ 🔄 待开发

v1.x  → 生态扩展
  ├── 移动端适配
  ├── 多人协作
  └── 第三方插件
```

### 12.2 v0.7 详细规划（输出与表达）

#### 方向 4A：Express 输出引擎（部分完成）

**核心价值**：把积累的知识库变现为可分享的内容

| 功能 | 状态 | 描述 |
|------|------|------|
| **文章生成器** | ✅ | 基于 Wiki 主题生成多风格文章（技术博客/公众号/周报等） |
| **PPT 大纲生成** | 📋 规划中 | AI 生成 PPT 大纲，导出 Marp/Slidev/PPTX（尚未实现） |
| **简历生成器** | 📋 规划中 | 基于项目笔记生成 STAR 格式简历，针对 JD 优化（尚未实现） |
| **周报/日报生成** | ✅ | 邮件周报等风格模板已内置于文章生成器 |

**文章生成器核心流程**：
```
输入：一个主题 + 风格要求
↓
AI 检索 Wiki 中的相关知识
↓
按照大纲生成文章草稿
↓
用户编辑 → 一键导出 Markdown / 复制到剪贴板
```

#### 方向 4B：复习强化

| 功能 | 状态 | 描述 | 技术方案 |
|------|------|------|---------|
| **TTS 听力模式** | ✅ 已完成 | 播放单词朗读，听音拼写 | Web Speech API |
| **智能卡片关联** | ✅ 已完成 | 复习时推荐相关卡片（card-relations 模块） | 向量相似度 |
| **学习计划生成** | 📋 规划中 | AI 分析目标，生成每日学习计划 | Wiki 分析 |
| **学习曲线预测** | 📋 规划中 | 预测掌握所有卡片的时间 | 复习数据建模 |
| **费曼学习模式** | 📋 规划中 | AI 用费曼技巧讲解概念 | RAG + 生成 |

#### 方向 4C：数据迁移与互通（v1.1 已实现）

| 功能 | 状态 | 描述 | 格式支持 |
|------|------|------|---------|
| **导出到 Anki** | ✅ | 卡片导出为 Anki 文本（官方 `#` 指令），Anki 直接导入 | .txt（tab 分隔） |
| **通用导出** | ✅ | CSV / Markdown 归档 / JSON 无损 | .csv / .md / .json |
| **导入外部数据** | ✅ | MindOS JSON / Anki 文本 / CSV / TSV，自动识别 + 去重 | 多格式 |
| **完整数据备份** | ✅ | 一键备份卡片 + 插件数据，支持恢复 | .json |
| **导出 .apkg 原生格式** | 📋 规划中 | 需引入 SQLite（sql.js/wasm），体积权衡后暂缓 | - |
| **云同步指南** | 📋 规划中 | Obsidian Sync/iCloud/Git 同步配置 | 文档 |

**迁移中心入口**：命令面板「打开数据迁移中心（导出/导入/备份）」；导出文件存于 `<baseFolder>/迁移与备份/`。

### 12.3 v0.8 - Connect 关联引擎

**核心价值**：让分散的知识自动相连，发现知识网络

| 功能 | 描述 |
|------|------|
| **知识图谱可视化** | 基于 [[]] 链接构建有向图，D3.js 可视化 |
| **反向链接增强** | 显示被哪些笔记引用，含引用上下文 |
| **矛盾检测** | AI 扫描矛盾内容，弹窗确认/修正 |
| **自动链接建议** | 新建笔记时 AI 建议 [[link]] |
| **自动标签建议** | AI 基于内容建议 5-10 个标签 |

### 12.4 v0.9 - Evolve 演化

**核心价值**：让知识库有生命，随时间成熟

| 功能 | 描述 |
|------|------|
| **版本历史** | 自动保存历史版本，可视化 diff，一键回滚 |
| **知识衰减提醒** | 长时间未更新的笔记显示警告 |
| **自动重构建议** | AI 发现重复/过长/可合并的笔记 |
| **知识树成熟度** | 每笔记自动标记 🌱/🌿/🌲 |
| **健康度报告** | 每周生成知识体系健康度报告 |

### 12.5 v1.0 - Agent 智能体

**核心价值**：从被动响应到主动协助，真正的 AI 副驾

| 功能 | 描述 |
|------|------|
| **主动 AI 助理** | 早上推送复习、晚上生成总结、定时提醒 |
| **对话式 PKM** | 统一对话入口，触发所有功能 |
| **智能任务规划** | "下周面试字节" → 自动准备计划+推送复习 |
| **持续记忆** | AI 记住用户偏好、学习习惯、常用术语 |

### 12.6 工程量预估

| 版本 | 模块 | 新增文件 | 代码量 | 开发周期 |
|------|------|---------|--------|---------|
| **v0.7** | Express + 复习强化 + 数据迁移 | 19-25 | ~5800 行 | 9-10 批次 |
| **v0.8** | Connect 关联引擎 | 10-12 | ~3000 行 | 5-6 批次 |
| **v0.9** | Evolve 演化 | 8-10 | ~2500 行 | 4 批次 |
| **v1.0** | Agent 智能体 | 12-15 | ~3500 行 | 6-8 批次 |

**总计**：v0.7 - v1.0 约 50+ 个新文件，~15000 行代码

### 12.7 推荐开发顺序

| 优先级 | 方向 | 状态 | 理由 |
|--------|------|------|------|
| 🥇 第一优先 | Express 文章生成器 | ✅ 已完成 | 立竿见影，形成完整闭环 |
| 🥇 第一优先 | TTS 听力模式 | ✅ 已完成 | 低成本高价值，提升英语场景体验 |
| 🥈 第二优先 | 智能卡片关联 | ✅ 已完成 | 向量化 card front/back，推荐相关卡片 |
| 🥈 第二优先 | Anki 互通 | 📋 规划中 | 解决移动端痛点，让用户安心 |
| 🥉 第三优先 | Connect 知识图谱 | 📋 规划中 | 视觉冲击力强，吸引新用户 |

### 12.8 已交付：智能卡片关联推荐（✅ 见 card-relations 模块）

**核心功能**：复习时基于向量相似度推荐相关卡片

**实现方案**：
```
复习卡片 A 时
↓
AI 基于卡片 front/back 向量化
↓
找出 5 张最相关的卡片
↓
显示「相关推荐」→ 一键串学
```

**算法**：
- 基于现有 `vector-store.ts` 向量存储
- 对 card front/back 进行 embedding
- 余弦相似度排序
- 优先推荐：同标签 > 同来源 > 语义相似

**工程量**：
- 新增文件：~3 个（card-embedding-store.ts, card-recommender.ts, 相关 UI）
- 代码量：~800 行
- 依赖：复用现有 embedding 基础设施

---

## 附录：核心文件路径速查

| 模块 | 文件 | 路径 |
|------|------|------|
| 主入口 | main.ts | `/workspace/main.ts` |
| 类型定义 | types.ts | `/workspace/src/core/types.ts` |
| 常量配置 | constants.ts | `/workspace/src/core/constants.ts` |
| 状态管理 | store.ts | `/workspace/src/core/store.ts` |
| 工作流引擎 | workflow-engine.ts | `/workspace/src/modules/pipeline/workflow-engine.ts` |
| AI 客户端 | ai-client.ts | `/workspace/src/modules/pipeline/ai-client.ts` |
| 向量存储 | vector-store.ts | `/workspace/src/modules/retrieve/vector-store.ts` |
| RAG 对话 | rag-chat.ts | `/workspace/src/modules/retrieve/rag-chat.ts` |
| SRS 引擎 | srs-engine.ts | `/workspace/src/modules/recall/srs-engine.ts` |
| 卡片存储 | recall-card-store.ts | `/workspace/src/modules/recall/recall-card-store.ts` |
| 复习视图 | view-recall.ts | `/workspace/src/modules/recall/view-recall.ts` |
| 数据看板 | dashboard-view.ts | `/workspace/src/modules/recall/dashboard-view.ts` |
| JD 解析 | jd-analyzer.ts | `/workspace/src/modules/recall/jd-analyzer.ts` |
| 模拟面试 | mock-interviewer.ts | `/workspace/src/modules/recall/mock-interviewer.ts` |
