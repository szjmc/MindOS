import type { CustomScenario } from "./types";

export const VIEW_TYPE_MINDOS = "mindos-view";
export const PLUGIN_VERSION = "0.6.0";
export const PLUGIN_NAME = "MindOS";
export const PLUGIN_SLOGAN = "Your Second Brain, OS-Level";
export const PROTOCOL_NAME = "mindos";

// 目录结构
export const DIR_RAW = "raw";
export const DIR_RAW_CONVERSATIONS = "raw/conversations";
export const DIR_WIKI = "wiki";
export const DIR_WIKI_ENTITIES = "wiki/entities";
export const DIR_WIKI_CONCEPTS = "wiki/concepts";
export const DIR_WIKI_TOPICS = "wiki/topics";
export const DIR_WIKI_COMPARISONS = "wiki/comparisons";
export const DIR_WIKI_OVERVIEWS = "wiki/overviews";
export const DIR_SCHEMA = "schema";
export const DIR_SCHEMA_TEMPLATES = "schema/page-templates";
export const DIR_SCHEMA_WORKFLOWS = "schema/workflows";

// _system 目录（v0.5）
export const DIR_SYSTEM = "_system";
export const DIR_SYSTEM_CHAT_SESSIONS = "_system/chat-sessions";

export const FILE_INDEX = "wiki/INDEX.md";
export const FILE_CLAUDE = "schema/CLAUDE.md";
export const FILE_CONVENTIONS = "schema/conventions.md";

// v0.5 系统文件
export const FILE_VECTORS = "_system/vectors.json";
export const FILE_QUOTA = "_system/quota.json";
export const FILE_RETRIEVE_CONFIG = "_system/retrieve-config.json";

// v0.6 Recall 路径
export const DIR_RECALL = "_system/recall";
export const DIR_RECALL_CARDS = "_system/recall/cards";
export const DIR_RECALL_SESSIONS = "_system/recall/sessions";
export const DIR_RECALL_STATS = "_system/recall/stats";

// 页面类型显示
export const PAGE_TYPE_LABELS: Record<string, string> = {
  entity: "👤 实体",
  concept: "💡 概念",
  topic: "📚 主题",
  comparison: "⚖️ 对比",
  overview: "🗂️ 概述",
};

export const PAGE_TYPE_DIRS: Record<string, string> = {
  entity: DIR_WIKI_ENTITIES,
  concept: DIR_WIKI_CONCEPTS,
  topic: DIR_WIKI_TOPICS,
  comparison: DIR_WIKI_COMPARISONS,
  overview: DIR_WIKI_OVERVIEWS,
};

// v0.5 Tab 配置（v0.6 新增 recall）
export const TAB_LABELS: Record<string, { label: string; icon: string }> = {
  capture: { label: "采集", icon: "clipboard-paste" },
  search:  { label: "检索", icon: "search" },
  chat:    { label: "问答", icon: "message-square" },
  recall:  { label: "复习", icon: "brain" },
};

// v0.5 默认成本（人民币）
export const DEFAULT_COST_EMBEDDING_CNY_PER_MILLION = 0.15;
export const DEFAULT_COST_CHAT_CNY_PER_MILLION = 1.0;

// v0.5 推荐 Embedding 模型
export const RECOMMENDED_EMBEDDING_MODELS = [
  { name: "text-embedding-3-small", provider: "openai", dim: 1536, costPerMillion: 0.15, desc: "OpenAI 推荐" },
  { name: "text-embedding-3-large", provider: "openai", dim: 3072, costPerMillion: 1.0,  desc: "OpenAI 高质量" },
  { name: "embedding-3",            provider: "zhipu",  dim: 2048, costPerMillion: 0.5,  desc: "智谱" },
  { name: "text-embedding-v3",      provider: "aliyun", dim: 1024, costPerMillion: 0.7,  desc: "阿里通义（推荐）" },
];

// v0.6 场景配置
export const RECALL_SCENARIO_META: Record<string, {
  label: string;
  icon: string;
  description: string;
}> = {
  wiki:      { label: "Wiki 复习",  icon: "book-open",   description: "基于你的知识库生成复习卡片" },
  command:   { label: "命令行",     icon: "terminal",    description: "Linux/Git/Docker 等命令速记" },
  vocab:     { label: "英语单词",   icon: "type",        description: "内置主流词库，支持自定义导入" },
  interview: { label: "面试助手",   icon: "briefcase",   description: "JD 解析 + 知识盘点 + 模拟题" },
  concept:   { label: "概念定义",   icon: "lightbulb",   description: "核心概念的精准定义复习" },
  phrase:    { label: "多语言",     icon: "globe",       description: "日语/韩语/西语等短语记忆" },
  custom:    { label: "自定义",     icon: "settings-2",  description: "创建你自己的复习场景" },
};

