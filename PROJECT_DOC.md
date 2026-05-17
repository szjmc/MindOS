# MindOS 项目文档

---

## 1. 项目概述

### 1.1 项目简介

**MindOS** 是一款面向 Obsidian 的 AI 知识管理与智能复习插件，致力于构建"第二层大脑"级别的知识管理系统。

| 属性 | 值 |
|------|-----|
| 项目名称 | MindOS |
| 版本 | v0.6.5 |
| 类型 | Obsidian 插件 |
| 开发语言 | TypeScript |
| 核心理念 | 采集 → 整理 → 检索 → 复习 |

### 1.2 核心功能

| 模块 | 功能描述 | 版本 |
|------|---------|------|
| **智能采集** | 从剪贴板/browser协议采集AI对话，自动分类整理 | v0.1 |
| **知识管理** | Wiki三层架构：raw → wiki → schema | v0.1 |
| **语义检索** | 基于向量的全文检索 | v0.5 |
| **RAG问答** | 基于知识库的对话式问答 | v0.5 |
| **智能复习** | SRS间隔重复算法（SM-2/FSRS） | v0.6 |
| **面试助手** | JD解析、知识盘点、模拟面试 | v0.6 |
| **单词记忆** | 内置主流词库，支持多模式复习 | v0.6 |
| **多语言短语** | 日语/韩语/西班牙语等短语记忆 | v0.6 |
| **自定义场景** | 用户自定义复习卡片模板 | v0.6 |

---

## 2. 架构设计

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       MindOS Plugin                            │
│                         (main.ts)                              │
├─────────────────────────────────────────────────────────────────┤
│                      UI Layer                                  │
│   ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐       │
│   │ MindOSView   │ │ SettingTab   │ │ DashboardView    │       │
│   │  (采集/检索) │ │   (设置)     │ │   (数据看板)     │       │
│   └──────────────┘ └──────────────┘ └──────────────────┘       │
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
│  │  + 面试助手: JDAnalyzer → GapAnalyzer → MockInterviewer│  │
│  └───────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│                      Data Layer                               │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐               │
│  │  raw/   │ │  wiki/   │ │   _system/       │               │
│  │(原始对话)│ │(知识层)  │ │(向量/会话/卡片)  │               │
│  └─────────┘ └──────────┘ └──────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
src/
├── core/                    # 核心模块
│   ├── types.ts             # 类型定义（700+行）
│   ├── constants.ts         # 常量配置
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
│   │   └── chat-session-store.ts # 会话存储
│   └── recall/              # 复习模块 (v0.6)
│       ├── srs-engine.ts      # SRS算法引擎
│       ├── recall-card-store.ts # 卡片存储
│       ├── ai-card-generator.ts # AI生成卡片
│       ├── view-recall.ts      # 复习界面
│       ├── dashboard-service.ts # 数据统计
│       ├── dashboard-view.ts   # 数据看板
│       ├── recall-card-manager-view.ts # 卡片管理
│       ├── recall-wiki-generator.ts   # Wiki场景
│       ├── recall-command-generator.ts # 命令场景
│       ├── recall-vocab-generator.ts   # 单词场景
│       ├── recall-concept-generator.ts # 概念场景
│       ├── recall-phrase-generator.ts  # 短语场景
│       ├── word-list-store.ts   # 词库存储
│       ├── builtin-vocab-data.ts # 内置词库数据
│       ├── jd-analyzer.ts       # JD解析
│       ├── gap-analyzer.ts      # 知识盘点
│       ├── interview-store.ts   # 面试数据存储
│       ├── interview-view.ts    # 面试界面
│       ├── mock-interviewer.ts  # 模拟面试官
│       ├── mock-interview-view.ts # 模拟面试界面
│       ├── custom-scenario-store.ts # 自定义场景
│       └── various_modals.ts    # 各类弹窗组件
└── ui/
    └── settings-tab.ts      # 设置页面
