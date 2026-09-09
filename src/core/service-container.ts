/**
 * ServiceContainer — 集中管理所有服务的创建、依赖注入和生命周期
 *
 * 替代 main.ts 中的 God Class 模式，将服务创建逻辑按模块拆分，
 * 消除顺序依赖和全局 setter 函数注入。
 */
import { App, TFile, normalizePath, Notice } from "obsidian";
import { MindOSSettings, PageSearchResult } from "./types";
import { TaskStore, RetrieveStore, RecallStore } from "./store";
import { ActivityLogger } from "./activity-logger";
import {
  VIEW_TYPE_MINDOS,
  VIEW_TYPE_WIKI_EVOLUTION,
  VIEW_TYPE_CONNECT_BACKLINK,
  VIEW_TYPE_ANALYSIS,
  VIEW_TYPE_SMART_EXTRACT,
  DIR_WIKI,
  DIR_RAW,
} from "./constants";

// ── Module imports ──
import { AIClient, ActionExecutor, WorkflowEngine } from "../modules/pipeline";
import {
  SchemaManager, IndexManager, Migrator, KnowledgeGapAnalyzer,
} from "../modules/wiki";
import { VersionManager } from "../modules/wiki/version-manager";
import { HealthReportGenerator } from "../modules/wiki/health-report";
import { AutoLinkMiner } from "../modules/connect/backlink/auto-link-miner";
import { ContradictionDetector } from "../modules/connect/backlink/contradiction-detector";
import { SummaryGenerator } from "../modules/connect/summary-generator";
import { QuestionGenerator } from "../modules/connect/question-generator";
import { UnifiedDocumentParser } from "../modules/connect/unified-parser";
import {
  EmbeddingClient, VectorStore, EmbeddingManager, SemanticSearch,
  RAGChat, QuotaManager, ChatSessionStore,
  ContextAwarenessService,
} from "../modules/retrieve";
import {
  RecallCardStore, SRSEngine, AICardGenerator,
  RecallWikiGenerator, RecallCommandGenerator, RecallVocabGenerator,
  RecallConceptGenerator, RecallPhraseGenerator, WordListStore,
  InterviewStore, JDAnalyzer, GapAnalyzer, MockInterviewer,
  CustomScenarioStore, DashboardService,
  CardVectorStore, CardRelationService,
} from "../modules/recall";
import { QuickNoteService, CaptureService } from "../modules/capture";
import {
  ArticleStore, OutlineBuilder, ArticleGenerator,
} from "../modules/express";
import { TTSService } from "../modules/recall/core/tts-service";
import { buildAIClientAdapter } from "../modules/pipeline/ai-adapter";

import { PluginLike } from "./plugin-like";

// ═══════════════════════════════════════════════════════════
// Container interface — 供 main.ts 使用
// ═══════════════════════════════════════════════════════════

export interface ServiceContainerDeps {
  app: App;
  getSettings: () => MindOSSettings;
  saveSettings: () => Promise<void>;
  taskStore: TaskStore;
  retrieveStore: RetrieveStore;
  recallStore: RecallStore;
  activityLogger: ActivityLogger;
}

export class ServiceContainer {
  // ── Public readonly services ──
  readonly app: App;
  readonly getSettings: () => MindOSSettings;
  readonly saveSettings: () => Promise<void>;
  readonly taskStore: TaskStore;
  readonly retrieveStore: RetrieveStore;
  readonly recallStore: RecallStore;
  readonly activityLogger: ActivityLogger;

  // Core (Wiki / Pipeline)
  schemaManager!: SchemaManager;
  indexManager!: IndexManager;
  migrator!: Migrator;
  aiClient!: AIClient;
  executor!: ActionExecutor;
  workflowEngine!: WorkflowEngine;

  // Retrieve
  embeddingClient!: EmbeddingClient;
  vectorStore!: VectorStore;
  embeddingManager!: EmbeddingManager;
  semanticSearch!: SemanticSearch;
  ragChat!: RAGChat;
  quotaManager!: QuotaManager;
  chatSessionStore!: ChatSessionStore;
  contextAwarenessService!: ContextAwarenessService;

  // Recall
  recallCardStore!: RecallCardStore;
  srsEngine!: SRSEngine;
  aiCardGenerator!: AICardGenerator;
  cardVectorStore!: CardVectorStore;
  cardRelationService!: CardRelationService;

  // Recall generators
  recallWikiGenerator!: RecallWikiGenerator;
  recallCommandGenerator!: RecallCommandGenerator;
  vocabGenerator!: RecallVocabGenerator;
  conceptGenerator!: RecallConceptGenerator;
  phraseGenerator!: RecallPhraseGenerator;
  wordListStore!: WordListStore;

  // Interview
  interviewStore!: InterviewStore;
  jdAnalyzer!: JDAnalyzer;
  gapAnalyzer!: GapAnalyzer;
  mockInterviewer!: MockInterviewer;

  // Custom scenario
  customScenarioStore!: CustomScenarioStore;

  // Dashboard
  dashboardService!: DashboardService;

