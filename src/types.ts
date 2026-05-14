export type ProtocolValue = string | string[] | undefined;
export type MaturityStatus = "🌱seedling" | "🌿budding" | "🌲evergreen";
export type TaskStatus = "idle" | "running" | "awaiting_review" | "done" | "error";
export type PageType = "entity" | "concept" | "topic" | "comparison" | "overview";
export type ActionOp = "create" | "update" | "append_section" | "link";
export type ActionStatus = "pending" | "approved" | "rejected" | "executed" | "failed";
export type PipelineStage = "cluster" | "draft" | "diff" | "execute";
export type StageStatus = "pending" | "running" | "done" | "failed";

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
  tags: string[];
  content: string;
  blocks?: DraftBlock[];
  section?: string;
  links: string[];
  reason: string;
  status: ActionStatus;
  error?: string;
  sourceRounds?: number[];
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
  stages: {
    cluster: PipelineStageInfo;
    draft: PipelineStageInfo;
    diff: PipelineStageInfo;
    execute: PipelineStageInfo;
  };
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

export interface AIPromptCollectorSettings {
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
}