// v0.6 SRS 默认参数
export const SM2_DEFAULT_EASE_FACTOR = 2.5;
export const SM2_MIN_EASE_FACTOR = 1.3;
export const SM2_EASY_BONUS = 1.3;

export const FSRS_DEFAULT_PARAMS = {
  w: [
    0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589,
    1.5330, 0.1544, 1.0070, 1.9395, 0.1100, 0.2900, 2.2700, 0.2500,
    2.9898, 0.5100, 0.4300,
  ],
  requestRetention: 0.9,
  maximumInterval: 36500,
};

export const RECALL_DEFAULT_NEW_CARDS_PER_DAY = 20;
export const RECALL_DEFAULT_REVIEW_LIMIT = 100;

// ═══════════════════════════════════════════════════════════
// v0.6 单词场景常量
// ═══════════════════════════════════════════════════════════

export const DIR_RECALL_WORDLISTS = "_system/recall/wordlists";

export const VOCAB_REVIEW_MODE_LABELS: Record<string, string> = {
  cn_to_en: "🇨🇳 中文 → 英文",
  en_to_cn: "🇬🇧 英文 → 中文",
  spell:    "✏️ 听音/看义拼写",
  mixed:    "🔀 混合模式",
};

// 内置词库元数据（实际词条按需加载）
export const BUILTIN_WORDLISTS: Array<{
  id: string;
  name: string;
  level: string;
  cover: string;
  description: string;
  totalWords: number;
}> = [
  {
    id: "cet4",
    name: "大学英语四级 CET-4",
    level: "CET4",
    cover: "📘",
    description: "大学英语四级核心词汇约 4500 词",
    totalWords: 4500,
  },
  {
    id: "cet6",
    name: "大学英语六级 CET-6",
    level: "CET6",
    cover: "📗",
    description: "大学英语六级核心词汇约 6000 词",
    totalWords: 6000,
  },
  {
    id: "kaoyan",
    name: "考研英语",
    level: "考研",
    cover: "📕",
    description: "考研英语大纲词汇约 5500 词",
    totalWords: 5500,
  },
  {
    id: "ielts",
    name: "雅思 IELTS",
    level: "IELTS",
    cover: "🎓",
    description: "雅思核心词汇约 7000 词",
    totalWords: 7000,
  },
  {
    id: "toefl",
    name: "托福 TOEFL",
    level: "TOEFL",
    cover: "🌎",
    description: "托福核心词汇约 8000 词",
    totalWords: 8000,
  },
  {
    id: "gre",
    name: "GRE",
    level: "GRE",
    cover: "🎯",
    description: "GRE 核心词汇约 8000 词",
    totalWords: 8000,
  },
];

// 默认每日新词数
export const VOCAB_DEFAULT_NEW_PER_DAY = 10;

// ═══════════════════════════════════════════════════════════
// v0.6 多语言场景常量
// ═══════════════════════════════════════════════════════════

export const SUPPORTED_LANGUAGES: Array<{
  code: string;
  name: string;
  flag: string;
  romanizationLabel: string;
}> = [
  { code: "ja",     name: "日语",     flag: "🇯🇵", romanizationLabel: "罗马音" },
  { code: "ko",     name: "韩语",     flag: "🇰🇷", romanizationLabel: "罗马字" },
  { code: "es",     name: "西班牙语", flag: "🇪🇸", romanizationLabel: "音标" },
  { code: "fr",     name: "法语",     flag: "🇫🇷", romanizationLabel: "音标" },
  { code: "de",     name: "德语",     flag: "🇩🇪", romanizationLabel: "音标" },
  { code: "it",     name: "意大利语", flag: "🇮🇹", romanizationLabel: "音标" },
  { code: "ru",     name: "俄语",     flag: "🇷🇺", romanizationLabel: "音标" },
  { code: "pt",     name: "葡萄牙语", flag: "🇵🇹", romanizationLabel: "音标" },
  { code: "ar",     name: "阿拉伯语", flag: "🇸🇦", romanizationLabel: "音标" },
  { code: "zh",     name: "中文",     flag: "🇨🇳", romanizationLabel: "拼音" },
  { code: "en",     name: "英语",     flag: "🇬🇧", romanizationLabel: "音标" },
  { code: "custom", name: "自定义",   flag: "🌐", romanizationLabel: "发音" },
];

export const PHRASE_DEFAULT_CATEGORIES = [
  "日常问候",
  "商务用语",
  "旅游用语",
  "情景对话",
  "习惯表达",
  "语法句型",
  "其他",
];

// ═══════════════════════════════════════════════════════════
// v0.6 面试助手常量
// ═══════════════════════════════════════════════════════════

export const DIR_RECALL_INTERVIEW = "_system/recall/interview";

export const SKILL_LEVEL_LABELS: Record<string, string> = {
  basic:        "🌱 基础",
  intermediate: "🌿 熟练",
  advanced:     "🌲 精通",
  expert:       "⭐ 专家",
};

