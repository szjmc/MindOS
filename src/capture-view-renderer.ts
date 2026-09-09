/**
 * Capture Tab 渲染器 —— 从 main.ts 提取
 * 负责采集方式网格 + 状态横幅 + 流水线 + 审核列表 + 日志 + 结果
 */
import { setIcon } from "obsidian";
import { PAGE_TYPE_LABELS, PLUGIN_NAME } from "./core/constants";
import { TaskProgressView } from "./modules/pipeline";

export interface CaptureRendererDeps {
  taskStore: any;
  captureService: any;
  recallView: any;
  plugin: any;
  approveAction: (id: string) => void;
  approveAllActions: () => void;
  requestStop: () => void;
  openFile: (path: string) => void;
}

let _deps: CaptureRendererDeps | null = null;

export function setCaptureDeps(d: CaptureRendererDeps) { _deps = d; }

function d(): CaptureRendererDeps { return _deps!; }

// ── 状态图标 / 标题 ──

function getStatusIcon(s: string): string {
  return ({ idle: "moon", running: "loader-2", awaiting_review: "clipboard-check", done: "check-circle-2", error: "alert-octagon" } as any)[s] ?? "circle";
}

function getStatusTitle(s: string): string {
  return ({ idle: "待机", running: "处理中…", awaiting_review: "⚡ 等待审核", done: "✓ 已完成", error: "✗ 出错" } as any)[s] ?? s;
}

function getStatusHint(s: string): string {
  return ({ idle: "点击下方按钮从剪贴板采集对话", running: "AI 正在工作…", awaiting_review: "请审核 AI 决策后批准", done: "本轮处理结束", error: "请查看错误信息" } as any)[s] ?? "";
}

function getOpIcon(op: string): string {
  return ({ create: "file-plus", update: "file-edit", append_section: "list-plus", link: "link" } as any)[op] ?? "file";
}

function getOpLabel(op: string): string {
  return ({ create: "新建", update: "更新", append_section: "追加", link: "链接" } as any)[op] ?? op;
}

// ── 顶部品牌栏 ──

export function renderTopBar(parent: HTMLElement): void {
  const bar = parent.createDiv({ cls: "mindos-topbar" });

  const left = bar.createDiv({ cls: "mindos-topbar-left" });
  const titleWrap = left.createDiv({ cls: "mindos-brand" });
  const iconEl = titleWrap.createSpan({ cls: "mindos-brand-icon" });
  setIcon(iconEl, "brain-circuit");
  titleWrap.createSpan({ cls: "mindos-brand-text", text: PLUGIN_NAME });
  titleWrap.createSpan({
    cls: "mindos-version-tag",
    text: `v${d().plugin.manifest.version}`,
  });

  const right = bar.createDiv({ cls: "mindos-topbar-right" });
  const settingsBtn = right.createEl("button", { cls: "mindos-icon-btn" });
  settingsBtn.setAttribute("aria-label", "设置");
  settingsBtn.setAttribute("title", "设置");
  setIcon(settingsBtn, "settings");
  settingsBtn.onclick = () => {
    // @ts-ignore
    d().plugin.app.setting.open();
    // @ts-ignore
    d().plugin.app.setting.openTabById(d().plugin.manifest.id);
  };
}

// ── 采集方式网格 ──

export function renderCaptureMethods(parent: HTMLElement): void {
  const { captureService } = d();
  const methods = captureService.getCaptureMethods();
  const captureMethods = methods.filter((m: any) => m.category === "capture");

  if (captureMethods.length > 0) {
    const captureSection = parent.createDiv({ cls: "mindos-capture-section" });
    captureSection.createEl("p", {
      cls: "mindos-capture-section-title",
      text: "采集方式",
    });

    const captureGrid = parent.createDiv({ cls: "mindos-capture-grid" });
    for (const method of captureMethods) {
      const card = captureGrid.createDiv({
        cls: `mindos-capture-card${method.disabled ? " is-disabled" : ""}`,
      });

      const iconWrap = card.createDiv({ cls: "mindos-capture-icon" });
      iconWrap.style.background = method.color;
      setIcon(iconWrap, method.icon);

      const content = card.createDiv({ cls: "mindos-capture-content" });
      const header = content.createDiv({ cls: "mindos-capture-header" });
      header.createEl("span", { cls: "mindos-capture-title", text: method.label });

      if (method.beta) {
        header.createEl("span", { cls: "mindos-capture-badge", text: "Beta" });
      }

      content.createEl("p", { cls: "mindos-capture-desc", text: method.description });

      if (!method.disabled) {
        card.onclick = () => captureService.executeCapture(method.id);
      }
    }
  }
}

// ── Capture Tab 主渲染 ──

