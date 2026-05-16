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