export const SKILL_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  mastered: { label: "已掌握", color: "success" },
  partial:  { label: "部分掌握", color: "warning" },
  missing:  { label: "缺失",   color: "danger" },
};

export const INTERVIEW_QUESTION_CATEGORIES = [
  "技术深度",
  "项目经验",
  "系统设计",
  "算法题",
  "行为面试",
  "公司&动机",
  "反向提问",
];

// ═══════════════════════════════════════════════════════════
// v0.6 自定义场景常量
// ═══════════════════════════════════════════════════════════

export const FILE_CUSTOM_SCENARIOS = "_system/recall/custom-scenarios.json";

export const CUSTOM_FIELD_TYPE_LABELS: Record<string, string> = {
  text:     "📝 单行文本",
  textarea: "📄 多行文本",
  markdown: "✏️ Markdown",
  tags:     "🏷 标签列表",
  select:   "📋 下拉选择",
  number:   "🔢 数字",
};

// 场景模板预设（用户可一键创建）
export const CUSTOM_SCENARIO_TEMPLATES: Array<Partial<CustomScenario> & {
  presetKey: string;
}> = [
  {
    presetKey: "poetry",
    name: "古诗词记忆",
    description: "记忆古诗词上下句、赏析与作者",
    cover: "📜",
    fields: [
      { key: "title", label: "诗名", type: "text", required: true },
      { key: "author", label: "作者", type: "text", placeholder: "如：李白" },
      { key: "upperLine", label: "上句", type: "text", required: true, placeholder: "床前明月光" },
      { key: "lowerLine", label: "下句", type: "text", required: true, placeholder: "疑是地上霜" },
      { key: "appreciation", label: "赏析", type: "textarea", placeholder: "意境/手法/情感" },
    ],
    frontTemplate: "**「{{upperLine}}」**\n\n— {{title}} · {{author}}",
    backTemplate: "**{{upperLine}}**\n**{{lowerLine}}**\n\n*— {{author}}《{{title}}》*\n\n{{appreciation}}",
    hintsTemplate: "首字：{{lowerLine.slice(0,1)}}",
    aiEnabled: false,
    tags: ["古诗", "文学"],
  },
  {
    presetKey: "movie_quote",
    name: "电影台词",
    description: "记忆经典电影场景与台词",
    cover: "🎬",
    fields: [
      { key: "movie", label: "电影名", type: "text", required: true },
      { key: "scene", label: "场景描述", type: "textarea", required: true, placeholder: "在哪个场景说的" },
      { key: "quote", label: "台词", type: "textarea", required: true },
      { key: "character", label: "角色", type: "text" },
      { key: "year", label: "年份", type: "number" },
    ],
    frontTemplate: "**🎬 {{movie}}**（{{year}}）\n\n场景：{{scene}}",
    backTemplate: "**「{{quote}}」**\n\n— {{character}} · 《{{movie}}》（{{year}}）",
    aiEnabled: false,
    tags: ["电影", "台词"],
  },
  {
    presetKey: "code_snippet",
    name: "代码片段",
    description: "需求 → 实现的代码记忆",
    cover: "💻",
    fields: [
      { key: "task", label: "需求描述", type: "textarea", required: true },
      { key: "language", label: "语言", type: "select",
        options: ["JavaScript", "TypeScript", "Python", "Go", "Rust", "Java", "其他"], required: true },
      { key: "code", label: "代码实现", type: "markdown", required: true },
      { key: "explanation", label: "实现思路", type: "textarea" },
    ],
    frontTemplate: "**{{task}}**\n\n语言：{{language}}",
    backTemplate: "{{code}}\n\n**思路：** {{explanation}}",
    aiEnabled: true,
    aiSystemPrompt: "你是编程专家。根据需求生成代码片段。输出 JSON: {\"task\": \"\", \"language\": \"\", \"code\": \"```\\n代码\\n```\", \"explanation\": \"\"}",
    aiUserPromptTemplate: "请生成代码片段：{{topic}}",
    tags: ["编程", "代码"],
  },
  {
    presetKey: "math_formula",
    name: "数学公式",
    description: "公式记忆与应用场景",
    cover: "🔢",
    fields: [
      { key: "name", label: "公式名", type: "text", required: true },
      { key: "formula", label: "公式", type: "text", required: true, placeholder: "如：a² + b² = c²" },
      { key: "scenario", label: "应用场景", type: "textarea", required: true },
      { key: "derivation", label: "推导（可选）", type: "markdown" },
    ],
    frontTemplate: "**何时使用「{{name}}」？**\n\n{{scenario}}",
    backTemplate: "## {{name}}\n\n**公式：** `{{formula}}`\n\n**应用场景：** {{scenario}}\n\n{{derivation}}",
    aiEnabled: false,
    tags: ["数学", "公式"],
  },
];