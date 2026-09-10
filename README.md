# MindOS - Your Second Brain, OS-Level

<div align="center">

![Version](https://img.shields.io/badge/version-1.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.5+-lightgray)

**AI 知识管理 + 智能复习系统**

*从信息采集到知识沉淀，从被动学习到主动巩固*

[功能介绍](#核心功能) · [快速开始](#快速开始) · [详细文档](PROJECT_DOC.md) · [更新日志](#更新日志)

</div>

---

## 项目概况

| 属性 | 内容 |
|------|------|
| **项目定位** | Obsidian 个人知识管理 + AI 智能复习系统 |
| **当前版本** | v1.1.0 |
| **代码总量** | ~36,900 行 TypeScript + ~14,400 行 CSS |
| **核心文件数** | ~109 个 |
| **复习场景** | 7 个（含自定义） |
| **核心功能点** | 100+ |
| **架构模式** | 模块化 + Store 状态管理 + View 渲染分离 |

---

## 设计哲学

MindOS 是一个 **Obsidian 本地优先**的个人知识管理系统（PKM），将「采集 → 整理 → 检索问答 → 间隔复习」打通成闭环，并坚持：

1. **File First，Database Last**：所有数据均存储为 Markdown / JSON，插件挂了数据也可用
2. **AI 是助手，不是主宰**：支持审核模式，重要变更由人确认
3. **系统自我可读**：schema/ 规则层自解释，未来可迁移可演化

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

> ⚠️ **安全提醒（重要）**：
> API Key 以明文形式存储在 `.obsidian/plugins/mindos/data.json` 中。
> 请务必：
> - 将 `.obsidian/plugins/mindos/data.json` 加入 `.gitignore`，**不要**上传到 GitHub
> - 如果使用 iCloud / 坚果云 等同步服务，确认该文件不被同步
> - 定期在 API 提供商平台更换密钥
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

### v1.1.0（当前）→ 数据迁移（路线图 4C）

- 📤 **导出**：全部复习卡片一键导出为 Anki 文本（Anki 可直接导入）/ CSV / Markdown / JSON
- 📥 **导入**：支持 MindOS JSON、Anki 文本（含 `#` 指令）、CSV/TSV（中英文表头自动识别、引号转义、去重）
- 💾 **一键备份**：卡片 + 插件数据完整备份为 `.json`，支持恢复
- 新增命令「打开数据迁移中心」，导出文件存于 `迁移与备份/` 目录
- 新增 21 个单元测试（导出/导入/往返无损），累计 58 个

### v1.0.0 → 工程化整合

- 代码瘦身：清理 26 个重构遗留的旧版文件（约 1.2 万行死代码）
- 类型安全：修复全部 100+ 个 TypeScript strict 编译错误，`tsc --noEmit` 全绿
- 测试体系：新增 37 个单元测试（SRS 算法 / 卡片相似度 / Token 估算），`npm test` 可用
- 文档与版本对齐：统一版本号、更新路线图与统计数据

### v0.9 → 知识演化（已实现）

- 版本历史：自动快照 + 可视化 diff + 时间线回看
- 知识库健康度报告
- 知识空白雷达（knowledge gaps）
- 知识演化面板

### v0.8 → Connect 关联引擎（已实现）

- 反向链接增强（含引用上下文）
- 矛盾检测（AI 扫描）
- 自动链接挖掘
- 智能萃取面板

### v0.7 → 输出与表达

#### 已完成
- **4A: Express 输出引擎** - 多风格文章生成（技术博客/公众号/周报等）
- **4B: TTS 听力模式** - Web Speech API 单词朗读
- **智能卡片关联** - 复习时基于向量相似度推荐相关卡片
- **4C: 数据迁移** - Anki 文本 / CSV / Markdown / JSON 导出 + 导入 + 一键备份（v1.1）

#### 待开发
- **PPT 大纲生成 / 简历生成器**（规划中，尚未实现）

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
| TypeScript 代码 | ~36,900 行 |
| CSS 样式 | ~14,400 行（模块化管理） |
| 核心文件数 | ~109 个 |
| 复习场景数 | 7 个 |
| 预设模板 | 4 个 |
| 内置词库 | 6 个 |
| 种子词条 | 200+ |
| 内置命令 | 26 个 |
| 支持语言 | 11 种 |
| 核心功能点 | 120+ |
| 状态管理 Store | 3 个 |
| AI 集成场景 | 10+ 个 |
| 单元测试 | 58 个（SRS/相似度/Token 估算/数据迁移） |

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

## 目录结构

所有数据默认位于 `baseFolder`（默认：`Knowledge Base/`）

```
{baseFolder}/
├── raw/
│   └── conversations/        # 原始对话存档（不可改）
├── wiki/
│   ├── INDEX.md              # 自动索引
│   ├── entities/             # 实体页
│   ├── concepts/             # 概念页
│   ├── topics/               # 主题页
│   ├── comparisons/          # 对比页
│   └── overviews/            # 概述页
├── schema/
│   ├── CLAUDE.md             # AI 工作说明书（规则层）
│   ├── conventions.md        # 命名规范
│   └── page-templates/       # 页面模板
└── _system/
    ├── vectors.json          # 向量索引
    ├── quota.json            # Token 配额
    ├── chat-sessions/        # RAG 对话历史
    └── recall/               # Recall 数据
        ├── cards/            # 卡片存储
        ├── sessions/         # 复习会话
        ├── stats/            # 每日统计
        ├── wordlists/        # 词库
        ├── interview/        # 面试数据
        └── custom-scenarios.json  # 自定义场景
```

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
