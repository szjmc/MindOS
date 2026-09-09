import {
  TaskState,
  TaskStatus,
  RoundProcessResult,
  WikiAction,
  ConversationRound,
  PromptPayload,
  PipelineState,
  PipelineStage,
  StageStatus,
  RoundCluster,
  DraftDoc,
  DiffDecision,
  RetrieveState,
  RetrieveTab,
  SearchMode,
  PageSearchResult,
  VectorizeProgress,
  VectorizeStatus,
  QuotaState,
  ChatSession,
  ChatMessage,
  RecallState,
  RecallSession,
  RecallCard,
  RecallDailyStats,
  RecallScenario,
  RecallScenarioConfig,
  RecallView_Mode,
  CardManagerFilter,
} from "./types";

// ═══════════════════════════════════════════════════════════
// TaskStore
// ═══════════════════════════════════════════════════════════

export class TaskStore {
  private state: TaskState = this.defaultState();
  private listeners = new Set<() => void>();
  private scheduledEmit = false;

  private defaultState(): TaskState {
    return {
      status: "idle",
      step: "",
      detail: "",
      error: "",
      logs: [],
      results: [],
      totalRounds: 0,
      doneRounds: 0,
      pendingActions: [],
      failedRounds: [],
      pipeline: this.defaultPipeline(),
    };
  }

  private defaultPipeline(): PipelineState {
    return {
      active: false,
      currentStage: "cluster",
      stages: {
        cluster: { status: "pending", detail: "" },
        draft: { status: "pending", detail: "" },
        diff: { status: "pending", detail: "" },
        execute: { status: "pending", detail: "" },
      },
      clusters: [],
      drafts: [],
      decisions: [],
    };
  }

  getState(): TaskState { return this.state; }

  reset() {
    this.state = this.defaultState();
    this.emit();
  }

  setStatus(status: TaskStatus, step = "", detail = "") {
    this.state.status = status;
    this.state.step = step;
    this.state.detail = detail;
    this.emit();
  }

  setError(error: string) {
    this.state.error = error;
    this.log(`❌ ${error}`);
    this.emit();
  }

  setTotalRounds(n: number) { this.state.totalRounds = n; this.emit(); }
  incrementDone() { this.state.doneRounds++; this.emit(); }

  log(message: string) {
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    this.state.logs.push(`[${ts}] ${message}`);
    if (this.state.logs.length > 500) this.state.logs.shift();
    this.emit();
  }

  addResult(item: RoundProcessResult) { this.state.results.push(item); this.emit(); }

  addPendingActions(actions: WikiAction[]) {
    this.state.pendingActions.push(...actions);
    this.emit();
  }

  removePendingAction(id: string) {
    this.state.pendingActions = this.state.pendingActions.filter((a) => a.id !== id);
    this.emit();
  }

  updateActionStatus(id: string, status: WikiAction["status"], error?: string) {
    const act = this.state.pendingActions.find((a) => a.id === id);
    if (act) {
      act.status = status;
      if (error) act.error = error;
    }
    this.emit();
  }

  clearPendingActions() {
    this.state.pendingActions = [];
    this.emit();
  }

  addFailedRound(round: ConversationRound, payload: PromptPayload) {
    this.state.failedRounds.push({ round, payload });
    this.emit();
  }

  clearFailedRounds() { this.state.failedRounds = []; this.emit(); }

  startPipeline() {
    this.state.pipeline = this.defaultPipeline();
    this.state.pipeline.active = true;
    this.emit();
  }

  setPipelineStage(stage: PipelineStage, status: StageStatus, detail: string) {
    this.state.pipeline.currentStage = stage;
    this.state.pipeline.stages[stage] = { status, detail };
    this.emit();
  }

  setPipelineClusters(clusters: RoundCluster[]) {
    this.state.pipeline.clusters = clusters;
    this.emit();
  }

  setPipelineDrafts(drafts: DraftDoc[]) {
    this.state.pipeline.drafts = drafts;
    this.emit();
  }

  setPipelineDecisions(decisions: DiffDecision[]) {
    this.state.pipeline.decisions = decisions;
    this.emit();
  }

  setPipelineFailed(error: string) {
    const cur = this.state.pipeline.currentStage;
    this.state.pipeline.stages[cur] = { status: "failed", detail: error };
    this.emit();
  }

  finishPipeline() {
    this.state.pipeline.active = false;
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** microtask 去抖：同一 tick 内的多次 setState 只触发一次 UI 刷新 */
  private emit() {
    if (this.scheduledEmit) return;
    this.scheduledEmit = true;
    Promise.resolve().then(() => {
      this.scheduledEmit = false;
      for (const fn of this.listeners) fn();
    });
  }
}

// ═══════════════════════════════════════════════════════════
// RetrieveStore
// ═══════════════════════════════════════════════════════════

export class RetrieveStore {
  private state: RetrieveState = this.defaultState();
  private listeners = new Set<() => void>();
  private logCallback: ((msg: string) => void) | null = null;
  private scheduledEmit = false;

