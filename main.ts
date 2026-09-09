import { Notice, Plugin, TFile, normalizePath, setIcon, Menu, Editor, MarkdownView } from "obsidian";
import {
  VIEW_TYPE_MINDOS,
  VIEW_TYPE_WIKI_EVOLUTION,
  VIEW_TYPE_CONNECT_BACKLINK,
  VIEW_TYPE_ANALYSIS,
  VIEW_TYPE_SMART_EXTRACT,
  PROTOCOL_NAME,
  DIR_WIKI,
  DIR_RAW,
} from "./src/core/constants";
import {
  MindOSSettings,
  PageSearchResult,
  PromptPayload,
  ProtocolValue,
  RecallCard,
  RetrieveTab,
  UICollapsedState,
} from "./src/core/types";
import { nowISOString, safeFileName as safeFileNameUtil } from "./src/core/utils";
import { TaskStore, RetrieveStore, RecallStore } from "./src/core/store";
import { ActivityLogger } from "./src/core/activity-logger";

import { DEFAULT_SETTINGS, DEFAULT_UI_COLLAPSED } from "./src/plugin-defaults";

// ── Module Barrel Exports ──
import { AIClient, ActionExecutor, WorkflowEngine, TaskProgressView }
  from "./src/modules/pipeline";
import { SchemaManager, IndexManager, Migrator, KnowledgeGapAnalyzer }
  from "./src/modules/wiki";
import { VersionManager } from "./src/modules/wiki/version-manager";
import { HealthReportGenerator } from "./src/modules/wiki/health-report";
import { AutoLinkMiner } from "./src/modules/connect/backlink/auto-link-miner";
import { ContradictionDetector } from "./src/modules/connect/backlink/contradiction-detector";
import { SummaryGenerator } from "./src/modules/connect/summary-generator";
import { QuestionGenerator } from "./src/modules/connect/question-generator";
import { UnifiedDocumentParser } from "./src/modules/connect/unified-parser";
import { SmartExtractView } from "./src/modules/connect/smart-extract-view";
import {
  EmbeddingClient, VectorStore, EmbeddingManager, SemanticSearch,
  RAGChat, QuotaManager, ChatSessionStore,
  MindOSRetrieveView, ContextAwarenessService,
} from "./src/modules/retrieve";
import {
  RecallCardStore, RecallView, SRSEngine, AICardGenerator, TTSService,
  RecallWikiGenerator, RecallCommandGenerator, RecallVocabGenerator,
  RecallConceptGenerator, RecallPhraseGenerator, WordListStore,
  RecallCardManagerView,
  InterviewStore, JDAnalyzer, GapAnalyzer, InterviewView, MockInterviewer, MockInterviewView,
  CustomScenarioStore, DashboardService,
  CardVectorStore, CardRelationService,
} from "./src/modules/recall";
import { QuickNoteService, CaptureService } from "./src/modules/capture";
import { ExpressView, EXPRESS_VIEW_TYPE, ArticleStore, OutlineBuilder, ArticleGenerator }
  from "./src/modules/express";

import { MindOSSettingTab } from "./src/ui/settings-tab";

// ── 提取后的服务模块 ──
import {
  setPipelineDeps,
  initializeStructure,
  collectFromClipboard,
  processConversation,
  approveAction,
  approveAllActions,
  requestStop,
  fillMissingBriefs,
  handleProtocol,
  migrateOldStructure,
  batchParseAllWikiPages,
} from "./src/conversation-pipeline";
import { setChatDeps, loadChatSessions, createNewChatSession, deleteChatSession,
  renameChatSession, exportChatSession, askChat, refreshQuota } from "./src/chat-service";
import {
  setCaptureDeps, renderCaptureTab, renderCaptureMethods, renderRecallTab,
} from "./src/capture-view-renderer";
import { ViewManager } from "./src/view-manager";
import { buildAIClientAdapter, speakVocab } from "./src/modules/pipeline/ai-adapter";
// ================================================================

export default class MindOSPlugin extends Plugin {
  settings!: MindOSSettings;

  // Stores
  taskStore = new TaskStore();
  retrieveStore = new RetrieveStore();
  recallStore = new RecallStore();
  activityLogger!: ActivityLogger;

