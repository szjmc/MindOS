import { TaskStore } from "../../core/store";
import { PipelineStage, StageStatus } from "../../core/types";

export class TaskProgressView {
  private container: HTMLElement;
  private progressBar!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressLabel!: HTMLElement;
  private stagesContainer!: HTMLElement;
  private logsContainer!: HTMLElement;
  private stageIcons: Record<PipelineStage, string> = {
    cluster: "🔍",
    draft: "📝",
    diff: "🔄",
    execute: "🚀",
  };

  private stageLabels: Record<PipelineStage, string> = {
    cluster: "聚类分析",
    draft: "草稿生成",
    diff: "差异比对",
    execute: "动作生成",
  };

  constructor(container: HTMLElement, private taskStore: TaskStore) {
    this.container = container;
    this.render();
    this.subscribeToStore();
  }

  private render(): void {
    this.container.empty();
    this.container.addClass("mindos-task-progress");

    const header = this.container.createDiv({ cls: "progress-header" });
    header.createEl("h3", { cls: "progress-title", text: "📊 任务进度" });

    const progressWrap = this.container.createDiv({ cls: "progress-bar-wrap" });
    this.progressBar = progressWrap.createDiv({ cls: "progress-bar" });
    this.progressFill = this.progressBar.createDiv({ cls: "progress-fill" });
    this.progressLabel = progressWrap.createEl("span", { cls: "progress-label" });

    this.stagesContainer = this.container.createDiv({ cls: "stages-container" });

    const logsHeader = this.container.createDiv({ cls: "logs-header" });
    logsHeader.createEl("span", { cls: "logs-title", text: "📋 执行日志" });
    this.logsContainer = this.container.createDiv({ cls: "logs-container" });
  }

  private subscribeToStore(): void {
    this.taskStore.subscribe(() => {
      this.updateProgress();
      this.updateStages();
      this.updateLogs();
    });
  }

  private updateProgress(): void {
    const state = this.taskStore.getState();
    const { totalRounds, doneRounds } = state;
    
    if (totalRounds > 0) {
      const percent = Math.round((doneRounds / totalRounds) * 100);
      this.progressFill.style.width = `${percent}%`;
      this.progressLabel.textContent = `${doneRounds} / ${totalRounds} (${percent}%)`;
    } else {
      this.progressFill.style.width = "0%";
      this.progressLabel.textContent = "准备就绪";
    }
  }

  private updateStages(): void {
    const state = this.taskStore.getState();
    const pipeline = state.pipeline;
    
    this.stagesContainer.empty();
    
    const stages: PipelineStage[] = ["cluster", "draft", "diff", "execute"];
    let currentStageIndex = stages.indexOf(pipeline.currentStage);

    stages.forEach((stage, index) => {
      const stageInfo = pipeline.stages[stage];
      const stageEl = this.stagesContainer.createDiv({ cls: "stage-item" });
      
      const icon = stageEl.createEl("span", { cls: "stage-icon" });
      icon.textContent = this.stageIcons[stage];
      
      const label = stageEl.createEl("span", { cls: "stage-label" });
      label.textContent = this.stageLabels[stage];
      
      const status = stageEl.createEl("span", { cls: "stage-status" });
      status.textContent = this.getStatusText(stageInfo.status);
      
      if (stageInfo.status === "running") {
        stageEl.addClass("is-running");
      } else if (stageInfo.status === "done") {
        stageEl.addClass("is-done");
      } else if (stageInfo.status === "failed") {
        stageEl.addClass("is-failed");
      } else if (index > currentStageIndex) {
        stageEl.addClass("is-pending");
      }
      
      if (stageInfo.detail && stageInfo.status !== "pending") {
        const detail = stageEl.createEl("span", { cls: "stage-detail" });
        detail.textContent = stageInfo.detail;
      }
      
      if (index < stages.length - 1) {
        const arrow = this.stagesContainer.createEl("span", { cls: "stage-arrow" });
        arrow.textContent = "→";
        if (stageInfo.status === "done") {
          arrow.addClass("arrow-done");
        }
      }
    });
  }

  private getStatusText(status: StageStatus): string {
    const map: Record<StageStatus, string> = {
      pending: "等待",
      running: "进行中",
      done: "完成",
      failed: "失败",
    };
    return map[status];
  }

  private updateLogs(): void {
    const state = this.taskStore.getState();
    const logs = state.logs;
    
    this.logsContainer.empty();
    
    logs.forEach((log) => {
      const logEl = this.logsContainer.createEl("div", { cls: "log-item" });
      logEl.textContent = log;
      
      if (log.includes("✅")) {
        logEl.addClass("log-success");
      } else if (log.includes("❌")) {
        logEl.addClass("log-error");
      } else if (log.includes("·")) {
        logEl.addClass("log-detail");
      }
    });
    
    this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
  }

  destroy(): void {
    this.container.empty();
  }
}