  // Express
  articleStore!: ArticleStore;
  outlineBuilder!: OutlineBuilder;
  articleGenerator!: ArticleGenerator;
  ttsService!: TTSService;

  // v0.7 misc
  knowledgeGapAnalyzer!: KnowledgeGapAnalyzer;
  quickNoteService!: QuickNoteService;

  // v0.8 evolution
  versionManager!: VersionManager;
  healthReportGenerator!: HealthReportGenerator;

  // v0.9 deep linking
  autoLinkMiner!: AutoLinkMiner;
  contradictionDetector!: ContradictionDetector;

  // v1.0 smart extract
  unifiedParser!: UnifiedDocumentParser;
  summaryGenerator!: SummaryGenerator;
  questionGenerator!: QuestionGenerator;

  constructor(deps: ServiceContainerDeps) {
    this.app = deps.app;
    this.getSettings = deps.getSettings;
    this.saveSettings = deps.saveSettings;
    this.taskStore = deps.taskStore;
    this.retrieveStore = deps.retrieveStore;
    this.recallStore = deps.recallStore;
    this.activityLogger = deps.activityLogger;
  }

  get settings(): MindOSSettings {
    return this.getSettings();
  }

  /**
   * 完整初始化所有服务：按模块分组，组内并行、组间确保依赖满足
   */
  async initializeAll(plugin: PluginLike): Promise<void> {
    // ── Phase 1: 无依赖的基础服务（可并行）──
    this.initWikiPipeline();
    this.initRetrieve();
    // ── Phase 2: Recall 基础设施 + Store 初始化（并行）──
    await this.initRecallCore();
    // ── Phase 3: 依赖 Phase 2 的服务（可并行）──
    this.initRecallGenerators();
    this.initInterview();
    // ── Phase 4: 独立服务（可并行）──
    await this.initIndependentServices(plugin);
    // ── Phase 5: 依赖前面所有服务的 Express ──
    this.initExpress();
  }

  // ═══════════════════════════════════════════════════════
  // Phase 1: Wiki + Pipeline + Retrieve（无互相依赖）
  // ═══════════════════════════════════════════════════════

  private initWikiPipeline(): void {
    const baseFolder = () => this.settings.baseFolder;
    const log = (msg: string) => this.taskStore.log(msg);

    this.schemaManager = new SchemaManager(this.app, baseFolder);
    this.indexManager = new IndexManager(
      this.app, baseFolder,
      () => this.settings.indexAutoRebuildAfterN,
      () => this.settings.briefMaxLength,
    );
    this.migrator = new Migrator(this.app, baseFolder);
    this.aiClient = new AIClient(
      () => this.settings, () => this.schemaManager.readClaudeMd(),
      () => this.indexManager.readIndex(), log,
    );
    this.executor = new ActionExecutor(
      this.app, () => this.settings, baseFolder, this.indexManager, log,
    );
    this.workflowEngine = new WorkflowEngine(
      this.app, () => this.settings, baseFolder,
      this.aiClient, this.indexManager, this.taskStore,
      () => false,
    );
  }

  private initRetrieve(): void {
    const retrieveLog = (msg: string) => this.retrieveStore.log(msg);
    const baseFolder = () => this.settings.baseFolder;

    this.quotaManager = new QuotaManager(
      this.app, baseFolder, () => this.settings.dailyTokenLimit,
    );
    this.embeddingClient = new EmbeddingClient(
      () => this.settings, retrieveLog,
    );
    this.vectorStore = new VectorStore(this.app, baseFolder);
    this.embeddingManager = new EmbeddingManager(
      this.app, () => this.settings, this.vectorStore,
      this.embeddingClient, this.quotaManager, this.indexManager,
      this.retrieveStore, retrieveLog,
    );
    this.semanticSearch = new SemanticSearch(
      () => this.settings, this.vectorStore, this.embeddingClient,
      this.quotaManager, retrieveLog,
    );
    this.ragChat = new RAGChat(
      () => this.settings, this.semanticSearch, this.quotaManager, retrieveLog,
    );
    this.chatSessionStore = new ChatSessionStore(
      this.app, baseFolder, () => this.settings,
    );
  }

  // ═══════════════════════════════════════════════════════
  // Phase 2: Recall 基础设施 + Store 并行初始化
  // ═══════════════════════════════════════════════════════

  private async initRecallCore(): Promise<void> {
    const retrieveLog = (msg: string) => this.retrieveStore.log(msg);
    const baseFolder = () => this.settings.baseFolder;

    this.srsEngine = new SRSEngine(this.settings.recallSRSAlgorithm ?? "sm2");
    this.recallCardStore = new RecallCardStore(this.app, baseFolder);
    this.aiCardGenerator = new AICardGenerator(
      () => this.settings, this.quotaManager, retrieveLog,
    );
    this.wordListStore = new WordListStore(this.app, baseFolder);
    this.interviewStore = new InterviewStore(this.app, baseFolder);
    this.customScenarioStore = new CustomScenarioStore(this.app, baseFolder);

    // 并行初始化无依赖的 Store
    await Promise.all([
      this.recallCardStore.initialize(),
      this.wordListStore.initialize(),
      this.interviewStore.initialize(),
      this.customScenarioStore.initialize(),
    ]);

    // 卡片关联向量
    this.cardVectorStore = new CardVectorStore(this.app, baseFolder);
    this.cardRelationService = new CardRelationService(
      this.recallCardStore as any, this.cardVectorStore, this.embeddingClient as any,
      () => this.settings, retrieveLog,
    );
    this.recallCardStore.setOnCardUpdatedCallback((card) => {
      this.cardRelationService.scheduleCardVectorUpdate(card);
    });
  }