export function renderCaptureTab(parent: HTMLElement): void {
  const { taskStore } = d();
  const state = taskStore.getState();

  // 显示采集方式选择
  if (state.status === "idle" || state.status === "done") {
    renderCaptureMethods(parent);
  }

  // 状态横幅
  const banner = parent.createDiv({ cls: `mindos-banner status-${state.status}` });
  const head = banner.createDiv({ cls: "mindos-banner-head" });
  const iconEl = head.createSpan({ cls: "mindos-banner-icon" });
  setIcon(iconEl, getStatusIcon(state.status));
  const textWrap = head.createDiv({ cls: "mindos-banner-text" });
  textWrap.createDiv({ cls: "mindos-banner-title", text: getStatusTitle(state.status) });
  textWrap.createDiv({ cls: "mindos-banner-detail", text: state.detail || getStatusHint(state.status) });

  if (state.error) {
    const errBox = banner.createDiv({ cls: "mindos-banner-error" });
    const ei = errBox.createSpan({ cls: "mindos-banner-error-icon" });
    setIcon(ei, "alert-circle");
    errBox.createSpan({ text: state.error });
  }

  // 操作按钮
  const actions = banner.createDiv({ cls: "mindos-banner-actions" });
  if (state.status === "awaiting_review") {
    const approveAll = actions.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(approveAll.createSpan(), "check-check");
    approveAll.createSpan({ text: ` 全部批准 (${state.pendingActions.length})` });
    approveAll.onclick = () => d().approveAllActions();

    const rejectAll = actions.createEl("button", { cls: "mindos-btn-large is-ghost" });
    setIcon(rejectAll.createSpan(), "x");
    rejectAll.createSpan({ text: " 全部拒绝" });
    rejectAll.onclick = () => {
      taskStore.clearPendingActions();
      taskStore.setStatus("done", "已拒绝", "用户拒绝了所有 actions");
    };
  } else if (state.status === "running") {
    const stopBtn = actions.createEl("button", { cls: "mindos-btn-large is-danger" });
    setIcon(stopBtn.createSpan(), "square");
    stopBtn.createSpan({ text: " 中止" });
    stopBtn.onclick = () => d().requestStop();
  } else if (state.status === "done" || state.status === "idle") {
    if (state.status === "done") {
      const clearBtn = actions.createEl("button", { cls: "mindos-btn-large is-ghost" });
      setIcon(clearBtn.createSpan(), "eraser");
      clearBtn.createSpan({ text: " 清空" });
      clearBtn.onclick = () => taskStore.reset();
    }
  } else if (state.status === "error") {
    const clearBtn = actions.createEl("button", { cls: "mindos-btn-large is-ghost" });
    setIcon(clearBtn.createSpan(), "trash-2");
    clearBtn.createSpan({ text: " 清空" });
    clearBtn.onclick = () => taskStore.reset();
  }

  // 流水线卡片
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

  // 实时任务进度
  if (state.status === "running") {
    const progressContainer = parent.createDiv();
    new TaskProgressView(progressContainer, taskStore);
  }

  // 待审核列表
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
      setIcon(opBadge.createSpan(), getOpIcon(a.op));
      opBadge.createSpan({ text: getOpLabel(a.op) });
      cHead.createDiv({ cls: "mindos-action-type-label", text: PAGE_TYPE_LABELS[a.pageType] ?? a.pageType });
      const headOps = cHead.createDiv({ cls: "mindos-action-card-ops" });
      const approveBtn = headOps.createEl("button", { cls: "mindos-mini-btn is-success" });
      setIcon(approveBtn, "check");
      approveBtn.onclick = () => d().approveAction(a.id);
      const rejectBtn = headOps.createEl("button", { cls: "mindos-mini-btn" });
      setIcon(rejectBtn, "x");
      rejectBtn.onclick = () => taskStore.removePendingAction(a.id);
      card.createDiv({ cls: "mindos-action-card-title", text: a.title });
      if (a.brief) card.createDiv({ cls: "mindos-action-card-brief", text: a.brief });
      if (a.reason) card.createDiv({ cls: "mindos-action-card-reason", text: `💭 ${a.reason}` });
      if (a.sourceRounds && a.sourceRounds.length > 0) {
        card.createDiv({ cls: "mindos-action-card-rounds", text: `来自回合: ${a.sourceRounds.join(", ")}` });
      }
    }
  }

  // 日志
  if (state.logs.length > 0) {
    const logSection = parent.createDiv({ cls: "mindos-section" });
    const lHead = logSection.createDiv({ cls: "mindos-section-head" });
    const lti = lHead.createSpan({ cls: "mindos-section-icon" });
    setIcon(lti, "scroll-text");
    lHead.createSpan({ cls: "mindos-section-title", text: "日志" });
    lHead.createSpan({ cls: "mindos-section-badge", text: String(state.logs.length) });
    const box = logSection.createDiv({ cls: "mindos-log-box" });
    state.logs.slice(-50).forEach((line: string) => {
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

  // 处理结果
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
      rawPathSpan.onclick = () => d().openFile(r.rawFilePath);
      for (const a of r.actions) {
        if (!a.path) continue;
        const fl = links.createDiv({ cls: "mindos-file-link" });
        const fi = fl.createSpan({ cls: "mindos-file-link-icon" });
        setIcon(fi, getOpIcon(a.op));
        const titleSpan = fl.createSpan({ cls: "mindos-file-link-title", text: a.title });
        titleSpan.onclick = () => d().openFile(a.path);
      }
    }
  }
}

// ── Recall Tab ──

export function renderRecallTab(parent: HTMLElement): void {
  d().recallView.render(parent);
}