```

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

**核心流程**：

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Cluster │ → │  Draft   │ → │   Diff   │ → │ Execute  │
│  回合聚类 │    │  整理草稿 │    │  差异比对 │    │  生成动作 │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

**Pipeline 阶段说明**：

| 阶段 | 名称 | 职责 | AI 调用 |
|------|------|------|---------|
| `cluster` | 回合聚类 | 判断哪些回合讨论同一主题 | 是 |
| `draft` | 整理草稿 | 将同主题回合整理成结构化草稿 | 是 |
| `diff` | 差异比对 | 对比草稿与现有Wiki，决定 merge/create/discard | 是 |
| `execute` | 生成动作 | 将决策转换为可执行的 WikiAction | 否 |

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

---

### 3.4 Recall 模块 (v0.6)

#### 3.4.1 srs-engine.ts - SRS 算法引擎

支持两种间隔重复算法：

| 算法 | 特点 | 参数 |
|------|------|------|
| **SM-2** | 经典算法，简单可靠 | `easeFactor`, `interval`, `repetitions` |
| **FSRS-4.5** | 现代算法，更精准 | `stability`, `difficulty` |

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
│   └── ...
├── sessions/*.json    # 复习会话记录
└── stats/
    ├── 2024-01-01.json
    ├── 2024-01-02.json
    └── ...
```

#### 3.4.3 场景生成器

| 场景 | 生成器 | 用途 |
|------|-------|------|
| Wiki | `recall-wiki-generator.ts` | 从Wiki页面生成卡片 |
| 命令 | `recall-command-generator.ts` | Linux/Git/Docker命令 |
| 单词 | `recall-vocab-generator.ts` | 英语单词记忆 |
| 概念 | `recall-concept-generator.ts` | 核心概念定义 |
| 短语 | `recall-phrase-generator.ts` | 多语言短语 |
| 自定义 | `custom-scenario-store.ts` | 用户自定义场景 |

#### 3.4.4 面试助手

**JD 分析流程**：

```
JD文本 → JDAnalyzer → GapAnalyzer → MockInterviewer
  │         │              │               │
  └────→ 技能提取 ──→ 知识盘点 ──→ 模拟面试
```

---

## 4. 数据结构

### 4.1 文件目录结构

```
Knowledge Base/              # 基础文件夹（可配置）
├── raw/                     # 原始数据层（只读）
│   └── conversations/       # 对话存档
│       └── 20240101123000-对话名.md
├── wiki/                    # 知识层（AI维护）
│   ├── INDEX.md             # 自动生成的索引
│   ├── entities/            # 实体页
│   ├── concepts/            # 概念页
│   ├── topics/              # 主题页
│   ├── comparisons/         # 对比页
│   └── overviews/           # 概述页
├── schema/                  # 规则层（人类定义）
│   ├── CLAUDE.md            # AI 行为规则
│   ├── conventions.md       # 命名规范
│   └── page-templates/      # 页面模板
└── _system/                 # 系统数据（v0.5+）
    ├── vectors.json         # 向量索引
    ├── quota.json           # 配额记录
    ├── chat-sessions/       # 聊天会话
    └── recall/              # 复习数据（v0.6）
        ├── cards/           # 卡片存储
        ├── sessions/        # 复习会话
        └── stats/           # 每日统计
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

| 版本 | 主要特性 | 时间 |
|------|---------|------|
| v0.1 | 基础采集与整理 | 2024 Q1 |
| v0.5 | 语义检索 + RAG 问答 | 2024 Q2 |
| v0.6 | 智能复习系统（SRS）+ 面试助手 + 单词记忆 | 2024 Q3 |

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

## 10. 架构设计原则

### 10.1 三层架构

MindOS 遵循 Karpathy 的 LLM Wiki 三层架构：

| 层级 | 目录 | 职责 | 权限 |
|------|------|------|------|
| **raw** | `raw/` | 事实基准，原始数据 | 只读 |
| **wiki** | `wiki/` | AI 维护的知识层 | AI 读写 |
| **schema** | `schema/` | 人类定义的规则 | 人类写，AI 读 |

### 10.2 状态管理原则

- 使用响应式 Store 管理状态
- Store 内部维护 listeners，状态变更自动通知订阅者
- UI 组件通过 subscribe 订阅状态变化

### 10.3 错误处理

- AI 调用支持重试机制
- 关键操作有错误日志记录
- 用户操作有友好的错误提示

---

## 11. 安全注意事项

1. **API Key 保护**：敏感配置存储在 Obsidian 加密数据中
2. **配额管理**：每日 Token 限制，避免超额费用
3. **数据隔离**：不同场景的卡片独立存储
4. **错误兜底**：AI 解析失败时有降级策略

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
| SRS 引擎 | srs-engine.ts | `/workspace/src/modules/recall/srs-engine.ts` |
| 卡片存储 | recall-card-store.ts | `/workspace/src/modules/recall/recall-card-store.ts` |