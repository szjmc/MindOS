# MindOS - Your Second Brain, OS-Level

<div align="center">

![Version](https://img.shields.io/badge/version-0.6.5-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.5+-lightgray)

**AI 知识管理 + 智能复习系统**

[功能介绍](#核心功能) · [快速开始](#快速开始) · [文档](PROJECT_DOC.md) · [更新日志](#更新日志)

</div>

---

## 核心功能

### 📥 智能采集 (v0.1+)

- 支持主流 AI 平台：豆包、ChatGPT、Kimi、通义千问、文心一言、Claude
- 从剪贴板或浏览器协议一键采集对话
- 自动识别对话回合，智能聚类分组
- 支持审核模式，确认后执行操作

### 🧠 自动整理 (v0.1+)

- 调用大模型 API 进行二次处理
- 5 大类自动分类：技术类、职场类、学习类、实操类、理论类
- 按标准框架输出：每个类型对应专属知识卡片模板
- 智能合并：自动判断是新建页面还是追加到现有页面

### 📚 Wiki 三层架构 (v0.1+)

- **raw/** - 原始数据层（只读）
- **wiki/** - AI 维护的知识层
- **schema/** - 人类定义的规则

### 🔍 语义检索 (v0.5+)

- 基于向量的全文语义搜索
- 支持 Page 模式和 Chunk 模式
- 多供应商支持：OpenAI / 智谱 / 阿里云通义
- 增量同步，自动更新索引

### 💬 RAG 问答 (v0.5+)

- 基于知识库的对话式问答
- 流式输出，实时响应
- 自动引用来源，标注参考页面
- 会话管理，支持导出为笔记

### 🧩 智能复习 (v0.6+)

- 间隔重复算法（SM-2 / FSRS-4.5）
- 多场景支持：
  - **Wiki 复习** - 基于知识库生成复习卡片
  - **命令记忆** - Linux / Git / Docker 命令速记
  - **概念定义** - 核心概念的精准定义复习
- 智能生成：AI 自动从 Wiki 页面提取知识点

### 📝 单词记忆 (v0.6+)

- 内置主流词库：CET-4 / CET-6 / 考研 / IELTS / TOEFL / GRE
- 支持自定义导入
- 多种复习模式：中文→英文 / 英文→中文 / 拼写模式

### 🌐 多语言短语 (v0.6+)

- 日语 / 韩语 / 西班牙语 / 法语 / 德语等
- 支持罗马音 / 拼音标注
- 分类整理：日常问候、商务用语、旅游用语等

### 💼 面试助手 (v0.6+)

- JD 智能解析：提取技能要求和关键词
- 知识盘点：对比 JD 与现有 Wiki，分析差距
- 模拟面试：AI 生成问题，评估回答质量

### 🎨 自定义场景 (v0.6+)

- 创建你自己的复习卡片模板
- 预设模板：古诗词记忆、电影台词、代码片段、数学公式
- 支持 AI 辅助生成

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

| 操作 | 命令 | 快捷方式 |
|------|------|---------|
| 采集对话 | `mindos-collect` | 侧边栏按钮 |
| 打开任务中心 | `mindos-open-center` | 侧边栏按钮 |
| 语义检索 | `mindos-open-search` | 命令面板 |
| RAG 问答 | `mindos-open-chat` | 命令面板 |
| 打开复习 | `mindos-open-recall` | 命令面板 |
| 重建索引 | `mindos-rebuild-index` | 命令面板 |

---

## 项目结构

```
src/
├── core/           # 核心模块（类型、状态、工具）
├── modules/
│   ├── pipeline/   # 工作流引擎（采集→整理）
│   ├── wiki/       # Wiki 管理
│   ├── retrieve/   # 语义检索与 RAG
│   └── recall/     # 智能复习系统
└── ui/            # UI 组件
```

详细架构说明请参阅 [PROJECT_DOC.md](PROJECT_DOC.md)。

---

## 更新日志

### v0.6.5 (当前版本)

- 卡片管理面板优化
- 复习会话进度跟踪
- 快捷键支持

### v0.6

- 智能复习系统（SRS 间隔重复）
- 面试助手（JD 解析 + 模拟面试）
- 单词记忆与多语言短语
- 自定义场景

### v0.5

- 语义检索（向量搜索）
- RAG 问答
- 会话管理与导出

### v0.1

- 基础采集与整理
- Wiki 三层架构

---

## 技术栈

| 技术 | 用途 |
|------|------|
| TypeScript | 开发语言 |
| Obsidian API | 插件框架 |
| esbuild | 构建工具 |
| SM-2 / FSRS | 间隔重复算法 |

---

## 许可证

MIT License
