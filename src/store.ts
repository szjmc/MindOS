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
} from "./types";

export class TaskStore {
  private state: TaskState = this.defaultState();
  private listeners = new Set<() => void>();

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

  private emit() {
    for (const fn of this.listeners) fn();
  }
}