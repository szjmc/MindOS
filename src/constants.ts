export const VIEW_TYPE_AI_TASK_CENTER = "ai-task-center-view";
export const PLUGIN_VERSION = "0.4.0";

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

export const FILE_INDEX = "wiki/INDEX.md";
export const FILE_CLAUDE = "schema/CLAUDE.md";
export const FILE_CONVENTIONS = "schema/conventions.md";

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