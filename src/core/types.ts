export type ProtocolValue = string | string[] | undefined;
export type MaturityStatus = "🌱seedling" | "🌿budding" | "🌲evergreen";
export type TaskStatus = "idle" | "running" | "awaiting_review" | "done" | "error";
export type PageType = "entity" | "concept" | "topic" | "comparison" | "overview";
export type ActionOp = "create" | "update" | "append_section" | "link";
export type ActionStatus = "pending" | "approved" | "rejected" | "executed" | "failed";

export type PipelineStage = "cluster" | "draft" | "diff" | "execute";
export type StageStatus = "pending" | "running" | "done" | "failed";

// ═══════════════════════════════════════════════════════════
// v0.5 Retrieve 类型
// ═══════════════════════════════════════════════════════════

export type EmbeddingProvider = "openai" | "zhipu" | "aliyun" | "custom";
export type RetrieveTab = "capture" | "search" | "chat" | "recall"; // v0.6 新增 recall
export type AnalysisTab = "context" | "gaps" | "evolution" | "backlink"; // v0.8 智能分析
export type ExpressSearchMode = 'vector' | 'keyword' | 'none';
export type VectorizeStatus = "idle" | "running" | "done" | "error";

export interface ChunkMeta {
  id: string;
  path: string;
  fileTitle: string;
  fileType: PageType | "raw";
  section: string;
  sectionIndex: number;
  text: string;
  hash: string;
  vector: number[];
  vectorDim: number;
  model: string;
  tokens: number;
  fileMtime: number;
  createdAt: string;
}

export interface VectorIndex {
  version: number;
  model: string;
  vectorDim: number;
  totalChunks: number;
  totalPages: number;
  createdAt: string;
  updatedAt: string;
  chunks: ChunkMeta[];
}

export interface SearchResult {
  chunk: ChunkMeta;
  score: number;
}

export interface PageSearchResult {
  path: string;
  fileTitle: string;
  fileType: PageType | "raw";
  topScore: number;
  matchedChunks: SearchResult[];
  bestPreview: string;
}

export interface VectorizeProgress {
  status: VectorizeStatus;
  total: number;
  done: number;
  currentFile: string;
  errors: string[];
  startedAt?: string;
  finishedAt?: string;
  estimatedTokens: number;
  actualTokens: number;
}

export interface QuotaState {
  dailyLimitTokens: number;
  todayUsedTokens: number;
  todayUsedCostCny: number;
  history: Array<{ date: string; tokens: number; costCny: number }>;
  lastResetDate: string;
}