  // Core (Wiki / Pipeline)
  schemaManager!: SchemaManager;
  indexManager!: IndexManager;
  migrator!: Migrator;
  aiClient!: AIClient;
  executor!: ActionExecutor;
  workflowEngine!: WorkflowEngine;

  // Retrieve (v0.5)
  embeddingClient!: EmbeddingClient;
  vectorStore!: VectorStore;
  embeddingManager!: EmbeddingManager;
  semanticSearch!: SemanticSearch;
  ragChat!: RAGChat;
  quotaManager!: QuotaManager;
  chatSessionStore!: ChatSessionStore;

  // Recall 核心 (v0.6)
  recallCardStore!: RecallCardStore;
  recallView!: RecallView;
  srsEngine!: SRSEngine;
  aiCardGenerator!: AICardGenerator;
  cardManagerView!: RecallCardManagerView;
  currentRecallCards: RecallCard[] = [];

  // Recall 场景生成器
  recallWikiGenerator!: RecallWikiGenerator;
  recallCommandGenerator!: RecallCommandGenerator;
  vocabGenerator!: RecallVocabGenerator;
  conceptGenerator!: RecallConceptGenerator;
  phraseGenerator!: RecallPhraseGenerator;
  wordListStore!: WordListStore;

  // 面试助手
  interviewStore!: InterviewStore;
  jdAnalyzer!: JDAnalyzer;
  gapAnalyzer!: GapAnalyzer;
  interviewView!: InterviewView;
  mockInterviewer!: MockInterviewer;
  mockInterviewView!: MockInterviewView;

  // 自定义场景
  customScenarioStore!: CustomScenarioStore;

  // Dashboard
  dashboardService!: DashboardService;

  // v0.7 Express
  articleStore!: ArticleStore;
  outlineBuilder!: OutlineBuilder;
  articleGenerator!: ArticleGenerator;
  ttsService!: TTSService;
  cardVectorStore!: CardVectorStore;
  cardRelationService!: CardRelationService;

  // v0.7 其它
  knowledgeGapAnalyzer!: KnowledgeGapAnalyzer;
  quickNoteService!: QuickNoteService;
  captureService!: CaptureService;
  contextAwarenessService!: ContextAwarenessService;

  // v0.8 知识演化
  versionManager!: VersionManager;
  healthReportGenerator!: HealthReportGenerator;

  // v0.9 深度关联
  autoLinkMiner!: AutoLinkMiner;
  contradictionDetector!: ContradictionDetector;

  // v1.0 智能萃取
  unifiedParser!: UnifiedDocumentParser;
  summaryGenerator!: SummaryGenerator;
  questionGenerator!: QuestionGenerator;

  // ── 视图管理器 ──
  viewManager!: ViewManager;
  
  // ── 状态标记 ──
  isOpeningFile = false;

  // ════════════════════════════════════════════════════════════
  // Plugin Lifecycle
  // ════════════════════════════════════════════════════════════

