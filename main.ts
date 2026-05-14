import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import {
  VIEW_TYPE_AI_TASK_CENTER,
  DIR_RAW_CONVERSATIONS,
  DIR_RAW,
  DIR_WIKI,
  DIR_SCHEMA,
  FILE_INDEX,
  FILE_CLAUDE,
} from "./src/constants";
import {
  AIPromptCollectorSettings,
  PromptPayload,
  ConversationRound,
  ProtocolValue,
  WikiAction,
  UICollapsedState,
} from "./src/types";
import {
  normalizeText,
  decodeParam,
  simpleHash,
  nowISOString,
  parseFrontmatter,
  buildFrontmatter,
  truncateBrief,
} from "./src/utils";
import { TaskStore } from "./src/store";
import { SchemaManager } from "./src/schema-manager";
import { IndexManager } from "./src/index-manager";
import { AIClient } from "./src/ai-client";
import { ActionExecutor } from "./src/action-executor";
import { Migrator } from "./src/migrator";
import { WorkflowEngine } from "./src/workflow-engine";
import { AITaskCenterView } from "./src/view-task-center";
import { AIPromptCollectorSettingTab } from "./src/settings-tab";

const DEFAULT_UI_COLLAPSED: UICollapsedState = {
  quickStart: false,
  wikiStatus: false,
  schemaStatus: true,
  logs: true,
  results: false,
  pipeline: false,
};

const DEFAULT_SETTINGS: AIPromptCollectorSettings = {
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
};

export default class AIPromptCollectorPlugin extends Plugin {
  settings!: AIPromptCollectorSettings;
  taskStore = new TaskStore();
  schemaManager!: SchemaManager;
  indexManager!: IndexManager;
  aiClient!: AIClient;
  executor!: ActionExecutor;
  migrator!: Migrator;
  workflowEngine!: WorkflowEngine;

  private stopRequested = false;
  private currentRounds: ConversationRound[] | null = null;
  private currentPayload: PromptPayload | null = null;

  async onload() {
    await this.loadSettings();

    this.schemaManager = new SchemaManager(this.app, () => this.settings.baseFolder);
    this.indexManager = new IndexManager(
      this.app,
      () => this.settings.baseFolder,
      () => this.settings.indexAutoRebuildAfterN,
      () => this.settings.briefMaxLength,
    );
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
    this.migrator = new Migrator(this.app, () => this.settings.baseFolder);
    this.workflowEngine = new WorkflowEngine(
      this.app,
      () => this.settings,
      () => this.settings.baseFolder,
      this.aiClient,
      this.indexManager,
      this.taskStore,
      () => this.stopRequested,
    );

    this.registerView(VIEW_TYPE_AI_TASK_CENTER, (leaf) => new AITaskCenterView(leaf, this));

    this.addRibbonIcon("archive", "采集并整理 AI 对话", async () => {
      await this.collectFromClipboard({});
    });
    this.addRibbonIcon("blocks", "打开 AI 任务中心", async () => {
      await this.activateTaskCenter();
    });

    this.addCommand({
      id: "collect-ai-conversation",
      name: "采集并整理 AI 对话",
      callback: async () => await this.collectFromClipboard({}),
    });
    this.addCommand({
      id: "open-task-center",
      name: "打开 AI 任务中心",
      callback: async () => await this.activateTaskCenter(),
    });
    this.addCommand({
      id: "rebuild-wiki-index",
      name: "重建 Wiki INDEX",
      callback: async () => {
        const r = await this.indexManager.rebuild();
        new Notice(`已重建 INDEX：${r.count} 个页面`);
      },
    });
    this.addCommand({
      id: "fill-missing-briefs",
      name: "补全 Wiki 缺失的 brief",
      callback: async () => await this.fillMissingBriefs(),
    });
    this.addCommand({
      id: "init-llm-wiki",
      name: "初始化 LLM Wiki 结构",
      callback: async () => {
        await this.initializeStructure();
        new Notice("✅ 已初始化 LLM Wiki 结构");
      },
    });

    this.registerObsidianProtocolHandler("ai-prompt-collector", async (params) => {
      await this.handleProtocol(params as Record<string, ProtocolValue>);
    });

    this.addSettingTab(new AIPromptCollectorSettingTab(this.app, this));
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_AI_TASK_CENTER);
  }

  async loadSettings() {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
    if (!this.settings.uiCollapsed || typeof this.settings.uiCollapsed !== "object") {
      this.settings.uiCollapsed = { ...DEFAULT_UI_COLLAPSED };
    } else {
      this.settings.uiCollapsed = { ...DEFAULT_UI_COLLAPSED, ...this.settings.uiCollapsed };
    }
    if (typeof this.settings.candidateTopN !== "number") {
      this.settings.candidateTopN = 5;
    }
  }

  async saveSettings() { await this.saveData(this.settings); }

  async setUICollapsed(key: keyof UICollapsedState, value: boolean) {
    this.settings.uiCollapsed[key] = value;
    await this.saveSettings();
  }

  async activateTaskCenter() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_TASK_CENTER)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right) { new Notice("无法创建任务中心"); return; }
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE_AI_TASK_CENTER, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
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

    try {
      await this.initializeStructure();

      this.taskStore.setStatus("running", "解析回合", "正在解析对话内容");
      this.taskStore.log("ℹ️ 开始处理新对话");

      const rounds = this.parseRounds(payload.content);
      this.taskStore.log(`ℹ️ 识别到 ${rounds.length} 个回合`);
      if (rounds.length === 0) throw new Error("未识别到有效回合");
      this.taskStore.setTotalRounds(rounds.length);

      // 1. 合并存档所有回合到一个 raw 文件（带 ^锚点）
      const rawPath = await this.saveRawConversationMerged(rounds, payload);
      for (const r of rounds) {
        r.rawPath = rawPath;
        r.anchor = `round-${r.round}`;
      }
      this.taskStore.log(`📂 raw 已存档：${rawPath}`);

      // 2. 跑流水线
      const actions = await this.workflowEngine.runPipeline(rounds, payload);

      if (this.stopRequested) {
        this.taskStore.setStatus("done", "已中止", "用户中止处理");
        this.taskStore.finishPipeline();
        return;
      }

      // 3. 审核或自动执行
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.taskStore.log(`❌ ${a.title} 执行失败：${msg}`);
      }
    }
  }

  async retryFailedRounds() {
    new Notice("当前版本暂不支持回合级重试");
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
}