export interface ChatCitation {
  path: string;
  fileTitle: string;
  section: string;
  preview: string;
  score: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: ChatCitation[];
  createdAt: string;
  tokens?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface RetrieveState {
  currentTab: RetrieveTab;
  searchQuery: string;
  searchMode: SearchMode;
  searchResults: PageSearchResult[];
  isSearching: boolean;
  searchError: string;
  vectorizeProgress: VectorizeProgress;
  quota: QuotaState;
  currentSessionId: string;
  sessions: ChatSession[];
  isChatting: boolean;
  chatStreamingContent: string;
  chatError: string;
}

// ═══════════════════════════════════════════════════════════
// 既有类型
// ═══════════════════════════════════════════════════════════

export interface PromptPayload {
  source: string;
  content: string;
  title?: string;
  pageTitle?: string;
  url?: string;
  collectedAt?: string;
}

export interface ConversationRound {
  round: number;
  user: string;
  ai: string;
  hash: string;
  raw: string;
  rawPath?: string;
  anchor?: string;
}

export interface WikiPageMeta {
  path: string;
  type: PageType;
  title: string;
  brief: string;
  tags: string[];
  status: MaturityStatus;
  mtime?: number;
}

export interface RoundCluster {
  id: string;
  rounds: number[];
  topic: string;
  reason: string;
}

export interface DraftBlock {
  heading: string;
  content: string;
  sourceRounds: number[];
}

export interface DraftDoc {
  clusterId: string;
  title: string;
  brief: string;
  pageType: PageType;
  tags: string[];
  blocks: DraftBlock[];
  sourceRounds: number[];
}

export interface CandidatePage {
  meta: WikiPageMeta;
  score: number;
  reason: string;
}

export type DiffDecisionType = "merge" | "create" | "discard";

export interface DiffDecision {
  type: DiffDecisionType;
  targetPath?: string;
  newBlocks?: DraftBlock[];
  reason: string;
  draft: DraftDoc;
}

export interface WikiAction {
  id: string;
  op: ActionOp;
  pageType: PageType;
  path: string;
  title: string;
  brief: string;
  summary?: string;       // ✅ 新增：详细描述（比 brief 更长）
  category?: string;      // ✅ 新增：顶级分类
  cover?: string;         // ✅ 新增：封面 emoji
  aliases?: string[];     // ✅ 新增：别名列表
  tags: string[];
  content: string;
  blocks?: DraftBlock[];
  section?: string;
  links: string[];
  reason: string;
  status: ActionStatus;
  error?: string;
  sourceRounds?: number[];
  sourceDisplayNames?: string[];  // ✅ 新增：来源显示名（用于 references frontmatter）
}

export interface RoundProcessResult {
  round: number;
  rawFilePath: string;
  actions: WikiAction[];
  summary: string;
  error?: string;
}

export interface PipelineStageInfo {
  status: StageStatus;
  detail: string;
}

export interface PipelineState {
  active: boolean;
  currentStage: PipelineStage;
  stages: Record<PipelineStage, PipelineStageInfo>;
  clusters: RoundCluster[];
  drafts: DraftDoc[];
  decisions: DiffDecision[];
}

export interface TaskState {
  status: TaskStatus;
  step: string;
  detail: string;
  error: string;
  logs: string[];
  results: RoundProcessResult[];
  totalRounds: number;
  doneRounds: number;
  pendingActions: WikiAction[];
  failedRounds: Array<{ round: ConversationRound; payload: PromptPayload }>;
  pipeline: PipelineState;
}

export interface UICollapsedState {
  quickStart: boolean;
  wikiStatus: boolean;
  schemaStatus: boolean;
  logs: boolean;
  results: boolean;
  pipeline: boolean;
}

// ═══════════════════════════════════════════════════════════
// 设置
// ═══════════════════════════════════════════════════════════

export interface MindOSSettings {
  baseFolder: string;
  openAfterSave: boolean;
  defaultMaturity: MaturityStatus;

  apiBaseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;

  injectClaudeMd: boolean;
  injectIndexMd: boolean;
  reviewMode: boolean;
  indexAutoRebuildAfterN: number;
  briefMaxLength: number;

  uiCollapsed: UICollapsedState;
  candidateTopN: number;
  currentTab: RetrieveTab;

  // v0.5 Embedding
  embeddingProvider: EmbeddingProvider;
  embeddingApiBaseUrl: string;
  embeddingApiKey: string;
  embeddingModel: string;
  embeddingDim: number;
  embeddingBatchSize: number;
  embeddingChunkMaxChars: number;
  embeddingChunkMinChars: number;

  // v0.5 Auto Vectorize
  autoVectorize: boolean;
  autoVectorizeThreshold: number;

  // v0.5 Search
  searchTopK: number;
  searchMinScore: number;

  // v0.5 RAG
  ragEnabled: boolean;
  ragTopK: number;
  ragTemperature: number;
  ragMaxContextTokens: number;
  ragStreaming: boolean;

  // v0.5 Quota
  dailyTokenLimit: number;
  warnOnHighCost: boolean;
  costPerMillionTokensEmbedding: number;
  costPerMillionTokensChat: number;

  // v0.5 Export
  chatExportFolder: string;
  chatExportCustomPath: string;