  async onload() {
    await this.loadSettings();

    // ── 安全检查：API Key 明文存储提醒 ──
    if (this.settings.apiKey || this.settings.embeddingApiKey) {
      console.warn(
        "[MindOS] ⚠️ 安全提醒：API Key 以明文形式存储在 .obsidian/plugins/mindos/data.json 中。\n"
        + "请确保该文件未被同步到云端（如 iCloud、GitHub 等），或将其加入 .gitignore。\n"
        + "建议定期更换 API Key。"
      );
    }

    // ── 初始化活动日志 ──
    this.activityLogger = new ActivityLogger(this.app, this.settings.baseFolder);
    await this.activityLogger.init();
    this.retrieveStore.setLogCallback((msg: string) => {
      console.log(`[MindOS] ${msg}`);
      this.activityLogger.info(msg, 'retrieve');
    });

    // ── 1. Wiki / Pipeline ──
    this.schemaManager = new SchemaManager(this.app, () => this.settings.baseFolder);
    this.indexManager = new IndexManager(
      this.app, () => this.settings.baseFolder,
      () => this.settings.indexAutoRebuildAfterN,
      () => this.settings.briefMaxLength,
    );
    this.migrator = new Migrator(this.app, () => this.settings.baseFolder);
    this.aiClient = new AIClient(
      () => this.settings, () => this.schemaManager.readClaudeMd(),
      () => this.indexManager.readIndex(),
      (msg: string) => this.taskStore.log(msg),
    );
    this.executor = new ActionExecutor(
      this.app, () => this.settings, () => this.settings.baseFolder,
      this.indexManager, (msg: string) => this.taskStore.log(msg),
    );
    this.workflowEngine = new WorkflowEngine(
      this.app, () => this.settings, () => this.settings.baseFolder,
      this.aiClient, this.indexManager, this.taskStore,
      () => false, // stopRequested - managed by pipeline module
    );

    // ── 2. Retrieve ──
    this.quotaManager = new QuotaManager(
      this.app, () => this.settings.baseFolder, () => this.settings.dailyTokenLimit,
    );
    this.embeddingClient = new EmbeddingClient(
      () => this.settings, (msg: string) => this.retrieveStore.log(msg),
    );
    this.vectorStore = new VectorStore(this.app, () => this.settings.baseFolder);
    this.embeddingManager = new EmbeddingManager(
      this.app, () => this.settings, this.vectorStore, this.embeddingClient,
      this.quotaManager, this.indexManager, this.retrieveStore,
      (msg: string) => this.retrieveStore.log(msg),
    );
    this.semanticSearch = new SemanticSearch(
      () => this.settings, this.vectorStore, this.embeddingClient,
      this.quotaManager, (msg: string) => this.retrieveStore.log(msg),
    );
    this.ragChat = new RAGChat(
      () => this.settings, this.semanticSearch, this.quotaManager,
      (msg: string) => this.retrieveStore.log(msg),
    );
    this.chatSessionStore = new ChatSessionStore(
      this.app, () => this.settings.baseFolder, () => this.settings,
    );

    // ── 3. Recall 核心 ──
    this.srsEngine = new SRSEngine(this.settings.recallSRSAlgorithm ?? "sm2");
    this.recallCardStore = new RecallCardStore(this.app, () => this.settings.baseFolder);
    this.aiCardGenerator = new AICardGenerator(
      () => this.settings, this.quotaManager,
      (msg: string) => this.retrieveStore.log(msg),
    );
    this.wordListStore = new WordListStore(this.app, () => this.settings.baseFolder);
    this.interviewStore = new InterviewStore(this.app, () => this.settings.baseFolder);
    this.customScenarioStore = new CustomScenarioStore(this.app, () => this.settings.baseFolder);

    // ── 并行初始化各 Store（无依赖关系，加快启动速度）──
    await Promise.all([
      this.recallCardStore.initialize(),
      this.wordListStore.initialize(),
      this.interviewStore.initialize(),
      this.customScenarioStore.initialize(),
    ]);

    // ── 卡片关联向量（依赖 recallCardStore 初始化完成）──
    this.cardVectorStore = new CardVectorStore(this.app, () => this.settings.baseFolder);
    this.cardRelationService = new CardRelationService(
      this.recallCardStore as any, this.cardVectorStore, this.embeddingClient as any,
      () => this.settings, (msg: string) => this.retrieveStore.log(msg),
    );
    // 连接卡片更新回调，实现自动向量化
    this.recallCardStore.setOnCardUpdatedCallback((card) => {
      this.cardRelationService.scheduleCardVectorUpdate(card);
    });

    // ── 4. Recall 场景生成器 ──
    this.recallWikiGenerator = new RecallWikiGenerator(
      this.app, () => this.settings, this.indexManager, this.recallCardStore,
      (msg: string) => this.retrieveStore.log(msg),
    );
    this.recallCommandGenerator = new RecallCommandGenerator(
      this.app, () => this.settings, this.indexManager, this.recallCardStore,
      this.aiCardGenerator, (msg: string) => this.retrieveStore.log(msg),
    );
    this.vocabGenerator = new RecallVocabGenerator(
      this.app, () => this.settings, this.recallCardStore, this.wordListStore,
      this.aiCardGenerator, (msg: string) => this.retrieveStore.log(msg),
    );
    this.conceptGenerator = new RecallConceptGenerator(
      this.app, () => this.settings, this.indexManager, this.recallCardStore,
      this.aiCardGenerator, (msg: string) => this.retrieveStore.log(msg),
    );
    this.phraseGenerator = new RecallPhraseGenerator(
      this.app, () => this.settings, this.recallCardStore,
      this.aiCardGenerator, (msg: string) => this.retrieveStore.log(msg),
    );

    // ── 5. 面试助手（依赖 interviewStore 初始化完成）──
    this.jdAnalyzer = new JDAnalyzer(
      this.aiCardGenerator, this.interviewStore,
      (msg: string) => this.retrieveStore.log(msg),
    );
    this.gapAnalyzer = new GapAnalyzer(
      this.semanticSearch, this.interviewStore,
      (msg: string) => this.retrieveStore.log(msg),
    );
    this.mockInterviewer = new MockInterviewer(
      () => this.settings, this.aiCardGenerator, this.interviewStore,
      this.semanticSearch, (msg: string) => this.retrieveStore.log(msg),
    );

    // ── 7. Dashboard ──
    this.dashboardService = new DashboardService(
      this.app, () => this.settings.baseFolder, this.recallCardStore,
    );

    // ── 8. Express ──
    this.articleStore = new ArticleStore(this.app, () => this.settings.baseFolder);
    this.ttsService = new TTSService();
    this.ttsService.init().catch(() => {});

    const aiAdapter = buildAIClientAdapter(this.aiClient);

    const semanticSearchAdapter = this.semanticSearch
      ? {
          search: async (query: string, topK: number) => {
            const results = await this.semanticSearch!.search(query, { topK });
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

    // ── 知识空白雷达 ──
    this.knowledgeGapAnalyzer = new KnowledgeGapAnalyzer(
      this.app, () => this.settings, this.aiClient,
    );

    // ── 闪念笔记 ──
    this.quickNoteService = new QuickNoteService(this.app, () => this.settings);

    // ── 情境感知 ──
    this.contextAwarenessService = new ContextAwarenessService(
      this.app, () => this.settings, this.semanticSearch,
    );

    // ── v0.8 知识演化 ──
    this.versionManager = new VersionManager(this.app, () => this.settings);
    this.healthReportGenerator = new HealthReportGenerator(this.app, () => this.settings);

    // ── v0.9 深度关联 + v1.0 智能萃取：无互相依赖，并行初始化 ──
    this.autoLinkMiner = new AutoLinkMiner(this);
    this.contradictionDetector = new ContradictionDetector(this);
    this.unifiedParser = new UnifiedDocumentParser(this);
    await Promise.all([
      this.autoLinkMiner.initialize(),
      this.contradictionDetector.initialize(),
      this.unifiedParser.initialize(),
    ]);

    // summaryGenerator / questionGenerator 依赖 unifiedParser，需串行
    this.summaryGenerator = new SummaryGenerator(this, this.unifiedParser);
    this.questionGenerator = new QuestionGenerator(this, this.unifiedParser);
    await Promise.all([
      this.summaryGenerator.initialize(),
      this.questionGenerator.initialize(),
    ]);

    // ── 视图管理器 ──
    this.viewManager = new ViewManager({
      app: this.app,
      workspace: this.app.workspace,
      retrieveStore: this.retrieveStore,
      contextAwarenessService: this.contextAwarenessService,
      knowledgeGapAnalyzer: this.knowledgeGapAnalyzer,
    });

    // ── 采集服务 ──
    this.captureService = new CaptureService(
      this.app,
      () => this.settings,
      this.quickNoteService,
      async (text: string, source: string, title?: string) => {
        await processConversation({ source, content: text, title });

        // 采集场景（剪贴板、PDF上传、音频、OCR）：
        // 用户主动采集的内容期望立即处理完成，不应停留在"等待审核"状态。
        // 因此在 reviewMode=true 时也自动审批所有 pending actions。
        const state = this.taskStore.getState();
        if (state.pendingActions.length > 0) {
          await approveAllActions();
        }

        // pipeline 完成后（actions 已全部执行），从 taskStore 提取所有被修改的文件路径
        const results = this.taskStore.getState().results;
        return results
          .flatMap(r => r.actions)
          .filter(a => a.path && a.op !== "link")
          .map(a => a.path);
      },
      () => this.viewManager.showContextAwarenessPanel(),
      () => this.viewManager.showKnowledgeGaps(),
    );

    // ── 注入依赖到提取后的服务 ──
    setPipelineDeps({
      app: this.app, workspaces: this.app.workspace,
      getSettings: () => this.settings, saveSettings: () => this.saveSettings(),
      getBaseFolder: () => this.settings.baseFolder,
      taskStore: this.taskStore, retrieveStore: this.retrieveStore,
      schemaManager: this.schemaManager, indexManager: this.indexManager,
      migrator: this.migrator, workflowEngine: this.workflowEngine,
      executor: this.executor, embeddingManager: this.embeddingManager,
      aiClient: this.aiClient, unifiedParser: this.unifiedParser,
      openFile: (p: string) => this.openFile(p),
      activateTaskCenter: () => this.viewManager.activateTaskCenter(),
      showContextAwarenessPanel: () => this.viewManager.showContextAwarenessPanel(),
    });

    setChatDeps({
      app: this.app, quotaManager: this.quotaManager,
      chatSessionStore: this.chatSessionStore, ragChat: this.ragChat,
      retrieveStore: this.retrieveStore, semanticSearch: this.semanticSearch,
      getSettings: () => this.settings,
    });

    // ── 9. View 实例 ── (必须在 setCaptureDeps 之前，因为 setCaptureDeps 需要 recallView)
    this.recallView = new RecallView(this);
    this.cardManagerView = new RecallCardManagerView(this);
    this.interviewView = new InterviewView(this);
    this.mockInterviewView = new MockInterviewView(this);

    setCaptureDeps({
      taskStore: this.taskStore, captureService: this.captureService,
      recallView: this.recallView,
      plugin: this,
      approveAction: (id: string) => approveAction(id),
      approveAllActions: () => approveAllActions(),
      requestStop: () => requestStop(),
      openFile: (p: string) => this.openFile(p),
    });

    const todayStats = await this.recallCardStore.getTodayStats();
    this.recallStore.setTodayStats(todayStats);

    // ── 10. 注册 View ──
    this.registerView(VIEW_TYPE_MINDOS, (leaf) => new MindOSRetrieveView(leaf, this));
    this.registerView(EXPRESS_VIEW_TYPE, (leaf) => new ExpressView(leaf, this));
    const { WikiEvolutionView } = await import("./src/modules/wiki/wiki-evolution-view");
    this.registerView(VIEW_TYPE_WIKI_EVOLUTION, (leaf) => new WikiEvolutionView(leaf, this));
    const { BacklinkView } = await import("./src/modules/connect/backlink/backlink-view");
    this.registerView(VIEW_TYPE_CONNECT_BACKLINK, (leaf) => new BacklinkView(leaf, this));
    const { AnalysisView } = await import("./src/modules/connect/analysis-view");
    this.registerView(VIEW_TYPE_ANALYSIS, (leaf) => new AnalysisView(leaf, this));
    this.registerView(VIEW_TYPE_SMART_EXTRACT, (leaf) => new SmartExtractView(leaf, this));

    // ── 11. Ribbon & Commands ──
    this.addRibbonIcon("brain-circuit", "MindOS - 智能分析",
      async () => await this.activateAnalysisView());
    this.addRibbonIcon("sparkles", "MindOS - 智能萃取",
      async () => await this.activateSmartExtractView());
    this.addRibbonIcon("blocks", "MindOS - 任务中心",
      async () => this.viewManager.activateTaskCenter());
    this.addRibbonIcon("file-text", "MindOS - Express 输出",
      async () => this.viewManager.activateExpressView());

    // 基础命令
    this.addCommand({ id: "mindos-collect", name: "采集并整理 AI 对话",
      callback: async () => await collectFromClipboard({}) });
    this.addCommand({ id: "mindos-open-center", name: "打开任务中心",
      callback: async () => await this.viewManager.activateTaskCenter() });
    this.addCommand({ id: "mindos-rebuild-index", name: "重建 Wiki INDEX",
      callback: async () => { const r = await this.indexManager.rebuild(); new Notice(`已重建 INDEX：${r.count} 个页面`); } });
    this.addCommand({ id: "mindos-fill-briefs", name: "补全 Wiki 缺失的 brief",
      callback: async () => await fillMissingBriefs() });
    this.addCommand({ id: "mindos-batch-parse", name: "批量解析所有 Wiki 页面",
      callback: async () => await batchParseAllWikiPages() });
    this.addCommand({ id: "mindos-init", name: "初始化 MindOS 三层结构",
      callback: async () => { await initializeStructure(); new Notice("✅ 已初始化 MindOS 结构"); } });
    this.addCommand({ id: "mindos-knowledge-gaps", name: "知识空白雷达",
      callback: () => this.viewManager.showKnowledgeGaps() });
    this.addCommand({ id: "mindos-quick-note", name: "💡 闪念笔记",
      callback: () => this.quickNoteService.showQuickNoteModal() });
    this.addCommand({ id: "mindos-context-aware", name: "🔗 情境感知",
      callback: () => this.viewManager.showContextAwarenessPanel() });

    // v0.5 命令
    this.addCommand({ id: "mindos-vectorize-all", name: "全量向量化索引",
      callback: async () => { const r = await this.embeddingManager.vectorizeAll(); new Notice(r.message); } });
    this.addCommand({ id: "mindos-sync-incremental", name: "增量同步向量索引",
      callback: async () => { const r = await this.embeddingManager.syncIncremental(); new Notice(r.message); } });
    this.addCommand({ id: "mindos-open-search", name: "打开语义检索",
      callback: async () => { await this.viewManager.activateTaskCenter(); this.retrieveStore.setTab("search"); } });
    this.addCommand({ id: "mindos-open-chat", name: "打开 RAG 问答",
      callback: async () => { await this.viewManager.activateTaskCenter(); this.retrieveStore.setTab("chat"); } });

    // v0.6 命令
    this.addCommand({ id: "mindos-open-recall", name: "打开复习模块",
      callback: async () => { await this.viewManager.activateTaskCenter(); this.retrieveStore.setTab("recall"); } });
    this.addCommand({
      id: "mindos-recall-dashboard", name: "打开学习数据看板",
      callback: async () => {
        const { DashboardView } = await import("./src/modules/recall/dashboard/dashboard-view");
        new DashboardView(this.app, this.dashboardService).open();
      },
    });
    this.addCommand({
      id: "mindos-recall-card-manager", name: "打开卡片管理面板",
      callback: async () => {
        await this.viewManager.activateTaskCenter();
        this.retrieveStore.setTab("recall");
        this.recallStore.setManagerScenario("wiki");
        this.recallStore.setViewMode("card_manager");
      },
    });
    this.addCommand({
      id: "mindos-recall-interview", name: "打开面试助手",
      callback: async () => {
        await this.viewManager.activateTaskCenter();
        this.retrieveStore.setTab("recall");
        this.recallStore.setSelectedScenario("interview");
      },
    });

    // v0.7 命令
    this.addCommand({ id: "mindos-open-express", name: "打开 Express 输出",
      callback: async () => this.viewManager.activateExpressView() });
    this.addCommand({ id: "mindos-rebuild-card-vectors", name: "重建复习卡片向量索引",
      callback: async () => {
        const count = await this.cardRelationService.rebuildVectors();
        new Notice(`已建立 ${count} 张卡片向量`);
      } });
    this.addCommand({ id: "mindos-clear-card-vectors", name: "清空复习卡片向量索引",
      callback: async () => {
        await this.cardVectorStore.clear();
        new Notice("已清空卡片向量索引");
      } });

    // v0.8 命令
    this.addCommand({ id: "mindos-open-evolution", name: "打开知识演化面板",
      callback: async () => await this.activateWikiEvolutionView() });
    this.addCommand({ id: "mindos-open-smart-extract", name: "打开智能萃取面板",
      callback: async () => await this.activateSmartExtractView() });
    this.addCommand({ id: "mindos-version-history", name: "查看当前页面版本历史",
      editorCallback: async (editor: Editor, view: MarkdownView) => {
        const file = view?.file ?? this.app.workspace.getActiveFile();
        if (!file) { new Notice("请先打开一个页面"); return; }
        await this.activateWikiEvolutionView();
        const evLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI_EVOLUTION)[0];
        if (evLeaf) {
          const evView = (evLeaf.view as any);
          if (evView.currentTab !== "versions") {
            evView.currentTab = "versions";
            evView.render();
          }
          // 触发页面选择
          setTimeout(() => {
            const select = evLeaf.view.containerEl.querySelector(".mindos-versions-select") as HTMLSelectElement;
            if (select) {
              select.value = file.path;
              select.dispatchEvent(new Event("change"));
            }
          }, 100);
        }
      } });
    this.addCommand({ id: "mindos-health-report", name: "生成知识库健康度报告",
      callback: async () => {
        await this.activateWikiEvolutionView();
        const evLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_WIKI_EVOLUTION)[0];
        if (evLeaf) {
          const evView = (evLeaf.view as any);
          if (evView.currentTab !== "health") {
            evView.currentTab = "health";
            evView.render();
          }
        }
      } });
    this.addCommand({ id: "mindos-open-backlinks", name: "打开反向链接增强",
      callback: async () => await this.activateBacklinkView() });

    // v1.0 命令 — mindos-open-smart-extract 已在 v0.8 注册，此处不再重复

    // ── 12. Protocol Handler ──
    this.registerObsidianProtocolHandler(PROTOCOL_NAME, async (params) => {
      await handleProtocol(params as Record<string, ProtocolValue>);
    });

    // ── 13. Settings Tab ──
    this.addSettingTab(new MindOSSettingTab(this.app, this));

    // ── 14+15. 合并 modify 监听：向量化 + 版本历史（减少事件回调开销）──
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const path = file.path;

        // 自动向量化
        if (this.settings.autoVectorize) {
          if (path.includes(`/${DIR_WIKI}/`) || path.includes(`/${DIR_RAW}/`)) {
            this.embeddingManager.notifyFileChanged(path);
          }
        }

        // v0.8 版本历史自动记录
        if (this.settings.versionHistoryEnabled) {
          if (
            path.includes(`/${DIR_WIKI}/`) ||
            path.includes('/wiki/') ||
            path.startsWith(this.settings.baseFolder + '/')
          ) {
            try {
              const content = await this.app.vault.read(file);
              await this.versionManager.recordVersion(path, content);
            } catch { /* silent */ }
          }
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.embeddingManager.notifyFileDeleted(file.path);
        }
      })
    );

    // ── 16. 中文路径迁移命令 ──
    this.addCommand({ 
      id: "mindos-migrate-chinese-paths", 
      name: "迁移旧英文文件夹到中文文件夹",
      callback: async () => {
        new Notice("开始迁移...");
        const result = await this.migrator.migrateToChinesePaths();
        if (result.moved > 0) {
          new Notice(`✅ 成功迁移 ${result.moved} 个文件`);
        } else {
          new Notice("没有需要迁移的文件");
        }
        if (result.errors.length > 0) {
          new Notice(`⚠️ ${result.errors.length} 个迁移错误，请查看控制台`);
          console.warn("[MindOS] 迁移错误：", result.errors);
        }
      }
    });

    // ── 17. 自动尝试迁移 ──
    this.tryAutoMigrateChinesePaths();
  }

  async tryAutoMigrateChinesePaths() {
    try {
      const result = await this.migrator.migrateToChinesePaths();
      if (result.moved > 0) {
        new Notice(`✅ MindOS 已自动迁移 ${result.moved} 个文件到中文文件夹`);
      }
    } catch (e) {
      console.warn("[MindOS] 自动迁移失败：", e);
    }
  }

  async onunload() {
    // 清理所有注册的 View leaf
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINDOS);
    this.app.workspace.detachLeavesOfType(EXPRESS_VIEW_TYPE);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_WIKI_EVOLUTION);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CONNECT_BACKLINK);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_ANALYSIS);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_SMART_EXTRACT);

    // 清理 View 实例
    this.recallView?.unload();
    this.interviewView?.unload();
    this.mockInterviewView?.unload();
    this.viewManager?.contextAwarenessView?.destroy();
    this.cardManagerView?.unload?.();

    // v0.9 深度关联清理
    this.autoLinkMiner?.destroy();
    this.contradictionDetector?.destroy();

    // v1.0 智能萃取清理
    this.unifiedParser?.destroy?.();
    this.summaryGenerator?.destroy?.();
    this.questionGenerator?.destroy?.();
  }

  // ════════════════════════════════════════════════════════════
  // Settings
  // ════════════════════════════════════════════════════════════

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    if (!this.settings.uiCollapsed || typeof this.settings.uiCollapsed !== "object") {
      this.settings.uiCollapsed = { ...DEFAULT_UI_COLLAPSED };
    } else {
      this.settings.uiCollapsed = { ...DEFAULT_UI_COLLAPSED, ...this.settings.uiCollapsed };
    }
    if (typeof this.settings.candidateTopN !== "number") this.settings.candidateTopN = 5;
    if (typeof this.settings.searchTopK !== "number") this.settings.searchTopK = 10;
    if (typeof this.settings.ragTopK !== "number") this.settings.ragTopK = 5;
    if (typeof this.settings.dailyTokenLimit !== "number") this.settings.dailyTokenLimit = 1000000;
    if (typeof this.settings.recallSRSAlgorithm !== "string") this.settings.recallSRSAlgorithm = "sm2";
    if (typeof this.settings.recallNewCardsPerDay !== "number") this.settings.recallNewCardsPerDay = 20;
    if (typeof this.settings.recallReviewLimit !== "number") this.settings.recallReviewLimit = 100;
  }

  async saveSettings() { await this.saveData(this.settings); }

  async setUICollapsed(key: keyof UICollapsedState, value: boolean) {
    this.settings.uiCollapsed[key] = value;
    await this.saveSettings();
  }

  async saveCurrentTab(tab: RetrieveTab) {
    this.settings.currentTab = tab;
    await this.saveSettings();
  }

  // ════════════════════════════════════════════════════════════
  // Delegated Methods (供 View 层调用)
  // ════════════════════════════════════════════════════════════

  // ── View Activation ──
  async activateTaskCenter() { await this.viewManager.activateTaskCenter(); }
  async activateExpressView() { await this.viewManager.activateExpressView(); }
  async activateWikiEvolutionView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_WIKI_EVOLUTION)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建知识演化视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_WIKI_EVOLUTION, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
  async activateBacklinkView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CONNECT_BACKLINK)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建反向链接视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_CONNECT_BACKLINK, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
  async activateAnalysisView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_ANALYSIS)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建智能分析视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_ANALYSIS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
  async activateSmartExtractView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_SMART_EXTRACT)[0];
    if (!leaf) {
      const right = workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建智能萃取视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_SMART_EXTRACT, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
  showContextAwarenessPanel() { this.viewManager.showContextAwarenessPanel(); }
  showSmartAnalysisMenu() { this.viewManager.showSmartAnalysisMenu(); }
  showKnowledgeGaps() { this.viewManager.showKnowledgeGaps(); }

  // ── Pipeline ──
  async initializeStructure() { await initializeStructure(); }
  async migrateOldStructure() { return await migrateOldStructure(); }
  async collectFromClipboard(meta: Partial<PromptPayload>) { await collectFromClipboard(meta); }
  async processConversation(payload: PromptPayload) { await processConversation(payload); }
  async approveAction(id: string) { await approveAction(id); }
  async approveAllActions() { await approveAllActions(); }
  requestStop() { requestStop(); }
  async fillMissingBriefs() { await fillMissingBriefs(); }

  // ── Chat ──
  async refreshQuota() { await refreshQuota(); }
  async loadChatSessions() { await loadChatSessions(); }
  async createNewChatSession(title?: string) { return await createNewChatSession(title); }
  async deleteChatSession(id: string) { await deleteChatSession(id); }
  async renameChatSession(id: string, title: string) { await renameChatSession(id, title); }
  async exportChatSession(id: string) { return await exportChatSession(id); }
  async askChat(session: any, userMessage: string) { await askChat(session, userMessage); }

  // ── Capture UI ──
  renderCaptureMethods(parent: HTMLElement) { renderCaptureMethods(parent); }
  renderCaptureTab(parent: HTMLElement) { renderCaptureTab(parent); }
  renderRecallTab(parent: HTMLElement) { renderRecallTab(parent); }

  // ── TTS ──
  async speakVocab(text: string) { await speakVocab(this.ttsService, this.settings, text); }

  // ── File Utilities ──
  async ensureFolder(p: string) {
    const path = normalizePath(p);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }

  /** @deprecated 请直接使用 utils.ts 中的 safeFileName */
  safeFileName(name: string): string {
    return safeFileNameUtil(name);
  }

  async openFile(path: string) {
    if (!path) return;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    try { const leaf = this.app.workspace.getLeaf(false); await leaf.openFile(f); } catch {}
  }
}
