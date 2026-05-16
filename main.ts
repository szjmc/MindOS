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

// Recall 模块 (v0.6)
import { RecallCardStore } from "./src/modules/recall/recall-card-store";
import { RecallWikiGenerator } from "./src/modules/recall/recall-wiki-generator";
import { RecallView } from "./src/modules/recall/view-recall";
import { SRSEngine } from "./src/modules/recall/srs-engine";

// UI
import { MindOSRetrieveView } from "./src/modules/retrieve/view-retrieve";
import { MindOSSettingTab } from "./src/ui/settings-tab";

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

  // Chat
  apiBaseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.1,
  timeoutMs: 60000,
  maxRetries: 2,
  concurrency: 2,

  // Wiki
  injectClaudeMd: true,
  injectIndexMd: true,
  reviewMode: true,
  indexAutoRebuildAfterN: 10,
  briefMaxLength: 30,

  // UI
  uiCollapsed: { ...DEFAULT_UI_COLLAPSED },
  candidateTopN: 5,
  currentTab: "capture",

  // v0.5 - Embedding
  embeddingProvider: "openai",
  embeddingApiBaseUrl: "https://api.openai.com/v1",
  embeddingApiKey: "",
  embeddingModel: "text-embedding-3-small",
  embeddingDim: 0,
  embeddingBatchSize: 50,
  embeddingChunkMaxChars: 800,
  embeddingChunkMinChars: 100,

  // v0.5 - Auto Vectorize
  autoVectorize: true,
  autoVectorizeThreshold: 5,

  // v0.5 - Search
  searchTopK: 10,
  searchMinScore: 0.5,

  // v0.5 - RAG
  ragEnabled: true,
  ragTopK: 5,
  ragTemperature: 0.3,
  ragMaxContextTokens: 4000,
  ragStreaming: true,

  // v0.5 - Quota
  dailyTokenLimit: 1000000,
  warnOnHighCost: true,
  costPerMillionTokensEmbedding: 0.15,
  costPerMillionTokensChat: 1.0,

  // v0.5 - Export
  chatExportFolder: "wiki/topics",
  chatExportCustomPath: "",

  // v0.6 - Recall
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

  // Core Modules
  schemaManager!: SchemaManager;
  indexManager!: IndexManager;
  migrator!: Migrator;
  aiClient!: AIClient;
  executor!: ActionExecutor;
  workflowEngine!: WorkflowEngine;

  // Retrieve Modules (v0.5)
  embeddingClient!: EmbeddingClient;
  vectorStore!: VectorStore;
  embeddingManager!: EmbeddingManager;
  semanticSearch!: SemanticSearch;
  ragChat!: RAGChat;
  quotaManager!: QuotaManager;
  chatSessionStore!: ChatSessionStore;

  // Recall Modules (v0.6)
  recallCardStore!: RecallCardStore;
  recallWikiGenerator!: RecallWikiGenerator;
  recallView!: RecallView;
  srsEngine!: SRSEngine;
  currentRecallCards: RecallCard[] = [];

  private stopRequested = false;
  private currentRounds: ConversationRound[] | null = null;
  private currentPayload: PromptPayload | null = null;

  async onload() {
    await this.loadSettings();

    // 让 retrieveStore 可以输出日志到 console
    this.retrieveStore.setLogCallback((msg) => console.log(`[MindOS] ${msg}`));

    // 1. 初始化基础模块
    this.schemaManager = new SchemaManager(this.app, () => this.settings.baseFolder);
    this.indexManager = new IndexManager(
      this.app,
      () => this.settings.baseFolder,
      () => this.settings.indexAutoRebuildAfterN,
      () => this.settings.briefMaxLength,
    );
    this.migrator = new Migrator(this.app, () => this.settings.baseFolder);

    // 2. 初始化 Pipeline 模块
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

    // 3. 初始化 Retrieve 模块 (v0.5)
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

    // 4. 初始化 Recall 模块 (v0.6)
    this.srsEngine = new SRSEngine(this.settings.recallSRSAlgorithm ?? "sm2");
    this.recallCardStore = new RecallCardStore(
      this.app,
      () => this.settings.baseFolder,
    );
    this.recallWikiGenerator = new RecallWikiGenerator(
      this.app,
      () => this.settings,
      this.indexManager,
      this.recallCardStore,
      (msg) => this.retrieveStore.log(msg),
    );
    this.recallView = new RecallView(this);

    // 初始化 Recall 存储目录
    await this.recallCardStore.initialize();

    // 加载今日统计
    const todayStats = await this.recallCardStore.getTodayStats();
    this.recallStore.setTodayStats(todayStats);

    // 5. 注册 View
    this.registerView(VIEW_TYPE_MINDOS, (leaf) => new MindOSRetrieveView(leaf, this));

    // 6. Ribbon & Commands
    this.addRibbonIcon("brain-circuit", "MindOS - 采集对话", async () => {
      await this.collectFromClipboard({});
    });
    this.addRibbonIcon("blocks", "MindOS - 任务中心", async () => {
      await this.activateTaskCenter();
    });

    this.addCommand({ id: "mindos-collect", name: "采集并整理 AI 对话", callback: async () => await this.collectFromClipboard({}) });
    this.addCommand({ id: "mindos-open-center", name: "打开任务中心", callback: async () => await this.activateTaskCenter() });
    this.addCommand({ id: "mindos-rebuild-index", name: "重建 Wiki INDEX", callback: async () => { const r = await this.indexManager.rebuild(); new Notice(`已重建 INDEX：${r.count} 个页面`); } });
    this.addCommand({ id: "mindos-fill-briefs", name: "补全 Wiki 缺失的 brief", callback: async () => await this.fillMissingBriefs() });
    this.addCommand({ id: "mindos-init", name: "初始化 MindOS 三层结构", callback: async () => { await this.initializeStructure(); new Notice("✅ 已初始化 MindOS 结构"); } });

    // v0.5 Commands
    this.addCommand({ id: "mindos-vectorize-all", name: "全量向量化索引", callback: async () => { const r = await this.embeddingManager.vectorizeAll(); new Notice(r.message); } });
    this.addCommand({ id: "mindos-sync-incremental", name: "增量同步向量索引", callback: async () => { const r = await this.embeddingManager.syncIncremental(); new Notice(r.message); } });
    this.addCommand({ id: "mindos-open-search", name: "打开语义检索", callback: async () => { await this.activateTaskCenter(); this.retrieveStore.setTab("search"); } });
    this.addCommand({ id: "mindos-open-chat", name: "打开 RAG 问答", callback: async () => { await this.activateTaskCenter(); this.retrieveStore.setTab("chat"); } });

    // v0.6 Recall Commands
    this.addCommand({
      id: "mindos-open-recall",
      name: "打开复习模块",
      callback: async () => {
        await this.activateTaskCenter();
        this.retrieveStore.setTab("recall");
      },
    });
    this.addCommand({
      id: "mindos-recall-generate-wiki",
      name: "从 Wiki 生成复习卡片",
      callback: async () => {
        await this.activateTaskCenter();
        this.retrieveStore.setTab("recall");
        new Notice("请在复习面板中点击「生成卡片」");
      },
    });

    // 7. Protocol Handler
    this.registerObsidianProtocolHandler(PROTOCOL_NAME, async (params) => {
      await this.handleProtocol(params as Record<string, ProtocolValue>);
    });

    // 8. Settings
    this.addSettingTab(new MindOSSettingTab(this.app, this));

    // 9. 自动向量化监听 (v0.5)
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
    this.recallView?.unload();
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
  // Structure & Migration
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

  // ════════════════════════════════════════════════════════════
  // Collection (Pipeline)
  // ════════════════════════════════════════════════════════════
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
    } catch (e) {
      // 已存在则忽略
    }
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

  // ════════════════════════════════════════════════════════════
  // v0.5 - Retrieve Helpers (供 view-retrieve 调用)
  // ════════════════════════════════════════════════════════════
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
    console.log("[MindOS] askChat 开始", { sessionId: session.id, message: userMessage.substring(0, 50) });

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
      // ✅ 重新拿最新 session 对象（避免引用问题）
      const freshSession = await this.chatSessionStore.getById(session.id);
      if (freshSession) {
        this.retrieveStore.upsertSession(freshSession);
      }
      console.log("[MindOS] 用户消息已推入");
    } catch (e) {
      console.error("[MindOS] 用户消息推入失败", e);
      this.retrieveStore.setChatError(`保存用户消息失败：${e}`);
      this.retrieveStore.setChatting(false);
      return;
    }

    const aiMsgId = generateUID();
    let citations: ChatCitation[] = [];
    let accumulatedContent = "";
    let aiMsgFinalized = false;

    const finalizeAiMessage = async (content: string, tokens: number, isError = false, errorMsg = "") => {
      if (aiMsgFinalized) {
        console.warn("[MindOS] finalizeAiMessage 重复调用，跳过");
        return;
      }
      aiMsgFinalized = true;

      console.log("[MindOS] finalizeAiMessage", { contentLen: content.length, isError });

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
        // ✅ 1. 先持久化
        await this.chatSessionStore.appendMessage(session.id, aiMsg);
        console.log("[MindOS] AI 消息已写入文件");

        // ✅ 2. 重新从 store 拉最新 session（确保拿到 push 后的状态）
        const freshSession = await this.chatSessionStore.getById(session.id);
        if (freshSession) {
          console.log("[MindOS] 最新 session 消息数:", freshSession.messages.length);
          // ✅ 3. 用全新对象触发 store 更新（确保引用变化）
          this.retrieveStore.upsertSession({
            ...freshSession,
            messages: [...freshSession.messages],
          });
        }

        // ✅ 4. 最后才清流式内容（让 UI 在切换间无缝过渡）
        // 用 setTimeout 确保 React-like 的 emit 完成后再清
        setTimeout(() => {
          this.retrieveStore.clearChatStreamingContent();
          this.retrieveStore.setChatting(false);
          if (isError) {
            this.retrieveStore.setChatError(errorMsg);
          }
        }, 50);

        await this.refreshQuota();
      } catch (e) {
        console.error("[MindOS] AI 消息推入失败", e);
        this.retrieveStore.clearChatStreamingContent();
        this.retrieveStore.setChatting(false);
        this.retrieveStore.setChatError(`保存 AI 回答失败：${e}`);
      }
    };

    try {
      await this.ragChat.ask(session, userMessage, {
        onStart: () => {
          console.log("[MindOS] RAG onStart");
        },
        onToken: (delta) => {
          accumulatedContent += delta;
          this.retrieveStore.appendChatStreamingContent(delta);
        },
        onCitations: (cits) => {
          console.log("[MindOS] RAG onCitations", { count: cits.length });
          citations = cits;
        },
        onDone: async (content, tokens) => {
          console.log("[MindOS] RAG onDone", { contentLen: content.length, tokens });
          const finalContent = (content || accumulatedContent || "").replace(/\n\n\*（已中止）\*/, "");
          await finalizeAiMessage(finalContent, tokens);
        },
        onError: async (err) => {
          console.error("[MindOS] RAG onError", err);
          await finalizeAiMessage(accumulatedContent, 0, true, err);
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[MindOS] askChat 顶层异常", e);
      if (!aiMsgFinalized) {
        await finalizeAiMessage(accumulatedContent, 0, true, msg);
      }
    }

    console.log("[MindOS] askChat 完成");
  }
  // ════════════════════════════════════════════════════════════
  // 采集 Tab 渲染（供 view-retrieve 调用）
  // ════════════════════════════════════════════════════════════
  renderCaptureTab(parent: HTMLElement) {
    const state = this.taskStore.getState();

    // 1. 状态横幅
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

    // 2. 流水线面板
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

    // 3. 待审核动作
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
        approveBtn.setAttribute("title", "批准");
        approveBtn.onclick = () => this.approveAction(a.id);
        const rejectBtn = headOps.createEl("button", { cls: "mindos-mini-btn" });
        setIcon(rejectBtn, "x");
        rejectBtn.setAttribute("title", "拒绝");
        rejectBtn.onclick = () => this.taskStore.removePendingAction(a.id);

        card.createDiv({ cls: "mindos-action-card-title", text: a.title });
        if (a.brief) card.createDiv({ cls: "mindos-action-card-brief", text: a.brief });
        if (a.reason) {
          const r = card.createDiv({ cls: "mindos-action-card-reason" });
          r.createSpan({ text: `💭 ${a.reason}` });
        }
        if (a.sourceRounds && a.sourceRounds.length > 0) {
          card.createDiv({ cls: "mindos-action-card-rounds", text: `来自回合: ${a.sourceRounds.join(", ")}` });
        }
      }
    }

    // 4. 日志
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
        else if (line.includes("ℹ️") || line.includes("→") || line.includes("📂") || line.includes("·")) levelCls = "log-info";
        el.addClass(levelCls);
        el.setText(line);
      });
    }

    // 5. 处理结果
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

  // ════════════════════════════════════════════════════════════
  // v0.6 - Recall Tab 渲染（供 view-retrieve 调用）
  // ════════════════════════════════════════════════════════════
  renderRecallTab(parent: HTMLElement) {
    this.recallView.render(parent);
  }

  // ════════════════════════════════════════════════════════════
  // Utilities
  // ════════════════════════════════════════════════════════════
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
    return name
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "")
      .trim() || "未命名";
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