  // v0.6 Recall
  recallSRSAlgorithm: "sm2" | "fsrs";
  recallNewCardsPerDay: number;
  recallReviewLimit: number;
  recallAutoGenerate: boolean;

    // v0.7 Express
  expressExportFolder?: string; 

    // v0.7 Recall TTS
  recallTTSEnabled?: boolean;
  recallTTSLang?: string;            // e.g. "en-US"
  recallTTSRate?: number;            // 0.5-2
  recallTTSPitch?: number;           // 0-2
  recallTTSVolume?: number;          // 0-1
  recallTTSPreferredVoice?: string;  // SpeechSynthesisVoice.name
    // v0.7 Recall Vocab TTS Hotkey（自定义快捷键）
  recallVocabTTSHotkey?: string;     // e.g. "Shift+Space"
  recallVocabTTSHotkeyAlt?: string;  // e.g. "Alt+S"
    // ✅ 新增
  recallVocabAutoSpeak?: boolean;  // 翻到新词自动朗读一次
  recallVocabSpellMode?: boolean;  // 拼写模式（先读音→输入→揭示）

  // v0.8 Version History
  versionHistoryEnabled?: boolean;
  versionMaxCount?: number;

  // v0.8 Health Report
  healthCheckEnabled?: boolean;
  healthCheckIntervalDays?: number;

  // v0.8 Connect
  backlinkEnabled?: boolean;
  backlinkAiSummaryEnabled?: boolean;
  backlinkImplicitThreshold?: number;

  // v0.9 Deep Connect
  autoLinkScanInterval?: number;      // 自动链接扫描间隔（分钟）
  contradictionDetectionEnabled?: boolean;
  contradictionScanInterval?: number; // 矛盾检测扫描间隔（小时）

  // v1.0 Smart Extract
  summaryGenerationEnabled?: boolean;     // 是否启用总结生成
  questionGenerationEnabled?: boolean;    // 是否启用问题生成
  maxQuestionsPerPage?: number;           // 每页最大问题数
}

// ═══════════════════════════════════════════════════════════
// v1.0 智能萃取
// ═══════════════════════════════════════════════════════════

export type SummaryLevel = 1 | 2 | 3;

export interface PageSummary {
  sourcePath: string;
  level1: string;  // 一句话总结
  level2: string;  // 简短摘要（3-5句话）
  level3: string;  // 详细摘要（完整要点）
  wordCount: number;
  generatedAt: string;
  updatedAt?: string;
}

export interface GeneratedQuestion {
  id: string;
  sourcePath: string;
  question: string;
  answer: string;
  difficulty: 'easy' | 'medium' | 'hard';
  qualityScore: number;
  hint?: string;
  createdAt: string;
  srsData?: SRSData;
  reviewedCount: number;
  correctCount: number;
}

export interface QuestionGenerationConfig {
  enabled: boolean;
  maxQuestionsPerPage: number;
  difficultyDistribution: { easy: number; medium: number; hard: number };
  autoGenerate: boolean;
  generationIntervalHours: number;
}

// ═══════════════════════════════════════════════════════════
// v0.6 Recall 类型
// ═══════════════════════════════════════════════════════════

export type RecallScenario =
  | "wiki"
  | "command"
  | "vocab"
  | "interview"
  | "concept"
  | "phrase"
  | "custom";

export type RecallCardStatus =
  | "new"
  | "learning"
  | "review"
  | "mastered"
  | "suspended";

export type SRSAlgorithm = "sm2" | "fsrs";

export type RecallRating = 1 | 2 | 3 | 4;

export interface SRSData {
  algorithm: SRSAlgorithm;
  interval: number;
  repetitions: number;
  easeFactor: number;
  stability: number;
  difficulty: number;
  nextReview: string;
  lastReview: string;
  lastRating: RecallRating | 0;
}

export interface RecallCardStats {
  totalReviews: number;
  correctCount: number;
  wrongCount: number;
  avgResponseTimeMs: number;
  streak: number;
}

export interface RecallCard {
  id: string;
  scenario: RecallScenario;
  front: string;
  back: string;
  hints?: string[];
  examples?: string[];
  metadata?: Record<string, any>;
  sourcePath?: string;
  sourceSection?: string;
  srs: SRSData;
  stats: RecallCardStats;
  tags: string[];
  status: RecallCardStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RecallSession {
  id: string;
  scenario: RecallScenario;
  startedAt: string;
  finishedAt?: string;
  cardIds: string[];
  results: RecallSessionResult[];
  totalCards: number;
  doneCards: number;
  correctCards: number;
}

export interface RecallSessionResult {
  cardId: string;
  rating: RecallRating;
  responseTimeMs: number;
  reviewedAt: string;
}

export interface RecallDailyStats {
  date: string;
  totalReviewed: number;
  correctCount: number;
  newCards: number;
  timeSpentMs: number;
  byScenario: Record<RecallScenario, number>;
}

export interface RecallState {
  currentSession: RecallSession | null;
  currentCard: RecallCard | null;
  currentCardIndex: number;
  isFlipped: boolean;
  isGenerating: boolean;
  generateError: string;
  todayStats: RecallDailyStats | null;
  selectedScenario: RecallScenario;
  scenarioConfig: RecallScenarioConfig;