  private defaultState(): RetrieveState {
    return {
      currentTab: "capture",
      searchQuery: "",
      searchMode: "page",
      searchResults: [],
      isSearching: false,
      searchError: "",
      vectorizeProgress: this.defaultProgress(),
      quota: this.defaultQuota(),
      currentSessionId: "",
      sessions: [],
      isChatting: false,
      chatStreamingContent: "",
      chatError: "",
    };
  }

  private defaultProgress(): VectorizeProgress {
    return {
      status: "idle",
      total: 0,
      done: 0,
      currentFile: "",
      errors: [],
      estimatedTokens: 0,
      actualTokens: 0,
    };
  }

  private defaultQuota(): QuotaState {
    return {
      dailyLimitTokens: 0,
      todayUsedTokens: 0,
      todayUsedCostCny: 0,
      history: [],
      lastResetDate: new Date().toISOString().substring(0, 10),
    };
  }

  getState(): RetrieveState { return this.state; }

  reset() {
    this.state = this.defaultState();
    this.emit();
  }

  setLogCallback(cb: (msg: string) => void) {
    this.logCallback = cb;
  }

  log(msg: string) {
    if (this.logCallback) this.logCallback(msg);
    else console.log(`[MindOS Retrieve] ${msg}`);
  }

  setTab(tab: RetrieveTab) {
    this.state.currentTab = tab;
    this.emit();
  }

  setSearchQuery(q: string) {
    this.state.searchQuery = q;
    this.emit();
  }

  setSearchMode(mode: SearchMode) {
    this.state.searchMode = mode;
    this.emit();
  }

  setSearching(b: boolean) {
    this.state.isSearching = b;
    if (b) this.state.searchError = "";
    this.emit();
  }

  setSearchResults(results: PageSearchResult[]) {
    this.state.searchResults = results;
    this.emit();
  }

  setSearchError(error: string) {
    this.state.searchError = error;
    this.state.isSearching = false;
    this.emit();
  }

  startVectorize(total: number, estimatedTokens: number) {
    this.state.vectorizeProgress = {
      status: "running",
      total,
      done: 0,
      currentFile: "",
      errors: [],
      startedAt: new Date().toISOString(),
      estimatedTokens,
      actualTokens: 0,
    };
    this.emit();
  }

  updateVectorizeProgress(done: number, currentFile: string, actualTokens?: number) {
    const p = this.state.vectorizeProgress;
    p.done = done;
    p.currentFile = currentFile;
    if (typeof actualTokens === "number") p.actualTokens = actualTokens;
    this.emit();
  }

  addVectorizeError(error: string) {
    this.state.vectorizeProgress.errors.push(error);
    this.emit();
  }

  finishVectorize(status: VectorizeStatus = "done") {
    this.state.vectorizeProgress.status = status;
    this.state.vectorizeProgress.finishedAt = new Date().toISOString();
    this.emit();
  }

  resetVectorizeProgress() {
    this.state.vectorizeProgress = this.defaultProgress();
    this.emit();
  }

  setQuota(quota: QuotaState) {
    this.state.quota = quota;
    this.emit();
  }

  setSessions(sessions: ChatSession[]) {
    this.state.sessions = sessions;
    this.emit();
  }

  setCurrentSessionId(id: string) {
    this.state.currentSessionId = id;
    this.emit();
  }

  upsertSession(session: ChatSession) {
    const idx = this.state.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.state.sessions[idx] = session;
    } else {
      this.state.sessions.unshift(session);
    }
    this.emit();
  }

  removeSession(id: string) {
    this.state.sessions = this.state.sessions.filter((s) => s.id !== id);
    if (this.state.currentSessionId === id) {
      this.state.currentSessionId = this.state.sessions[0]?.id ?? "";
    }
    this.emit();
  }

  appendMessageToSession(sessionId: string, message: ChatMessage) {
    const s = this.state.sessions.find((x) => x.id === sessionId);
    if (s) {
      s.messages.push(message);
      s.updatedAt = new Date().toISOString();
      this.emit();
    }
  }

  setChatting(b: boolean) {
    this.state.isChatting = b;
    if (b) this.state.chatError = "";
    this.emit();
  }

  setChatStreamingContent(content: string) {
    this.state.chatStreamingContent = content;
    this.emit();
  }

  appendChatStreamingContent(delta: string) {
    this.state.chatStreamingContent += delta;
    this.emit();
  }

  clearChatStreamingContent() {
    this.state.chatStreamingContent = "";
    this.emit();
  }

