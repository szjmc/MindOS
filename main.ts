import { Notice, Plugin, TFile, normalizePath, setIcon } from "obsidian";
import {
  VIEW_TYPE_MINDOS,
  PROTOCOL_NAME,
  DIR_RAW_CONVERSATIONS,
  DIR_RAW,
  DIR_WIKI,
  DIR_SCHEMA,
  FILE_INDEX,
  FILE_CLAUDE,
  PAGE_TYPE_LABELS,
} from "./src/core/constants";
import {
  MindOSSettings,
  PromptPayload,
  ConversationRound,
  ProtocolValue,
  WikiAction,
  UICollapsedState,
  RetrieveTab,
  ChatSession,
  ChatMessage,
  ChatCitation,
  RecallCard,
} from "./src/core/types";
import {
  normalizeText,
  decodeParam,
  simpleHash,
  nowISOString,
  parseFrontmatter,
  buildFrontmatter,
  truncateBrief,
  generateUID,
} from "./src/core/utils";
import { TaskStore, RetrieveStore, RecallStore } from "./src/core/store";

// Pipeline 模块
import { SchemaManager } from "./src/modules/wiki/schema-manager";
import { IndexManager } from "./src/modules/wiki/index-manager";
import { Migrator } from "./src/modules/wiki/migrator";
import { AIClient } from "./src/modules/pipeline/ai-client";
import { ActionExecutor } from "./src/modules/pipeline/action-executor";
import { WorkflowEngine } from "./src/modules/pipeline/workflow-engine";

// Retrieve 模块 (v0.5)
import { EmbeddingClient } from "./src/modules/retrieve/embedding-client";
import { VectorStore } from "./src/modules/retrieve/vector-store";
import { EmbeddingManager } from "./src/modules/retrieve/embedding-manager";
import { SemanticSearch } from "./src/modules/retrieve/semantic-search";
import { RAGChat } from "./src/modules/retrieve/rag-chat";
import { QuotaManager } from "./src/modules/retrieve/quota-manager";
import { ChatSessionStore } from "./src/modules/retrieve/chat-session-store";

// Recall 核心 (v0.6)
import { RecallCardStore } from "./src/modules/recall/recall-card-store";
import { RecallView } from "./src/modules/recall/view-recall";
import { SRSEngine } from "./src/modules/recall/srs-engine";
import { AICardGenerator } from "./src/modules/recall/ai-card-generator";

// Recall 场景生成器
import { RecallWikiGenerator } from "./src/modules/recall/recall-wiki-generator";
import { RecallCommandGenerator } from "./src/modules/recall/recall-command-generator";
import { RecallVocabGenerator } from "./src/modules/recall/recall-vocab-generator";
import { RecallConceptGenerator } from "./src/modules/recall/recall-concept-generator";
import { RecallPhraseGenerator } from "./src/modules/recall/recall-phrase-generator";
import { WordListStore } from "./src/modules/recall/word-list-store";

// Recall 子模块
import { RecallCardManagerView } from "./src/modules/recall/recall-card-manager-view";

// 面试助手 (v0.6)
import { InterviewStore } from "./src/modules/recall/interview-store";
import { JDAnalyzer } from "./src/modules/recall/jd-analyzer";
import { GapAnalyzer } from "./src/modules/recall/gap-analyzer";
import { InterviewView } from "./src/modules/recall/interview-view";
import { MockInterviewer } from "./src/modules/recall/mock-interviewer";
import { MockInterviewView } from "./src/modules/recall/mock-interview-view";

// 自定义场景 (v0.6)
import { CustomScenarioStore } from "./src/modules/recall/custom-scenario-store";

// Dashboard (v0.6)
import { DashboardService } from "./src/modules/recall/dashboard-service";

// UI
import { MindOSRetrieveView } from "./src/modules/retrieve/view-retrieve";
import { MindOSSettingTab } from "./src/ui/settings-tab";

// ── v0.7 Express ──────────────────────────────────────────────────
import { ExpressView, EXPRESS_VIEW_TYPE } from "./src/modules/express/view-express";
import { ArticleStore } from "./src/modules/express/article-store";
import { OutlineBuilder } from "./src/modules/express/outline-builder";
import { ArticleGenerator } from "./src/modules/express/article-generator";

// ================================================================

const DEFAULT_UI_COLLAPSED: UICollapsedState = {
  quickStart: false,
  wikiStatus: false,
  schemaStatus: true,
  logs: true,
  results: false,
  pipeline: false,
};

const DEFAULT_SETTINGS: MindOSSettings = {
  baseFolder: "Knowledge Base",
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

  autoVectorize: true,
  autoVectorizeThreshold: 5,

  searchTopK: 10,
  searchMinScore: 0.5,

  ragEnabled: true,
  ragTopK: 5,
  ragTemperature: 0.3,
  ragMaxContextTokens: 4000,
  ragStreaming: true,

  dailyTokenLimit: 1000000,
  warnOnHighCost: true,
  costPerMillionTokensEmbedding: 0.7,
  costPerMillionTokensChat: 1.0,

  chatExportFolder: "wiki/topics",
  chatExportCustomPath: "",

  recallSRSAlgorithm: "sm2",
  recallNewCardsPerDay: 20,
  recallReviewLimit: 100,
  recallAutoGenerate: false,
};

export default class MindOSPlugin extends Plugin {
  settings!: MindOSSettings;

  // Stores
  taskStore = new TaskStore();
  retrieveStore = new RetrieveStore();
  recallStore = new RecallStore();

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

  // v0.7 Express ──────────────────────────────────────────────────
  articleStore!: ArticleStore;
  outlineBuilder!: OutlineBuilder;
  articleGenerator!: ArticleGenerator;

  private stopRequested = false;
  private currentRounds: ConversationRound[] | null = null;
  private currentPayload: PromptPayload | null = null;