  // ═══════════════════════════════════════════════════════
  // Phase 3: Recall 场景生成器 + 面试助手
  // ═══════════════════════════════════════════════════════

  private initRecallGenerators(): void {
    const retrieveLog = (msg: string) => this.retrieveStore.log(msg);

    this.recallWikiGenerator = new RecallWikiGenerator(
      this.app, () => this.settings, this.indexManager,
      this.recallCardStore, retrieveLog,
    );
    this.recallCommandGenerator = new RecallCommandGenerator(
      this.app, () => this.settings, this.indexManager,
      this.recallCardStore, this.aiCardGenerator, retrieveLog,
    );
    this.vocabGenerator = new RecallVocabGenerator(
      this.app, () => this.settings, this.recallCardStore,
      this.wordListStore, this.aiCardGenerator, retrieveLog,
    );
    this.conceptGenerator = new RecallConceptGenerator(
      this.app, () => this.settings, this.indexManager,
      this.recallCardStore, this.aiCardGenerator, retrieveLog,
    );
    this.phraseGenerator = new RecallPhraseGenerator(
      this.app, () => this.settings, this.recallCardStore,
      this.aiCardGenerator, retrieveLog,
    );
  }

  private initInterview(): void {
    const retrieveLog = (msg: string) => this.retrieveStore.log(msg);

    this.jdAnalyzer = new JDAnalyzer(
      this.aiCardGenerator, this.interviewStore, retrieveLog,
    );
    this.gapAnalyzer = new GapAnalyzer(
      this.semanticSearch, this.interviewStore, retrieveLog,
    );
    this.mockInterviewer = new MockInterviewer(
      () => this.settings, this.aiCardGenerator, this.interviewStore,
      this.semanticSearch, retrieveLog,
    );
  }

  // ═══════════════════════════════════════════════════════
  // Phase 4: 独立初始化服务 + v0.9/v1.0
  // ═══════════════════════════════════════════════════════

  private async initIndependentServices(plugin: PluginLike): Promise<void> {
    // Dashboard
    this.dashboardService = new DashboardService(
      this.app, () => this.settings.baseFolder, this.recallCardStore,
    );

    // Knowledge gap
    this.knowledgeGapAnalyzer = new KnowledgeGapAnalyzer(
      this.app, () => this.settings, this.aiClient,
    );

    // Quick note
    this.quickNoteService = new QuickNoteService(this.app, () => this.settings);

    // Context awareness
    this.contextAwarenessService = new ContextAwarenessService(
      this.app, () => this.settings, this.semanticSearch,
    );

    // v0.8
    this.versionManager = new VersionManager(this.app, () => this.settings);
    this.healthReportGenerator = new HealthReportGenerator(this.app, () => this.settings);

    // v0.9 + v1.0：并行初始化
    this.autoLinkMiner = new AutoLinkMiner(plugin);
    this.contradictionDetector = new ContradictionDetector(plugin);
    this.unifiedParser = new UnifiedDocumentParser(plugin);

    await Promise.all([
      this.autoLinkMiner.initialize(),
      this.contradictionDetector.initialize(),
      this.unifiedParser.initialize(),
    ]);

    this.summaryGenerator = new SummaryGenerator(plugin, this.unifiedParser);
    this.questionGenerator = new QuestionGenerator(plugin, this.unifiedParser);

    await Promise.all([
      this.summaryGenerator.initialize(),
      this.questionGenerator.initialize(),
    ]);
  }

  // ═══════════════════════════════════════════════════════
  // Phase 5: Express（依赖 AI Client）
  // ═══════════════════════════════════════════════════════

  private initExpress(): void {
    this.articleStore = new ArticleStore(this.app, () => this.settings.baseFolder);

    this.ttsService = new TTSService();
    this.ttsService.init().catch(() => {});

    const aiAdapter = buildAIClientAdapter(this.aiClient);
    const semanticSearchAdapter = this.semanticSearch
      ? {
          search: async (query: string, topK: number) => {
            const results = await this.semanticSearch.search(query, { topK });
            return results.map((r: PageSearchResult) => ({
              content: r.bestPreview ?? '',
              filePath: r.path ?? '',
              score: typeof r.topScore === 'number' ? r.topScore : 0,
            }));
          }
        }
      : null;

    this.outlineBuilder = new OutlineBuilder(
      this.app, aiAdapter, this.settings.baseFolder, semanticSearchAdapter,
    );
    this.articleGenerator = new ArticleGenerator(aiAdapter);
  }
}