  setChatError(error: string) {
    this.state.chatError = error;
    this.state.isChatting = false;
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** microtask 去抖：同一 tick 内的多次 setState 只触发一次 UI 刷新 */
  private emit() {
    if (this.scheduledEmit) return;
    this.scheduledEmit = true;
    Promise.resolve().then(() => {
      this.scheduledEmit = false;
      for (const fn of this.listeners) fn();
    });
  }
}

// ═══════════════════════════════════════════════════════════
// RecallStore（v0.6 新增）
// ═══════════════════════════════════════════════════════════

export class RecallStore {
  private state: RecallState = this.defaultState();
  private listeners = new Set<() => void>();
  private scheduledEmit = false;

  private defaultState(): RecallState {
    return {
      currentSession: null,
      currentCard: null,
      currentCardIndex: 0,
      isFlipped: false,
      isGenerating: false,
      generateError: "",
      todayStats: null,
      selectedScenario: "wiki",
      scenarioConfig: {
        scenario: "wiki",
        label: "Wiki 复习",
        icon: "book-open",
        description: "基于你的知识库生成复习卡片",
        cardCount: 0,
        newCardCount: 0,
        totalCards: 0,
      },
      // ✅ v0.6 管理界面默认状态
      viewMode: "scenario_home",
      managerScenario: "wiki",
      managerFilter: {
        searchQuery: "",
        statusFilter: "all",
        tagFilter: "",
        sortBy: "updated_desc",
      },
      managerCards: [],
      managerSelectedIds: new Set<string>(),
    };
  }

  getState(): RecallState { return this.state; }

  /** 重新广播当前状态（外部数据变更后触发 UI 重渲染） */
  refresh() {
    this.emit();
  }

  reset() {
    this.state = this.defaultState();
    this.emit();
  }

  setSelectedScenario(scenario: RecallScenario) {
    this.state.selectedScenario = scenario;
    this.emit();
  }

  setScenarioConfig(config: RecallScenarioConfig) {
    this.state.scenarioConfig = config;
    this.emit();
  }

  startSession(session: RecallSession) {
    this.state.currentSession = session;
    this.state.currentCardIndex = 0;
    this.state.isFlipped = false;
    this.emit();
  }

  setCurrentCard(card: RecallCard | null, index: number) {
    this.state.currentCard = card;
    this.state.currentCardIndex = index;
    this.state.isFlipped = false;
    this.emit();
  }

  flipCard() {
    this.state.isFlipped = true;
    this.emit();
  }

  advanceSession(result: { cardId: string; rating: number; responseTimeMs: number }) {
    if (!this.state.currentSession) return;
    this.state.currentSession.doneCards++;
    if (result.rating >= 3) this.state.currentSession.correctCards++;
    this.state.currentSession.results.push({
      cardId: result.cardId,
      rating: result.rating as any,
      responseTimeMs: result.responseTimeMs,
      reviewedAt: new Date().toISOString(),
    });
    this.emit();
  }

  finishSession() {
    if (this.state.currentSession) {
      this.state.currentSession.finishedAt = new Date().toISOString();
    }
    this.state.currentCard = null;
    this.state.isFlipped = false;
    this.emit();
  }

  setGenerating(b: boolean, error = "") {
    this.state.isGenerating = b;
    this.state.generateError = error;
    this.emit();
  }

  setTodayStats(stats: RecallDailyStats | null) {
    this.state.todayStats = stats;
    this.emit();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** microtask 去抖：同一 tick 内的多次 setState 只触发一次 UI 刷新 */
  private emit() {
    if (this.scheduledEmit) return;
    this.scheduledEmit = true;
    Promise.resolve().then(() => {
      this.scheduledEmit = false;
      for (const fn of this.listeners) fn();
    });
  }

    // ════════════════════════════════════════════════════════════
  // v0.6 卡片管理 - 状态变更方法
  // ════════════════════════════════════════════════════════════

  setViewMode(mode: RecallView_Mode) {
    this.state.viewMode = mode;
    this.emit();
  }

  setManagerScenario(scenario: RecallScenario) {
    this.state.managerScenario = scenario;
    this.state.managerSelectedIds.clear();
    this.emit();
  }

  setManagerFilter(filter: Partial<CardManagerFilter>) {
    this.state.managerFilter = { ...this.state.managerFilter, ...filter };
    this.emit();
  }

  // ✅ 新增辅助方法（修复 view-recall 调用）
  setManagerSelectedIdsClear() {
    this.state.managerSelectedIds.clear();
    this.emit();
  }

  toggleSelectCard(id: string) {
    if (this.state.managerSelectedIds.has(id)) {
      this.state.managerSelectedIds.delete(id);
    } else {
      this.state.managerSelectedIds.add(id);
    }
    this.emit();
  }

  selectAllCards(ids: string[]) {
    this.state.managerSelectedIds = new Set(ids);
    this.emit();
  }

  clearSelectedCards() {
    this.state.managerSelectedIds.clear();
    this.emit();
  }
}