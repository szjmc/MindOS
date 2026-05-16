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
export type SearchMode = "page" | "chunk";
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