  async onload() {
    await this.loadSettings();

    this.retrieveStore.setLogCallback((msg) => console.log(`[MindOS] ${msg}`));

    // ── 1. Wiki / Pipeline 模块 ──
    this.schemaManager = new SchemaManager(this.app, () => this.settings.baseFolder);
    this.indexManager = new IndexManager(
      this.app,
      () => this.settings.baseFolder,
      () => this.settings.indexAutoRebuildAfterN,
      () => this.settings.briefMaxLength,
    );
    this.migrator = new Migrator(this.app, () => this.settings.baseFolder);

    this.aiClient = new AIClient(
      () => this.settings,
      () => this.schemaManager.readClaudeMd(),
      () => this.indexManager.readIndex(),
      (msg) => this.taskStore.log(msg),
    );
    this.executor = new ActionExecutor(
      this.app,
      () => this.settings,
      () => this.settings.baseFolder,
      this.indexManager,
      (msg) => this.taskStore.log(msg),
    );
    this.workflowEngine = new WorkflowEngine(
      this.app,
      () => this.settings,
      () => this.settings.baseFolder,
      this.aiClient,
      this.indexManager,
      this.taskStore,
      () => this.stopRequested,
    );

    // ── 2. Retrieve 模块 (v0.5) ──
    this.quotaManager = new QuotaManager(
      this.app,
      () => this.settings.baseFolder,
      () => this.settings.dailyTokenLimit,
    );
    this.embeddingClient = new EmbeddingClient(
      () => this.settings,
      (msg) => this.retrieveStore.log(msg),
    );
    this.vectorStore = new VectorStore(this.app, () => this.settings.baseFolder);
    this.embeddingManager = new EmbeddingManager(
      this.app,
      () => this.settings,
      this.vectorStore,
      this.embeddingClient,
      this.quotaManager,
      this.indexManager,
      this.retrieveStore,
      (msg) => this.retrieveStore.log(msg),
    );
    this.semanticSearch = new SemanticSearch(
      () => this.settings,
      this.vectorStore,
      this.embeddingClient,
      this.quotaManager,
      (msg) => this.retrieveStore.log(msg),
    );
    this.ragChat = new RAGChat(
      () => this.settings,
      this.semanticSearch,
      this.quotaManager,
      (msg) => this.retrieveStore.log(msg),
    );
    this.chatSessionStore = new ChatSessionStore(
      this.app,
      () => this.settings.baseFolder,
      () => this.settings,
    );

    // ── 3. Recall 核心 (v0.6) ──
    this.srsEngine = new SRSEngine(this.settings.recallSRSAlgorithm ?? "sm2");
    this.recallCardStore = new RecallCardStore(
      this.app,
      () => this.settings.baseFolder,
    );
    this.aiCardGenerator = new AICardGenerator(
      () => this.settings,
      this.quotaManager,
      (msg) => this.retrieveStore.log(msg),
    );
    await this.recallCardStore.initialize();

    // ── 4. Recall 场景生成器 ──
    this.recallWikiGenerator = new RecallWikiGenerator(
      this.app,
      () => this.settings,
      this.indexManager,
      this.recallCardStore,
      (msg) => this.retrieveStore.log(msg),
    );
    this.recallCommandGenerator = new RecallCommandGenerator(
      this.app,
      () => this.settings,
      this.indexManager,
      this.recallCardStore,
      this.aiCardGenerator,
      (msg) => this.retrieveStore.log(msg),
    );

    this.wordListStore = new WordListStore(this.app, () => this.settings.baseFolder);
    await this.wordListStore.initialize();

    this.vocabGenerator = new RecallVocabGenerator(
      this.app,
      () => this.settings,
      this.recallCardStore,
      this.wordListStore,
      this.aiCardGenerator,
      (msg) => this.retrieveStore.log(msg),
    );
    this.conceptGenerator = new RecallConceptGenerator(
      this.app,
      () => this.settings,
      this.indexManager,
      this.recallCardStore,
      this.aiCardGenerator,
      (msg) => this.retrieveStore.log(msg),
    );
    this.phraseGenerator = new RecallPhraseGenerator(
      this.app,
      () => this.settings,
      this.recallCardStore,
      this.aiCardGenerator,
      (msg) => this.retrieveStore.log(msg),
    );

    // ── 5. 面试助手 ──
    this.interviewStore = new InterviewStore(this.app, () => this.settings.baseFolder);
    await this.interviewStore.initialize();

    this.jdAnalyzer = new JDAnalyzer(
      this.aiCardGenerator,
      this.interviewStore,
      (msg) => this.retrieveStore.log(msg),
    );
    this.gapAnalyzer = new GapAnalyzer(
      this.semanticSearch,
      this.interviewStore,
      (msg) => this.retrieveStore.log(msg),
    );
    this.mockInterviewer = new MockInterviewer(
      () => this.settings,
      this.aiCardGenerator,
      this.interviewStore,
      this.semanticSearch,
      (msg) => this.retrieveStore.log(msg),
    );

    // ── 6. 自定义场景 ──
    this.customScenarioStore = new CustomScenarioStore(this.app, () => this.settings.baseFolder);
    await this.customScenarioStore.initialize();

    // ── 7. Dashboard ──
    this.dashboardService = new DashboardService(
      this.app,
      () => this.settings.baseFolder,
      this.recallCardStore,
    );

    // ── 8. Express 模块 (v0.7) ──────────────────────────────────
    this.articleStore = new ArticleStore(
      this.app,
      this.settings.baseFolder,
    );

    const aiAdapter = this.buildAIClientAdapter();

    // 将真实 SemanticSearch 包装为 SemanticSearchLike
    // 真实签名: search(query, options?) => Promise<PageSearchResult[]>
    // 目标签名: search(query, topK)     => Promise<{content,filePath,score}[]>
    const semanticSearchAdapter = this.semanticSearch
      ? {
          search: async (
            query: string,
            topK: number
          ): Promise<Array<{ content: string; filePath: string; score: number }>> => {
            const results = await this.semanticSearch!.search(query, { topK });
            return results.map((r: any) => ({
              content:  r.content  ?? r.chunk   ?? r.text   ?? '',
              filePath: r.filePath ?? r.path    ?? r.file   ?? '',
              score:    typeof r.score === 'number' ? r.score : 0,
            }));
          }
        }
      : null;

    this.outlineBuilder = new OutlineBuilder(
      this.app,
      aiAdapter,
      this.settings.baseFolder,
      semanticSearchAdapter,   // ← 传适配器，不传原始 semanticSearch
    );

    this.articleGenerator = new ArticleGenerator(aiAdapter);
    // ────────────────────────────────────────────────────────────

    // ── 9. View 实例（必须在所有依赖之后）──
    this.recallView = new RecallView(this);
    this.cardManagerView = new RecallCardManagerView(this);
    this.interviewView = new InterviewView(this);
    this.mockInterviewView = new MockInterviewView(this);

    // 加载今日统计
    const todayStats = await this.recallCardStore.getTodayStats();
    this.recallStore.setTodayStats(todayStats);

    // ── 10. 注册 View ──
    this.registerView(VIEW_TYPE_MINDOS, (leaf) => new MindOSRetrieveView(leaf, this));
    this.registerView(EXPRESS_VIEW_TYPE, (leaf) => new ExpressView(leaf, this)); // v0.7

    // ── 11. Ribbon & Commands ──
    this.addRibbonIcon("brain-circuit", "MindOS - 采集对话", async () => {
      await this.collectFromClipboard({});
    });
    this.addRibbonIcon("blocks", "MindOS - 任务中心", async () => {
      await this.activateTaskCenter();
    });
    this.addRibbonIcon("file-text", "MindOS - Express 输出", async () => { // v0.7
      await this.activateExpressView();
    });

    // 基础命令
    this.addCommand({ id: "mindos-collect", name: "采集并整理 AI 对话", callback: async () => await this.collectFromClipboard({}) });
    this.addCommand({ id: "mindos-open-center", name: "打开任务中心", callback: async () => await this.activateTaskCenter() });
    this.addCommand({ id: "mindos-rebuild-index", name: "重建 Wiki INDEX", callback: async () => { const r = await this.indexManager.rebuild(); new Notice(`已重建 INDEX：${r.count} 个页面`); } });
    this.addCommand({ id: "mindos-fill-briefs", name: "补全 Wiki 缺失的 brief", callback: async () => await this.fillMissingBriefs() });
    this.addCommand({ id: "mindos-init", name: "初始化 MindOS 三层结构", callback: async () => { await this.initializeStructure(); new Notice("✅ 已初始化 MindOS 结构"); } });

    // v0.5 命令
    this.addCommand({ id: "mindos-vectorize-all", name: "全量向量化索引", callback: async () => { const r = await this.embeddingManager.vectorizeAll(); new Notice(r.message); } });
    this.addCommand({ id: "mindos-sync-incremental", name: "增量同步向量索引", callback: async () => { const r = await this.embeddingManager.syncIncremental(); new Notice(r.message); } });
    this.addCommand({ id: "mindos-open-search", name: "打开语义检索", callback: async () => { await this.activateTaskCenter(); this.retrieveStore.setTab("search"); } });
    this.addCommand({ id: "mindos-open-chat", name: "打开 RAG 问答", callback: async () => { await this.activateTaskCenter(); this.retrieveStore.setTab("chat"); } });

    // v0.6 命令
    this.addCommand({ id: "mindos-open-recall", name: "打开复习模块", callback: async () => { await this.activateTaskCenter(); this.retrieveStore.setTab("recall"); } });
    this.addCommand({
      id: "mindos-recall-dashboard",
      name: "打开学习数据看板",
      callback: async () => {
        const { DashboardView } = await import("./src/modules/recall/dashboard-view");
        const modal = new DashboardView(this.app, this.dashboardService);
        modal.open();
      },
    });
    this.addCommand({
      id: "mindos-recall-card-manager",
      name: "打开卡片管理面板",
      callback: async () => {
        await this.activateTaskCenter();
        this.retrieveStore.setTab("recall");
        this.recallStore.setManagerScenario("wiki");
        this.recallStore.setViewMode("card_manager");
      },
    });
    this.addCommand({
      id: "mindos-recall-interview",
      name: "打开面试助手",
      callback: async () => {
        await this.activateTaskCenter();
        this.retrieveStore.setTab("recall");
        this.recallStore.setSelectedScenario("interview");
      },
    });

    // v0.7 命令 ──────────────────────────────────────────────────
    this.addCommand({
      id: "mindos-open-express",
      name: "打开 Express 输出",
      callback: async () => await this.activateExpressView(),
    });
    // ────────────────────────────────────────────────────────────

    // ── 12. Protocol Handler ──
    this.registerObsidianProtocolHandler(PROTOCOL_NAME, async (params) => {
      await this.handleProtocol(params as Record<string, ProtocolValue>);
    });

    // ── 13. Settings ──
    this.addSettingTab(new MindOSSettingTab(this.app, this));

    // ── 14. 自动向量化监听 ──
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.autoVectorize) {
          const path = file.path;
          if (path.includes(`/${DIR_WIKI}/`) || path.includes(`/${DIR_RAW}/`)) {
            this.embeddingManager.notifyFileChanged(path);
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
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINDOS);
    this.app.workspace.detachLeavesOfType(EXPRESS_VIEW_TYPE); // v0.7
    this.recallView?.unload();
    this.interviewView?.unload();
    this.mockInterviewView?.unload();
  }

