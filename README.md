# MindOS (Obsidian Plugin) — Your Second Brain, OS-Level

MindOS 是一个 **Obsidian 本地优先**的个人知识管理系统（PKM），将「采集 → 整理 → 检索问答 → 间隔复习」打通成闭环，并坚持：

- **File First，Database Last**：所有数据均存储为 Markdown / JSON，插件挂了数据也可用
- **AI 是助手，不是主宰**：支持审核模式，重要变更由人确认
- **系统自我可读**：schema/ 规则层自解释，未来可迁移可演化

> 当前版本：**v0.6.5（稳定可用）**  
> 开发中：**v0.7（Express 输出引擎）**

---

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