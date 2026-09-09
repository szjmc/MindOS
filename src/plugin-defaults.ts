import type { MindOSSettings, UICollapsedState } from "./core/types";

export const DEFAULT_UI_COLLAPSED: UICollapsedState = {
  quickStart: false,
  wikiStatus: false,
  schemaStatus: true,
  logs: true,
  results: false,
  pipeline: false,
};

export const DEFAULT_SETTINGS: MindOSSettings = {
  baseFolder: "知识基地",
  openAfterSave: false,
  defaultMaturity: "🌱seedling",

  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.1,
  timeoutMs: 60000,
  maxRetries: 2,
  concurrency: 2,

  injectClaudeMd: true,
  injectIndexMd: true,
  reviewMode: true,
  indexAutoRebuildAfterN: 10,
  briefMaxLength: 30,

  uiCollapsed: { ...DEFAULT_UI_COLLAPSED },
  candidateTopN: 5,
  currentTab: "capture",

  embeddingProvider: "aliyun",
  embeddingApiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  embeddingApiKey: "",
  embeddingModel: "text-embedding-v3",
  embeddingDim: 1024,
  embeddingBatchSize: 25,
  embeddingChunkMaxChars: 800,
  embeddingChunkMinChars: 100,

  autoVectorize: false,
  autoVectorizeThreshold: 10,

  searchTopK: 10,
  searchMinScore: 0.5,

  ragEnabled: true,
  ragTopK: 5,
  ragTemperature: 0.3,
  ragMaxContextTokens: 4000,
  ragStreaming: true,

  dailyTokenLimit: 100000,
  warnOnHighCost: true,
  costPerMillionTokensEmbedding: 0.7,
  costPerMillionTokensChat: 1.0,

  chatExportFolder: "知识库/主题",
  chatExportCustomPath: "",

  recallSRSAlgorithm: "sm2",
  recallNewCardsPerDay: 20,
  recallReviewLimit: 100,
  recallAutoGenerate: false,

  // v0.7 Express
  expressExportFolder: "知识库/文章",

  // v0.7 Recall TTS
  recallTTSEnabled: true,
  recallTTSLang: "en-US",
  recallTTSRate: 1.0,
  recallTTSPitch: 1.0,
  recallTTSVolume: 1.0,
  recallTTSPreferredVoice: "",

  // v0.7 Recall Vocab TTS Hotkey
  recallVocabTTSHotkey: "Shift+Space",
  recallVocabTTSHotkeyAlt: "Alt+S",
  recallVocabAutoSpeak: false,
  recallVocabSpellMode: false,

  // v0.8 Version History
  versionHistoryEnabled: true,
  versionMaxCount: 50,

  // v0.8 Health Report
  healthCheckEnabled: true,
  healthCheckIntervalDays: 7,
};