  // ════════════════════════════════════════════════════════════
  // v0.7 Express 核心方法
  // ════════════════════════════════════════════════════════════

  /**
   * 激活 Express 输出视图（右侧面板）
   */
  async activateExpressView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(EXPRESS_VIEW_TYPE)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建 Express 视图"); return; }
      leaf = right;
      await leaf.setViewState({ type: EXPRESS_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * 将现有 aiClient 适配为 StreamAIClientLike 接口
   *
   * - 若 aiClient 已实现 chatStream → 直接透传
   * - 若只有 chat（非流式）         → 包装为模拟流式（分段回调）
   * - 若未配置 AI                   → 返回占位对象（调用时抛出友好错误）
   */
  buildAIClientAdapter(): {
    chat: (system: string, user: string, signal?: AbortSignal) => Promise<string>;
    chatStream: (system: string, user: string, onToken: (t: string) => void, signal?: AbortSignal) => Promise<string>;
  } {
    const ai = this.aiClient;

    // 未配置 AI
    if (!ai) {
      return {
        async chat(): Promise<string> {
          throw new Error("请先在 MindOS 设置中配置 AI Provider（apiKey + model）");
        },
        async chatStream(): Promise<string> {
          throw new Error("请先在 MindOS 设置中配置 AI Provider（apiKey + model）");
        },
      };
    }

    // aiClient 已原生支持 chatStream → 直接透传
    if (typeof (ai as any).chatStream === "function") {
      return {
        chat: (ai as any).chat.bind(ai),
        chatStream: (ai as any).chatStream.bind(ai),
      };
    }

    // 用普通 chat 模拟流式（分段回调，视觉上有流式感）
    return {
      chat: async (
        systemPrompt: string,
        userMessage: string,
        signal?: AbortSignal,
      ): Promise<string> => {
        return await (ai as any).chat(systemPrompt, userMessage, signal);
      },
      chatStream: async (
        systemPrompt: string,
        userMessage: string,
        onToken: (token: string) => void,
        signal?: AbortSignal,
      ): Promise<string> => {
        const result: string = await (ai as any).chat(systemPrompt, userMessage, signal);
        // 每 20 字回调一次，模拟流式效果
        const chunkSize = 20;
        for (let i = 0; i < result.length; i += chunkSize) {
          if (signal?.aborted) break;
          onToken(result.slice(i, i + chunkSize));
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return result;
      },
    };
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
  // View Activation
  // ════════════════════════════════════════════════════════════
  async activateTaskCenter() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDOS)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建任务中心"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_MINDOS, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  // ════════════════════════════════════════════════════════════
  // Wiki / Pipeline 业务方法
  // ════════════════════════════════════════════════════════════

  async initializeStructure() {
    await this.ensureFolder(`${this.settings.baseFolder}/${DIR_RAW}`);
    await this.ensureFolder(`${this.settings.baseFolder}/${DIR_RAW_CONVERSATIONS}`);
    await this.ensureFolder(`${this.settings.baseFolder}/${DIR_WIKI}`);
    await this.ensureFolder(`${this.settings.baseFolder}/${DIR_SCHEMA}`);
    await this.schemaManager.initialize();
    await this.indexManager.rebuild();
  }

  async migrateOldStructure() {
    return await this.migrator.migrate();
  }

  private readClipboardText(): string {
    try {
      const { clipboard } = require("electron");
      return String(clipboard.readText() ?? "");
    } catch { return ""; }
  }

  async collectFromClipboard(meta: Partial<PromptPayload>) {
    const text = normalizeText(this.readClipboardText());
    if (!text) { new Notice("剪贴板为空"); return; }
    await this.processConversation({
      source: meta.source ?? "clipboard",
      title: meta.title,
      pageTitle: meta.pageTitle,
      url: meta.url,
      content: text,
    });
  }

  async handleProtocol(params: Record<string, ProtocolValue>) {
    const mode = (decodeParam(params.mode) || "clipboard").toLowerCase();
    const source = decodeParam(params.source) || "browser";
    const title = decodeParam(params.title) || "";
    const pageTitle = decodeParam(params.page_title) || decodeParam(params.pageTitle) || "";
    const url = decodeParam(params.page_url) || decodeParam(params.url) || "";

    if (mode === "clipboard") {
      await this.collectFromClipboard({ source, title, pageTitle, url });
      return;
    }

    const content = normalizeText(decodeParam(params.content));
    if (!content) { new Notice("协议中无内容"); return; }
    await this.processConversation({ source, title, pageTitle, url, content });
  }

  async processConversation(payload: PromptPayload) {
    await this.activateTaskCenter();
    this.taskStore.reset();
    this.stopRequested = false;
    this.retrieveStore.setTab("capture");

    try {
      await this.initializeStructure();

      this.taskStore.setStatus("running", "解析回合", "正在解析对话内容");
      this.taskStore.log("ℹ️ 开始处理新对话");

      const rounds = this.parseRounds(payload.content);
      this.taskStore.log(`ℹ️ 识别到 ${rounds.length} 个回合`);
      if (rounds.length === 0) throw new Error("未识别到有效回合");
      this.taskStore.setTotalRounds(rounds.length);

      const rawPath = await this.saveRawConversationMerged(rounds, payload);
      for (const r of rounds) {
        r.rawPath = rawPath;
        r.anchor = `round-${r.round}`;
      }
      this.taskStore.log(`📂 raw 已存档：${rawPath}`);

      const actions = await this.workflowEngine.runPipeline(rounds, payload);

      if (this.stopRequested) {
        this.taskStore.setStatus("done", "已中止", "用户中止处理");
        this.taskStore.finishPipeline();
        return;
      }

      this.currentRounds = rounds;
      this.currentPayload = payload;

      if (this.settings.reviewMode) {
        if (actions.length === 0) {
          this.taskStore.setStatus("done", "完成", "无需执行任何动作");
        } else {
          this.taskStore.addPendingActions(actions);
          this.taskStore.setStatus("awaiting_review", "等待审核", `共 ${actions.length} 个动作待审核`);
        }
      } else {
        await this.executeAllActions(actions, rounds, payload);
        this.taskStore.setStatus("done", "完成", "所有动作已执行");
      }

      this.taskStore.finishPipeline();
      this.taskStore.addResult({
        round: 0,
        rawFilePath: rawPath,
        actions,
        summary: `处理完成：${actions.length} 个动作`,
      });

      for (const a of actions) {
        if (a.op === "create" && a.path) {
          this.embeddingManager.notifyFileChanged(a.path);
        }
      }

      new Notice(`✅ 处理完成（${actions.length} 个动作）`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.taskStore.setStatus("error", "失败", msg);
      this.taskStore.setError(msg);
      this.taskStore.finishPipeline();
      new Notice("❌ 处理失败，请查看任务中心");
    }
  }

  async approveAction(id: string) {
    if (!this.currentRounds || !this.currentPayload) {
      new Notice("没有可执行的上下文");
      return;
    }
    const state = this.taskStore.getState();
    const a = state.pendingActions.find((x) => x.id === id);
    if (!a) return;

    try {
      await this.executor.execute(a, this.currentRounds, this.currentPayload);
      this.taskStore.log(`✅ ${a.op.toUpperCase()} ${a.title}`);
      if (this.settings.openAfterSave && a.op === "create" && a.path) {
        await this.openFile(a.path);
      }
      if (a.path) this.embeddingManager.notifyFileChanged(a.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.taskStore.log(`❌ 执行失败：${a.title} - ${msg}`);
    }
    this.taskStore.removePendingAction(id);

    if (this.taskStore.getState().pendingActions.length === 0) {
      this.taskStore.setStatus("done", "完成", "所有 action 已处理");
    }
  }

  async approveAllActions() {
    if (!this.currentRounds || !this.currentPayload) {
      new Notice("没有可执行的上下文");
      return;
    }
    const actions = [...this.taskStore.getState().pendingActions];
    await this.executeAllActions(actions, this.currentRounds, this.currentPayload);
    this.taskStore.clearPendingActions();
    this.taskStore.setStatus("done", "完成", "全部 actions 执行完毕");
  }

  private async executeAllActions(
    actions: WikiAction[],
    rounds: ConversationRound[],
    payload: PromptPayload,
  ) {
    for (const a of actions) {
      try {
        await this.executor.execute(a, rounds, payload);
        this.taskStore.log(`✅ ${a.op.toUpperCase()} ${a.title}`);
        if (a.path) this.embeddingManager.notifyFileChanged(a.path);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.taskStore.log(`❌ ${a.title} 执行失败：${msg}`);
      }
    }
  }

  requestStop() {
    this.stopRequested = true;
    this.taskStore.log("⏹ 用户请求中止");
  }

  async fillMissingBriefs() {
    const pages = await this.indexManager.scanAllWikiPages();
    const missing = pages.filter((p) => !p.brief);
    if (missing.length === 0) {
      new Notice("✅ 所有页面都有 brief");
      return;
    }
    this.taskStore.log(`🤖 开始补全 ${missing.length} 个页面的 brief`);
    let done = 0;
    for (const p of missing) {
      const file = this.app.vault.getAbstractFileByPath(p.path);
      if (!(file instanceof TFile)) continue;
      try {
        const content = await this.app.vault.read(file);
        const { frontmatter, body } = parseFrontmatter(content);
        const brief = await this.aiClient.generateBrief(p.title, body, this.settings.briefMaxLength);
        frontmatter.brief = truncateBrief(brief, this.settings.briefMaxLength);
        const newFm = buildFrontmatter(frontmatter);
        await this.app.vault.modify(file, `${newFm}\n${body}`);
        this.taskStore.log(`✅ ${p.title} → ${frontmatter.brief}`);
        done++;
        this.embeddingManager.notifyFileChanged(p.path);
      } catch (e) {
        this.taskStore.log(`❌ ${p.title} 失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.indexManager.rebuild();
    new Notice(`补全完成：${done}/${missing.length}`);
  }

  private async saveRawConversationMerged(
    rounds: ConversationRound[],
    payload: PromptPayload,
  ): Promise<string> {
    const folder = `${this.settings.baseFolder}/${DIR_RAW_CONVERSATIONS}`;
    await this.ensureFolder(folder);
    const ts = new Date().toISOString().replace(/[-:T]/g, "").substring(0, 15);
    const titlePart = (payload.pageTitle || payload.source || "对话").substring(0, 20);
    const fileName = this.safeFileName(`${ts}-${titlePart}`);
    const path = normalizePath(`${folder}/${fileName}.md`);

    const fm = buildFrontmatter({
      source: payload.source ?? "unknown",
      url: payload.url ?? "",
      page_title: payload.pageTitle ?? "",
      collected_at: nowISOString(),
      total_rounds: rounds.length,
      tags: ["raw", "conversation"],
    });

    const sections = rounds.map((r) =>
      `## 回合 ${r.round} ^round-${r.round}\n\n### 用户\n\n${r.user || "(空)"}\n\n### AI\n\n${r.ai || "(空)"}`
    ).join("\n\n---\n\n");

    const content = `${fm}\n\n# 原始对话存档\n\n> 来源：${payload.source ?? "unknown"} | 共 ${rounds.length} 回合\n> 采集时间：${nowISOString()}\n\n---\n\n${sections}\n`;

    try {
      await this.app.vault.create(path, content);
    } catch (e) {}
    return path;
  }

  parseRounds(content: string): ConversationRound[] {
    const text = normalizeText(content);
    const sections = text.split(/\n(?=###\s*第?\s*\d+\s*回合)/g).filter(Boolean);

    if (sections.length > 0 && sections.some((s) => /##\s*用户/.test(s))) {
      const rounds: ConversationRound[] = [];
      sections.forEach((sec, i) => {
        const userMatch = sec.match(/##\s*用户\s*\n([\s\S]*?)(?=\n##\s*AI\b|\s*$)/);
        const aiMatch = sec.match(/##\s*AI\s*\n([\s\S]*?)$/);
        const user = normalizeText(userMatch?.[1] || "");
        const ai = normalizeText(aiMatch?.[1] || "");
        if (!user && !ai) return;
        rounds.push({
          round: i + 1, user, ai, raw: normalizeText(sec),
          hash: simpleHash(`${user}\n---\n${ai}`),
        });
      });
      if (rounds.length > 0) return rounds;
    }

    const regex = /##\s*用户\s*\n([\s\S]*?)(?=\n##\s*AI\b)\n##\s*AI\s*\n([\s\S]*?)(?=\n##\s*用户|\s*$)/g;
    const rounds: ConversationRound[] = [];
    let m: RegExpExecArray | null;
    let i = 1;
    while ((m = regex.exec(text)) !== null) {
      const user = normalizeText(m[1]);
      const ai = normalizeText(m[2]);
      rounds.push({
        round: i++, user, ai,
        raw: `## 用户\n${user}\n\n## AI\n${ai}`,
        hash: simpleHash(`${user}\n---\n${ai}`),
      });
    }
    if (rounds.length > 0) return rounds;

    return [{ round: 1, user: text, ai: "", raw: text, hash: simpleHash(text) }];
  }

  // ── Retrieve Helpers ──
  async refreshQuota() {
    const state = await this.quotaManager.getCurrentState();
    this.retrieveStore.setQuota(state);
  }

  async loadChatSessions() {
    const sessions = await this.chatSessionStore.getAll();
    this.retrieveStore.setSessions(sessions);
    if (sessions.length > 0 && !this.retrieveStore.getState().currentSessionId) {
      this.retrieveStore.setCurrentSessionId(sessions[0].id);
    }
  }

  async createNewChatSession(title?: string): Promise<ChatSession> {
    const s = await this.chatSessionStore.create(title);
    this.retrieveStore.upsertSession(s);
    this.retrieveStore.setCurrentSessionId(s.id);
    return s;
  }

  async deleteChatSession(id: string) {
    await this.chatSessionStore.delete(id);
    this.retrieveStore.removeSession(id);
  }

  async renameChatSession(id: string, title: string) {
    await this.chatSessionStore.renameSession(id, title);
    const s = await this.chatSessionStore.getById(id);
    if (s) this.retrieveStore.upsertSession(s);
  }

  async exportChatSession(id: string): Promise<string> {
    return await this.chatSessionStore.exportToNote(id);
  }

  async askChat(session: ChatSession, userMessage: string) {
    console.log("[MindOS] askChat 开始", { sessionId: session.id });
    this.retrieveStore.setChatting(true);
    this.retrieveStore.clearChatStreamingContent();

    const userMsg: ChatMessage = {
      id: generateUID(),
      role: "user",
      content: userMessage,
      createdAt: nowISOString(),
    };

    try {
      await this.chatSessionStore.appendMessage(session.id, userMsg);
      this.retrieveStore.upsertSession(session);
    } catch (e) {
      this.retrieveStore.setChatError(`保存用户消息失败：${e}`);
      this.retrieveStore.setChatting(false);
      return;
    }

    const aiMsgId = generateUID();
    let citations: ChatCitation[] = [];
    let accumulatedContent = "";
    let aiMsgFinalized = false;

    const finalizeAiMessage = async (content: string, tokens: number, isError = false, errorMsg = "") => {
      if (aiMsgFinalized) return;
      aiMsgFinalized = true;

      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: "assistant",
        content: isError
          ? (content || "(无回答)") + `\n\n*[错误: ${errorMsg}]*`
          : content || "(空回答)",
        citations,
        createdAt: nowISOString(),
        tokens: tokens || undefined,
      };

      try {
        await this.chatSessionStore.appendMessage(session.id, aiMsg);
        const fresh = await this.chatSessionStore.getById(session.id);
        if (fresh) {
          this.retrieveStore.upsertSession({
            ...fresh,
            messages: [...fresh.messages],
          });
        }

        setTimeout(() => {
          this.retrieveStore.clearChatStreamingContent();
          this.retrieveStore.setChatting(false);
          if (isError) this.retrieveStore.setChatError(errorMsg);
        }, 50);

        await this.refreshQuota();
      } catch (e) {
        this.retrieveStore.clearChatStreamingContent();
        this.retrieveStore.setChatting(false);
        this.retrieveStore.setChatError(`保存 AI 回答失败：${e}`);
      }
    };

    try {
      await this.ragChat.ask(session, userMessage, {
        onStart: () => {},
        onToken: (delta) => {
          accumulatedContent += delta;
          this.retrieveStore.appendChatStreamingContent(delta);
        },
        onCitations: (cits) => { citations = cits; },
        onDone: async (content, tokens) => {
          const finalContent = (content || accumulatedContent || "").replace(/\n\n\*（已中止）\*/, "");
          await finalizeAiMessage(finalContent, tokens);
        },
        onError: async (err) => {
          await finalizeAiMessage(accumulatedContent, 0, true, err);
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!aiMsgFinalized) {
        await finalizeAiMessage(accumulatedContent, 0, true, msg);
      }
    }
  }

  // ── 采集 Tab + Recall Tab 渲染入口 ──
  renderCaptureTab(parent: HTMLElement) {
    const state = this.taskStore.getState();
    const banner = parent.createDiv({ cls: `mindos-banner status-${state.status}` });
    const head = banner.createDiv({ cls: "mindos-banner-head" });
    const iconEl = head.createSpan({ cls: "mindos-banner-icon" });
    setIcon(iconEl, this.getStatusIcon(state.status));
    const textWrap = head.createDiv({ cls: "mindos-banner-text" });
    textWrap.createDiv({ cls: "mindos-banner-title", text: this.getStatusTitle(state.status) });
    textWrap.createDiv({ cls: "mindos-banner-detail", text: state.detail || this.getStatusHint(state.status) });

    if (state.error) {
      const errBox = banner.createDiv({ cls: "mindos-banner-error" });
      const ei = errBox.createSpan({ cls: "mindos-banner-error-icon" });
      setIcon(ei, "alert-circle");
      errBox.createSpan({ text: state.error });
    }

    const actions = banner.createDiv({ cls: "mindos-banner-actions" });
    if (state.status === "awaiting_review") {
      const approveAll = actions.createEl("button", { cls: "mindos-btn-large is-primary" });
      setIcon(approveAll.createSpan(), "check-check");
      approveAll.createSpan({ text: ` 全部批准 (${state.pendingActions.length})` });
      approveAll.onclick = () => this.approveAllActions();

      const rejectAll = actions.createEl("button", { cls: "mindos-btn-large is-ghost" });
      setIcon(rejectAll.createSpan(), "x");
      rejectAll.createSpan({ text: " 全部拒绝" });
      rejectAll.onclick = () => {
        this.taskStore.clearPendingActions();
        this.taskStore.setStatus("done", "已拒绝", "用户拒绝了所有 actions");
      };
    } else if (state.status === "running") {
      const stopBtn = actions.createEl("button", { cls: "mindos-btn-large is-danger" });
      setIcon(stopBtn.createSpan(), "square");
      stopBtn.createSpan({ text: " 中止" });
      stopBtn.onclick = () => this.requestStop();
    } else if (state.status === "done" || state.status === "idle") {
      const newBtn = actions.createEl("button", { cls: "mindos-btn-large is-primary" });
      setIcon(newBtn.createSpan(), "clipboard-paste");
      newBtn.createSpan({ text: " 从剪贴板采集" });
      newBtn.onclick = async () => await this.collectFromClipboard({});
      if (state.status === "done") {
        const clearBtn = actions.createEl("button", { cls: "mindos-btn-large is-ghost" });
        setIcon(clearBtn.createSpan(), "eraser");
        clearBtn.createSpan({ text: " 清空" });
        clearBtn.onclick = () => this.taskStore.reset();
      }
    } else if (state.status === "error") {
      const clearBtn = actions.createEl("button", { cls: "mindos-btn-large is-ghost" });
      setIcon(clearBtn.createSpan(), "trash-2");
      clearBtn.createSpan({ text: " 清空" });
      clearBtn.onclick = () => this.taskStore.reset();
    }

    if (state.pipeline.active || state.pipeline.clusters.length > 0) {
      const pipelineCard = parent.createDiv({ cls: "mindos-pipeline-card" });
      const pHead = pipelineCard.createDiv({ cls: "mindos-pipeline-head" });
      const pti = pHead.createSpan({ cls: "mindos-pipeline-title-icon" });
      setIcon(pti, "git-branch");
      pHead.createSpan({ cls: "mindos-pipeline-title", text: "智能合并流水线" });
      const stages: Array<{ key: any; label: string }> = [
        { key: "cluster", label: "回合聚类" },
        { key: "draft", label: "整理草稿" },
        { key: "diff", label: "差异比对" },
        { key: "execute", label: "执行动作" },
      ];
      const stagesWrap = pipelineCard.createDiv({ cls: "mindos-pipeline-stages" });
      stages.forEach((s, i) => {
        const stageData = state.pipeline.stages[s.key as keyof typeof state.pipeline.stages];
        const status = stageData?.status ?? "pending";
        const stageEl = stagesWrap.createDiv({ cls: `mindos-pipeline-stage status-${status}` });
        const numEl = stageEl.createDiv({ cls: "mindos-pipeline-stage-num" });
        if (status === "done") setIcon(numEl, "check");
        else if (status === "running") setIcon(numEl, "loader-2");
        else if (status === "failed") setIcon(numEl, "x");
        else numEl.setText(String(i + 1));
        const txt = stageEl.createDiv({ cls: "mindos-pipeline-stage-text" });
        txt.createDiv({ cls: "mindos-pipeline-stage-label", text: s.label });
        if (stageData?.detail) {
          txt.createDiv({ cls: "mindos-pipeline-stage-detail", text: stageData.detail });
        }
      });
      if (state.pipeline.clusters.length > 0) {
        const summary = pipelineCard.createDiv({ cls: "mindos-pipeline-summary" });
        summary.createDiv({
          text: `📊 聚类 ${state.pipeline.clusters.length} 组 · 草稿 ${state.pipeline.drafts.length} 份 · 决策 ${state.pipeline.decisions.length} 项`,
        });
      }
    }

    if (state.pendingActions.length > 0) {
      const section = parent.createDiv({ cls: "mindos-section" });
      const sHead = section.createDiv({ cls: "mindos-section-head" });
      const sti = sHead.createSpan({ cls: "mindos-section-icon" });
      setIcon(sti, "list-todo");
      sHead.createSpan({ cls: "mindos-section-title", text: "待审核动作" });
      sHead.createSpan({ cls: "mindos-section-badge", text: String(state.pendingActions.length) });
      const list = section.createDiv({ cls: "mindos-action-list" });
      for (const a of state.pendingActions) {
        const card = list.createDiv({ cls: `mindos-action-card op-${a.op}` });
        const cHead = card.createDiv({ cls: "mindos-action-card-head" });
        const opBadge = cHead.createDiv({ cls: `mindos-op-badge op-${a.op}` });
        setIcon(opBadge.createSpan(), this.getOpIcon(a.op));
        opBadge.createSpan({ text: this.getOpLabel(a.op) });
        cHead.createDiv({ cls: "mindos-action-type-label", text: PAGE_TYPE_LABELS[a.pageType] ?? a.pageType });
        const headOps = cHead.createDiv({ cls: "mindos-action-card-ops" });
        const approveBtn = headOps.createEl("button", { cls: "mindos-mini-btn is-success" });
        setIcon(approveBtn, "check");
        approveBtn.onclick = () => this.approveAction(a.id);
        const rejectBtn = headOps.createEl("button", { cls: "mindos-mini-btn" });
        setIcon(rejectBtn, "x");
        rejectBtn.onclick = () => this.taskStore.removePendingAction(a.id);
        card.createDiv({ cls: "mindos-action-card-title", text: a.title });
        if (a.brief) card.createDiv({ cls: "mindos-action-card-brief", text: a.brief });
        if (a.reason) card.createDiv({ cls: "mindos-action-card-reason", text: `💭 ${a.reason}` });
        if (a.sourceRounds && a.sourceRounds.length > 0) {
          card.createDiv({ cls: "mindos-action-card-rounds", text: `来自回合: ${a.sourceRounds.join(", ")}` });
        }
      }
    }

    if (state.logs.length > 0) {
      const logSection = parent.createDiv({ cls: "mindos-section" });
      const lHead = logSection.createDiv({ cls: "mindos-section-head" });
      const lti = lHead.createSpan({ cls: "mindos-section-icon" });
      setIcon(lti, "scroll-text");
      lHead.createSpan({ cls: "mindos-section-title", text: "日志" });
      lHead.createSpan({ cls: "mindos-section-badge", text: String(state.logs.length) });
      const box = logSection.createDiv({ cls: "mindos-log-box" });
      state.logs.slice(-50).forEach((line) => {
        const el = box.createEl("div", { cls: "mindos-log-line" });
        let levelCls = "log-default";
        if (line.includes("❌")) levelCls = "log-error";
        else if (line.includes("✅")) levelCls = "log-success";
        else if (line.includes("⚠️")) levelCls = "log-warn";
        else if (line.includes("ℹ️") || line.includes("→") || line.includes("📂")) levelCls = "log-info";
        el.addClass(levelCls);
        el.setText(line);
      });
    }

    if (state.results.length > 0) {
      const rSection = parent.createDiv({ cls: "mindos-section" });
      const rHead = rSection.createDiv({ cls: "mindos-section-head" });
      const rti = rHead.createSpan({ cls: "mindos-section-icon" });
      setIcon(rti, "list-checks");
      rHead.createSpan({ cls: "mindos-section-title", text: "处理结果" });
      rHead.createSpan({ cls: "mindos-section-badge", text: String(state.results.length) });
      const list = rSection.createDiv({ cls: "mindos-result-list" });
      for (const r of [...state.results].reverse()) {
        const item = list.createDiv({ cls: `mindos-result-card${r.error ? " is-error" : ""}` });
        const iHead = item.createDiv({ cls: "mindos-result-card-head" });
        iHead.createSpan({ cls: "mindos-result-summary", text: r.summary || "(无摘要)" });
        if (r.actions.length > 0) {
          iHead.createSpan({ cls: "mindos-action-count-tag", text: `${r.actions.length} 动作` });
        }
        const links = item.createDiv({ cls: "mindos-result-files" });
        const rawLink = links.createDiv({ cls: "mindos-file-link" });
        const ri = rawLink.createSpan({ cls: "mindos-file-link-icon" });
        setIcon(ri, "file-input");
        const rawPathSpan = rawLink.createSpan({ cls: "mindos-file-link-path", text: r.rawFilePath });
        rawPathSpan.onclick = () => this.openFile(r.rawFilePath);
        for (const a of r.actions) {
          if (!a.path) continue;
          const fl = links.createDiv({ cls: "mindos-file-link" });
          const fi = fl.createSpan({ cls: "mindos-file-link-icon" });
          setIcon(fi, this.getOpIcon(a.op));
          const titleSpan = fl.createSpan({ cls: "mindos-file-link-title", text: a.title });
          titleSpan.onclick = () => this.openFile(a.path);
        }
      }
    }
  }

  renderRecallTab(parent: HTMLElement) {
    this.recallView.render(parent);
  }

  // ── Utilities ──
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

  safeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/\.+$/g, "").trim() || "未命名";
  }

  async openFile(path: string) {
    if (!path) return;
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    try {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(f);
    } catch {}
  }

  async openSchemaFile() {
    const path = `${this.settings.baseFolder}/${FILE_CLAUDE}`;
    await this.openFile(normalizePath(path));
  }

  async openIndexFile() {
    const path = `${this.settings.baseFolder}/${FILE_INDEX}`;
    await this.openFile(normalizePath(path));
  }

  private getStatusIcon(s: string): string {
    return ({ idle: "moon", running: "loader-2", awaiting_review: "clipboard-check", done: "check-circle-2", error: "alert-octagon" } as any)[s] ?? "circle";
  }

  private getStatusTitle(s: string): string {
    return ({ idle: "待机", running: "处理中…", awaiting_review: "⚡ 等待审核", done: "✓ 已完成", error: "✗ 出错" } as any)[s] ?? s;
  }

  private getStatusHint(s: string): string {
    return ({ idle: "点击下方按钮从剪贴板采集对话", running: "AI 正在工作…", awaiting_review: "请审核 AI 决策后批准", done: "本轮处理结束", error: "请查看错误信息" } as any)[s] ?? "";
  }

  private getOpIcon(op: string): string {
    return ({ create: "file-plus", update: "file-edit", append_section: "list-plus", link: "link" } as any)[op] ?? "file";
  }

  private getOpLabel(op: string): string {
    return ({ create: "新建", update: "更新", append_section: "追加", link: "链接" } as any)[op] ?? op;
  }
}