  // ✅ v0.6 新增：管理界面状态
  viewMode: RecallView_Mode;            // 当前显示哪个界面
  managerScenario: RecallScenario;      // 管理面板正在管理哪个场景
  managerFilter: CardManagerFilter;
  managerCards: RecallCard[];           // 当前过滤后的卡片
  managerSelectedIds: Set<string>;      // 多选 ID 集合
}

export interface RecallScenarioConfig {
  scenario: RecallScenario;
  label: string;
  icon: string;
  description: string;
  cardCount: number;
  newCardCount: number;
  totalCards: number;
}

export interface WikiCardMeta {
  pageType: PageType;
  wikiPath: string;
  section: string;
}

export interface InterviewCardMeta {
  company?: string;
  position?: string;
  difficulty: "easy" | "medium" | "hard";
  category: string;
}

export interface VocabCardMeta {
  word: string;
  phonetic?: string;
  wordList: string;
  partOfSpeech: string;
  difficulty: number;
}
// ═══════════════════════════════════════════════════════════
// v0.6 卡片管理界面状态
// ═══════════════════════════════════════════════════════════

export type RecallView_Mode = "scenario_home" | "card_manager" | "review";

export interface CardManagerFilter {
  searchQuery: string;
  statusFilter: "all" | "new" | "learning" | "review" | "mastered" | "suspended";
  tagFilter: string;
  sortBy: "updated_desc" | "created_desc" | "next_review" | "alpha";
}

// 扩展 RecallState（修改原接口）

// ═══════════════════════════════════════════════════════════
// v0.6 英语单词场景类型
// ═══════════════════════════════════════════════════════════

export type WordListSource = "builtin" | "custom" | "imported";
export type VocabReviewMode = "cn_to_en" | "en_to_cn" | "spell" | "mixed";

export interface WordEntry {
  word: string;                    // 单词本身
  phonetic?: string;               // 音标（如 [ˈæpl]）
  partOfSpeech?: string;           // 词性（n. v. adj. adv.）
  definitions: string[];           // 中文释义（可多个）
  englishDef?: string;             // 英文释义
  examples?: Array<{
    en: string;
    cn?: string;
  }>;
  synonyms?: string[];             // 同义词
  antonyms?: string[];             // 反义词
  difficulty?: number;             // 1-5 难度等级
  frequency?: number;              // 词频排名（越小越常用）
  tags?: string[];                 // 主题标签（如 "学术"、"商务"）
}

export interface WordList {
  id: string;                      // 词库唯一标识（如 "cet4"、"custom_my_words"）
  name: string;                    // 显示名（如 "大学英语四级"）
  description?: string;            // 描述
  source: WordListSource;
  level?: string;                  // CET4 / CET6 / 考研 / IELTS / TOEFL / GRE 等
  totalWords: number;
  language: "en";                  // 预留：未来支持多语言
  cover?: string;                  // emoji 封面
  createdAt: string;
  updatedAt: string;
  // 学习配置（用户独立设置）
  config?: WordListUserConfig;
}

export interface WordListUserConfig {
  enabled: boolean;                // 是否启用该词库
  newPerDay: number;               // 每日新词数量（默认 10）
  reviewMode: VocabReviewMode;     // 复习模式
  startIndex: number;              // 当前学到第几个（按 frequency 顺序）
  totalLearned: number;            // 已学习单词数（缓存值）
}

export interface VocabCardMetadata {
  word: string;
  phonetic?: string;
  partOfSpeech?: string;
  wordList: string;                // 所属词库 ID
  reviewMode: VocabReviewMode;     // 该卡片的复习模式
  frequency?: number;              // 词频
  // 完整词条副本（避免反查词库）
  entry?: WordEntry;
}

// 词库使用统计
export interface WordListProgress {
  wordListId: string;
  totalWords: number;
  startedWords: number;            // 已生成卡片的单词数
  masteredWords: number;
  inProgressWords: number;
  lastStudiedAt?: string;
}

// ═══════════════════════════════════════════════════════════
// v0.6 多语言短语场景类型
// ═══════════════════════════════════════════════════════════

export type SupportedLanguage =
  | "ja"      // 日语
  | "ko"      // 韩语
  | "es"      // 西班牙语
  | "fr"      // 法语
  | "de"      // 德语
  | "it"      // 意大利语
  | "ru"      // 俄语
  | "pt"      // 葡萄牙语
  | "ar"      // 阿拉伯语
  | "zh"      // 中文
  | "en"      // 英语
  | "custom"; // 自定义

export interface PhraseCardMetadata {
  language: SupportedLanguage;
  customLanguage?: string;          // 当 language=custom 时的语言名
  category?: string;                // 主题分类（如"日常问候"、"商务用语"）
  romanization?: string;            // 罗马音/拼音/IPA 等
  level?: string;                   // 难度（N5/N4/A1/A2 等）
}

export interface PhraseEntry {
  phrase: string;
  translation: string;              // 翻译
  romanization?: string;            // 发音
  category?: string;
  level?: string;
  notes?: string;                   // 语法/用法说明
  examples?: string[];              // 例句
}

// ═══════════════════════════════════════════════════════════
// v0.6 概念场景类型
// ═══════════════════════════════════════════════════════════

export interface ConceptCardMetadata {
  conceptName: string;              // 概念名（如"封装"、"递归"）
  domain?: string;                  // 领域（如"OOP"、"算法"）
  relatedConcepts?: string[];       // 关联概念
  sourcePath?: string;
}

// ═══════════════════════════════════════════════════════════
// v0.6 面试助手类型
// ═══════════════════════════════════════════════════════════

export type SkillLevel = "basic" | "intermediate" | "advanced" | "expert";
export type SkillStatus = "mastered" | "partial" | "missing";

export interface SkillRequirement {
  skill: string;                    // 技能/知识点名称
  category: string;                 // 分类（编程语言/框架/数据库/工具等）
  required: boolean;                // 是否硬性要求
  level: SkillLevel;                // 期望掌握程度
  keywords: string[];               // 提取的关键词（用于匹配 Wiki）
  // 匹配结果
  status?: SkillStatus;
  matchedPages?: string[];          // 匹配到的 Wiki 页面路径
  coverage?: number;                // 0-1，覆盖度
}

export interface InterviewQuestion {
  id: string;
  category: string;                 // 技术 / 行为 / 系统设计 等
  skill?: string;                   // 关联技能
  difficulty: "easy" | "medium" | "hard";
  question: string;
  hints?: string[];
  referenceAnswer?: string;         // 参考答案
  followUps?: string[];             // 追问问题
}

export interface JDAnalysis {
  id: string;
  // 基本信息
  company?: string;
  position: string;
  level?: string;                   // 初级/中级/高级/Senior 等
  location?: string;
  salary?: string;
  // 原始 JD
  rawText: string;
  // AI 解析结果
  description: string;              // AI 提炼的职位概述
  responsibilities: string[];       // 主要职责
  requirements: string[];           // 任职要求原文
  skills: SkillRequirement[];       // 提取的技能清单
  niceToHave: string[];             // 加分项
  // 知识盘点结果
  gapAnalysis?: {
    masteredCount: number;
    partialCount: number;
    missingCount: number;
    overallReadiness: number;       // 0-1 整体准备度
    summary: string;
  };
  // 模拟题（Part 2 生成）
  questions?: InterviewQuestion[];
  // 时间
  createdAt: string;
  updatedAt: string;
}

export interface InterviewCardMetadata {
  jdId?: string;                    // 所属的 JD 分析 ID
  jdPosition?: string;              // 职位名
  skill?: string;                   // 关联技能
  questionId?: string;              // 关联问题 ID
  category?: string;                // 技术/行为/系统设计
  difficulty?: "easy" | "medium" | "hard";
}

export interface InterviewState {
  currentJD: JDAnalysis | null;
  jdList: JDAnalysis[];
  isAnalyzing: boolean;
  analysisError: string;
  // 用于知识盘点的状态
  isGapAnalyzing: boolean;
}

// ═══════════════════════════════════════════════════════════
// v0.6 模拟面试类型
// ═══════════════════════════════════════════════════════════

export type MockInterviewMode = "self_test" | "ai_interviewer";

export interface MockInterviewState {
  jdId: string;
  questions: InterviewQuestion[];
  currentIndex: number;
  answers: MockInterviewAnswer[];
  startedAt: string;
  finishedAt?: string;
}

export interface MockInterviewAnswer {
  questionId: string;
  userAnswer: string;
  evaluation?: AnswerEvaluation;
  responseTimeMs: number;
  reviewedAt: string;
}

export interface AnswerEvaluation {
  score: number;                    // 0-100 综合得分
  strengths: string[];              // 答得好的点
  weaknesses: string[];             // 不足
  improvements: string[];           // 改进建议
  modelAnswer?: string;             // 模范答案（如果用户答案太差）
  followUpHints?: string[];         // 面试官可能的追问
}

// ═══════════════════════════════════════════════════════════
// v0.6 自定义场景类型
// ═══════════════════════════════════════════════════════════

export type CustomFieldType =
  | "text"          // 单行文本
  | "textarea"      // 多行文本
  | "markdown"      // Markdown 内容
  | "tags"          // 标签列表
  | "select"        // 下拉选择
  | "number";       // 数字

export interface CustomFieldDef {
  key: string;                      // 字段标识（英文，唯一）
  label: string;                    // 显示名
  type: CustomFieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];               // select 类型的可选项
  defaultValue?: string;
}

export interface CustomScenario {
  id: string;                       // 场景唯一 ID（如 "custom_poetry"）
  name: string;                     // 显示名（如 "古诗词记忆"）
  description?: string;
  cover?: string;                   // emoji
  // 字段定义（前 2 个会作为正面/背面默认渲染）
  fields: CustomFieldDef[];
  // 卡片渲染模板（支持 {{key}} 占位符）
  frontTemplate: string;
  backTemplate: string;
  hintsTemplate?: string;
  // AI 生成配置（可选）
  aiEnabled: boolean;
  aiSystemPrompt?: string;          // AI 出题的系统提示
  aiUserPromptTemplate?: string;    // 用户传参的提示模板
  // 元数据
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomCardMetadata {
  scenarioId: string;               // 所属自定义场景
  fieldValues: Record<string, any>; // 各字段值
}

// ═══════════════════════════════════════════════════════════
// v0.6 统计 Dashboard 类型
// ═══════════════════════════════════════════════════════════

export type DashboardPeriod = "today" | "week" | "month" | "all";

export interface DashboardOverview {
  period: DashboardPeriod;
  // 综合数据
  totalReviewed: number;          // 复习总数
  totalCorrect: number;           // 正确总数
  averageAccuracy: number;        // 平均正确率（0-1）
  totalTimeMs: number;            // 总用时（毫秒）
  totalNewCards: number;          // 新学卡片数
  totalDays: number;              // 学习天数
  // 卡片库总览
  totalCards: number;             // 卡片库总数
  cardsByStatus: Record<string, number>;
  cardsByScenario: Record<string, number>;
  // 待复习
  dueToday: number;               // 今日待复习
  newAvailable: number;           // 可用新卡片
  // 连续学习
  currentStreak: number;          // 当前连续天数
  longestStreak: number;          // 历史最长连续
  // 趋势数据
  dailyTrend: Array<{
    date: string;
    reviewed: number;
    correct: number;
    accuracy: number;
    newCards: number;
    timeMs: number;
  }>;
  // 热力图（最近 90 天）
  heatmap: Array<{
    date: string;
    count: number;
    level: 0 | 1 | 2 | 3 | 4;     // 强度等级（0=无）
  }>;
  // 场景对比
  scenarioStats: Array<{
    scenario: string;
    label: string;
    icon: string;
    totalReviewed: number;
    totalCards: number;
    masteredCount: number;
    accuracy: number;
  }>;
}

// ================================================================
// Express 输出引擎 (v0.7)
// ================================================================

export type ArticleStyle =
  | 'tech-blog'      // 技术博客
  | 'wechat'         // 公众号软文
  | 'zhihu'          // 知乎答题
  | 'abstract'       // 论文摘要
  | 'tutorial'       // 教程手册
  | 'newsletter'     // 邮件周报
  | 'linkedin'       // LinkedIn 文章
  | 'documentation'  // 技术文档
  | 'casual'         // 轻松随笔
  | 'summary';       // 内容总结

export type ArticleStatus =
  | 'outline'        // 大纲阶段（等待用户确认）
  | 'generating'     // 正文生成中
  | 'draft'          // 草稿完成
  | 'exported';      // 已导出到 Wiki

export type SearchMode = "page" | "chunk";

export interface OutlineSection {
  id: string;
  level: number;          // 1 = H2, 2 = H3
  title: string;
  keyPoints: string[];    // 该节核心要点
  estimatedWords: number; // 预期字数
}

export interface ArticleOutline {
  title: string;
  oneLiner: string;            // 一句话摘要
  style: ArticleStyle;
  targetAudience: string;      // 目标读者
  sections: OutlineSection[];
  totalEstimatedWords: number;
  sourcePages: string[];       // 引用的 Wiki 页面路径
  searchMode: ExpressSearchMode;      // 本次检索使用的模式
}

export interface ArticleDraft {
  id: string;
  topic: string;
  style: ArticleStyle;
  outline: ArticleOutline | null;
  content: string;             // 生成的正文 Markdown
  status: ArticleStatus;
  createdAt: number;
  updatedAt: number;
  exportedPath?: string;       // 导出后的 Wiki 路径
  sourcePages: string[];       // 引用来源
  tags: string[];
  wordCount: number;           // 实际字数
}

export interface ExpressGenerateOptions {
  topic: string;
  style: ArticleStyle;
  lengthHint: 'short' | 'medium' | 'long'; // 短文/<1000 / 中文/1000-2000 / 长文/>2000
  extraInstruction?: string;               // 补充说明
  useWikiContext: boolean;                  // 是否检索 Wiki 作为上下文
}

export interface ExpressState {
  drafts: ArticleDraft[];
  currentDraftId: string | null;
  isGeneratingOutline: boolean;
  isGeneratingContent: boolean;
  outlineAbortController: AbortController | null;
  contentAbortController: AbortController | null;
  error: string | null;
}

// ═══════════════════════════════════════════════════════════
// v0.8 版本历史记录
// ═══════════════════════════════════════════════════════════

export interface PageVersion {
  id: string;
  pagePath: string;
  content: string;
  wordCount: number;
  timestamp: string;
  hash: string;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: { old: number; new: number };
}

export interface DiffResult {
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

// ═══════════════════════════════════════════════════════════
// v0.8 知识库健康度报告
// ═══════════════════════════════════════════════════════════

export interface HealthMetrics {
  totalPages: number;
  totalWords: number;
  orphanPages: number;
  stubPages: number;
  averageWordCount: number;
  averageLinksPerPage: number;
  maturityDistribution: Record<string, number>;
  freshnessDistribution: { recent: number; moderate: number; stale: number };
  topLinkedPages: { path: string; links: number }[];
}

export interface HealthReport {
  generatedAt: string;
  metrics: HealthMetrics;
  healthScore: number;
  recommendations: string[];
}

// ================================================================
// v0.8 Connect 反向链接增强
// ================================================================

export interface ExplicitBacklink {
  sourcePath: string;
  targetPath: string;
  context: string;
  anchorPosition: number;
  aiSummary?: string;
}

export interface ImplicitBacklink {
  sourcePath: string;
  targetPath: string;
  similarityScore: number;
  reason: string;
  isIgnored: boolean;
  ignoredAt?: string;
}

export interface BacklinkResult {
  targetPath: string;
  explicitBacklinks: ExplicitBacklink[];
  implicitBacklinks: ImplicitBacklink[];
  lastUpdated: string;
}

export interface LinkSuggestion {
  targetPath: string;
  displayText: string;
  targetPosition: number;
  reason: string;
  confidence: number;
  isIgnored: boolean;
  ignoredAt?: string;
}

// ═══════════════════════════════════════════════════════════
// v0.9 深度关联
// ═══════════════════════════════════════════════════════════

export interface AutoLinkSuggestion {
  sourcePath: string;
  targetTitle: string;
  confidence: number;
  context: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ContradictionEvidence {
  sentence: string;
  sourcePath: string;
  confidence: number;
}

export interface ContradictionPair {
  id: string;
  evidence1: ContradictionEvidence;
  evidence2: ContradictionEvidence;
  conflictType: 'direct' | 'implied' | 'ambiguous';
  severity: 'high' | 'medium' | 'low';
  similarityScore: number;
  explanation?: string;
  suggestion?: string;
  resolved?: boolean;
  resolvedAt?: number;
}

export interface ContradictionReport {
  generatedAt: string;
  totalConflicts: number;
  conflicts: ContradictionPair[];
  bySeverity: { high: number; medium: number; low: number };
}

// ================================================================
// v0.9 知识质量分析
// ================================================================

export interface NoteMetrics {
  path: string;
  title: string;
  wordCount: number;
  lastModified: Date;
  headings: {
    level: number;
    text: string;
  }[];
  outgoingLinks: number;
  incomingLinks: number;
  mediaCount: number;
  codeBlockCount: number;
  listCount: number;
  quoteCount: number;
  tableCount: number;
}

export interface QualityDimension {
  name: string;
  value: number;
  maxValue: number;
  score: number;
  label: string;
  level: 'excellent' | 'good' | 'needs-improvement' | 'to-add';
}

export interface QualitySuggestion {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  actionable: boolean;
  targetPaths: string[];
  estimatedImpact: string;
}

export interface QualityReport {
  generatedAt: string;
  totalScore: number;
  level: string;
  metrics: QualityDimension[];
  suggestions: QualitySuggestion[];
  analyzedNotes: number;
  analyzedWords: number;
}