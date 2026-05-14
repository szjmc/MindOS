import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type AIPromptCollectorPlugin from "../main";
import { VIEW_TYPE_AI_TASK_CENTER, PLUGIN_VERSION, PAGE_TYPE_LABELS } from "./constants";
import { WikiAction, PipelineStage, UICollapsedState } from "./types";

export class AITaskCenterView extends ItemView {
  private unsubscribe: (() => void) | null = null;
  private indexStatusCache: { total: number; byType: Record<string, number>; missingBrief: number } | null = null;
  private schemaStatusCache: { claudeLoaded: boolean; claudeLines: number; templates: number } | null = null;
  private expandedActions = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private plugin: AIPromptCollectorPlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_AI_TASK_CENTER; }
  getDisplayText(): string { return "AI Wiki"; }
  getIcon(): string { return "brain-circuit"; }

  async onOpen() {
    this.unsubscribe = this.plugin.taskStore.subscribe(() => this.render());
    this.render();
    await this.refreshStatusCaches();
    this.render();
  }

  async onClose() { this.unsubscribe?.(); }

  async refreshStatusCaches() {
    try { this.indexStatusCache = await this.plugin.indexManager.getStatus(); }
    catch { this.indexStatusCache = { total: 0, byType: {}, missingBrief: 0 }; }
    try { this.schemaStatusCache = await this.plugin.schemaManager.getStatus(); }
    catch { this.schemaStatusCache = { claudeLoaded: false, claudeLines: 0, templates: 0 }; }
  }

  private isCollapsed(key: keyof UICollapsedState): boolean {
    return this.plugin.settings.uiCollapsed[key];
  }

  private async toggleCollapsed(key: keyof UICollapsedState) {
    await this.plugin.setUICollapsed(key, !this.plugin.settings.uiCollapsed[key]);
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("apc-root");
    contentEl.style.height = "100%";
    contentEl.style.overflow = "hidden";
    contentEl.style.padding = "0";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";

    const wrap = contentEl.createDiv({ cls: "apc-task-center" });

    this.renderTopBar(wrap);
    this.renderStatusBanner(wrap);
    this.renderPipelinePanel(wrap);
    this.renderPendingActions(wrap);
    this.renderEmptyGuide(wrap);

    this.renderCollapsibleSection(wrap, {
      key: "wikiStatus",
      icon: "library",
      title: "Wiki 状态",
      badge: this.indexStatusCache ? String(this.indexStatusCache.total) : "...",
      render: (body) => this.renderWikiStatusBody(body),
    });

    this.renderCollapsibleSection(wrap, {
      key: "schemaStatus",
      icon: "settings-2",
      title: "Schema 配置",
      badge: this.schemaStatusCache ? (this.schemaStatusCache.claudeLoaded ? "✓" : "✗") : "...",
      render: (body) => this.renderSchemaStatusBody(body),
    });

    const state = this.plugin.taskStore.getState();
    this.renderCollapsibleSection(wrap, {
      key: "results",
      icon: "list-checks",
      title: "处理结果",
      badge: String(state.results.length),
      render: (body) => this.renderResultsBody(body),
    });

    this.renderCollapsibleSection(wrap, {
      key: "logs",
      icon: "scroll-text",
      title: "日志",
      badge: String(state.logs.length),
      render: (body) => this.renderLogsBody(body),
    });
  }

  private renderTopBar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "apc-topbar" });
    const left = bar.createDiv({ cls: "apc-topbar-left" });
    const titleWrap = left.createDiv({ cls: "apc-brand" });
    const iconEl = titleWrap.createSpan({ cls: "apc-brand-icon" });
    setIcon(iconEl, "brain-circuit");
    titleWrap.createSpan({ cls: "apc-brand-text", text: "AI Wiki" });
    titleWrap.createSpan({ cls: "apc-version-tag", text: `v${PLUGIN_VERSION}` });

    const right = bar.createDiv({ cls: "apc-topbar-right" });
    this.makeIconBtn(right, "clipboard-paste", "从剪贴板采集", async () => {
      await this.plugin.collectFromClipboard({});
    });
    this.makeIconBtn(right, "refresh-cw", "重建 Wiki Index", async () => {
      const r = await this.plugin.indexManager.rebuild();
      await this.refreshStatusCaches();
      this.render();
      new Notice(`✅ 重建：${r.count} 个页面`);
    });
    this.makeIconBtn(right, "book-open", "打开 INDEX", () => this.plugin.openIndexFile());
    this.makeIconBtn(right, "settings", "设置", () => {
      // @ts-ignore
      this.plugin.app.setting.open();
      // @ts-ignore
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  private makeIconBtn(parent: HTMLElement, icon: string, tooltip: string, onClick: () => void) {
    const btn = parent.createEl("button", { cls: "apc-icon-btn" });
    btn.setAttribute("aria-label", tooltip);
    btn.setAttribute("title", tooltip);
    setIcon(btn, icon);
    btn.onclick = onClick;
    return btn;
  }

  private renderStatusBanner(parent: HTMLElement) {
    const state = this.plugin.taskStore.getState();
    const banner = parent.createDiv({ cls: `apc-banner status-${state.status}` });

    const head = banner.createDiv({ cls: "apc-banner-head" });
    const iconEl = head.createSpan({ cls: "apc-banner-icon" });
    setIcon(iconEl, this.getStatusIcon(state.status));

    const textWrap = head.createDiv({ cls: "apc-banner-text" });
    textWrap.createDiv({ cls: "apc-banner-title", text: this.getStatusTitle(state.status) });
    textWrap.createDiv({ cls: "apc-banner-detail", text: state.detail || this.getStatusHint(state.status) });

    if (state.error) {
      const errBox = banner.createDiv({ cls: "apc-banner-error" });
      const ei = errBox.createSpan({ cls: "apc-banner-error-icon" });
      setIcon(ei, "alert-circle");
      errBox.createSpan({ text: state.error });
    }

    const actions = banner.createDiv({ cls: "apc-banner-actions" });
    if (state.status === "awaiting_review") {
      const approveAll = actions.createEl("button", { cls: "apc-btn-large is-primary" });
      setIcon(approveAll.createSpan(), "check-check");
      approveAll.createSpan({ text: ` 全部批准 (${state.pendingActions.length})` });
      approveAll.onclick = () => this.plugin.approveAllActions();

      const rejectAll = actions.createEl("button", { cls: "apc-btn-large is-ghost" });
      setIcon(rejectAll.createSpan(), "x");
      rejectAll.createSpan({ text: " 全部拒绝" });
      rejectAll.onclick = () => {
        this.plugin.taskStore.clearPendingActions();
        this.plugin.taskStore.setStatus("done", "已拒绝", "用户拒绝了所有 actions");
      };
    } else if (state.status === "running") {
      const stopBtn = actions.createEl("button", { cls: "apc-btn-large is-danger" });
      setIcon(stopBtn.createSpan(), "square");
      stopBtn.createSpan({ text: " 中止" });
      stopBtn.onclick = () => this.plugin.requestStop();
    } else if (state.status === "done") {
      const newBtn = actions.createEl("button", { cls: "apc-btn-large is-primary" });
      setIcon(newBtn.createSpan(), "plus");
      newBtn.createSpan({ text: " 采集新对话" });
      newBtn.onclick = async () => await this.plugin.collectFromClipboard({});
      const clearBtn = actions.createEl("button", { cls: "apc-btn-large is-ghost" });
      setIcon(clearBtn.createSpan(), "eraser");
      clearBtn.createSpan({ text: " 清空" });
      clearBtn.onclick = () => this.plugin.taskStore.reset();
    } else if (state.status === "error") {
      const clearBtn = actions.createEl("button", { cls: "apc-btn-large is-ghost" });
      setIcon(clearBtn.createSpan(), "trash-2");
      clearBtn.createSpan({ text: " 清空" });
      clearBtn.onclick = () => this.plugin.taskStore.reset();
    }
  }

  private renderPipelinePanel(parent: HTMLElement) {
    const state = this.plugin.taskStore.getState();
    if (!state.pipeline.active && state.pipeline.clusters.length === 0) return;

    const isCollapsed = this.isCollapsed("pipeline");
    const card = parent.createDiv({ cls: `apc-pipeline-card ${isCollapsed ? "is-collapsed" : ""}` });

    const head = card.createDiv({ cls: "apc-pipeline-head" });
    head.onclick = () => this.toggleCollapsed("pipeline");
    const ti = head.createSpan({ cls: "apc-pipeline-title-icon" });
    setIcon(ti, "git-branch");
    head.createSpan({ cls: "apc-pipeline-title", text: "智能合并流水线" });
    const chev = head.createSpan({ cls: "apc-pipeline-chev" });
    setIcon(chev, isCollapsed ? "chevron-down" : "chevron-up");

    if (isCollapsed) return;

    const stages: Array<{ key: PipelineStage; label: string }> = [
      { key: "cluster", label: "回合聚类" },
      { key: "draft", label: "整理草稿" },
      { key: "diff", label: "差异比对" },
      { key: "execute", label: "执行动作" },
    ];

    const stagesWrap = card.createDiv({ cls: "apc-pipeline-stages" });
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i];
      const stageData = state.pipeline.stages[s.key];
      const status = stageData?.status ?? "pending";
      const stageEl = stagesWrap.createDiv({ cls: `apc-pipeline-stage status-${status}` });

      const numEl = stageEl.createDiv({ cls: "apc-pipeline-stage-num" });
      if (status === "done") setIcon(numEl, "check");
      else if (status === "running") setIcon(numEl, "loader-2");
      else if (status === "failed") setIcon(numEl, "x");
      else numEl.setText(String(i + 1));

      const txt = stageEl.createDiv({ cls: "apc-pipeline-stage-text" });
      txt.createDiv({ cls: "apc-pipeline-stage-label", text: s.label });
      if (stageData?.detail) {
        txt.createDiv({ cls: "apc-pipeline-stage-detail", text: stageData.detail });
      }
    }

    if (state.pipeline.clusters.length > 0) {
      const summary = card.createDiv({ cls: "apc-pipeline-summary" });
      summary.createDiv({
        text: `📊 聚类 ${state.pipeline.clusters.length} 组 · 草稿 ${state.pipeline.drafts.length} 份 · 决策 ${state.pipeline.decisions.length} 项`,
      });
    }
  }

  private renderPendingActions(parent: HTMLElement) {
    const state = this.plugin.taskStore.getState();
    if (state.pendingActions.length === 0) return;

    const section = parent.createDiv({ cls: "apc-section" });
    const head = section.createDiv({ cls: "apc-section-head" });
    const ti = head.createSpan({ cls: "apc-section-icon" });
    setIcon(ti, "list-todo");
    head.createSpan({ cls: "apc-section-title", text: "待审核动作" });
    head.createSpan({ cls: "apc-section-badge", text: String(state.pendingActions.length) });

    const list = section.createDiv({ cls: "apc-action-list" });
    for (const a of state.pendingActions) this.renderActionCard(list, a);
  }

  private renderActionCard(parent: HTMLElement, a: WikiAction) {
    const card = parent.createDiv({ cls: `apc-action-card op-${a.op}` });

    const head = card.createDiv({ cls: "apc-action-card-head" });
    const opBadge = head.createDiv({ cls: `apc-op-badge op-${a.op}` });
    setIcon(opBadge.createSpan(), this.getOpIcon(a.op));
    opBadge.createSpan({ text: this.getOpLabel(a.op) });
    head.createDiv({ cls: "apc-action-type-label", text: PAGE_TYPE_LABELS[a.pageType] ?? a.pageType });

    const headOps = head.createDiv({ cls: "apc-action-card-ops" });
    const approveBtn = headOps.createEl("button", { cls: "apc-mini-btn is-success" });
    setIcon(approveBtn, "check");
    approveBtn.setAttribute("title", "批准");
    approveBtn.onclick = () => this.plugin.approveAction(a.id);
    const rejectBtn = headOps.createEl("button", { cls: "apc-mini-btn" });
    setIcon(rejectBtn, "x");
    rejectBtn.setAttribute("title", "拒绝");
    rejectBtn.onclick = () => this.plugin.taskStore.removePendingAction(a.id);

    card.createDiv({ cls: "apc-action-card-title", text: a.title });
    if (a.brief) card.createDiv({ cls: "apc-action-card-brief", text: a.brief });
    if (a.reason) {
      const rr = card.createDiv({ cls: "apc-action-card-reason" });
      const ri = rr.createSpan({ cls: "apc-action-reason-icon" });
      setIcon(ri, "info");
      rr.createSpan({ text: a.reason });
    }
    if (a.sourceRounds && a.sourceRounds.length > 0) {
      const sr = card.createDiv({ cls: "apc-action-card-rounds" });
      const si = sr.createSpan({ cls: "apc-action-reason-icon" });
      setIcon(si, "git-commit");
      sr.createSpan({ text: `来自回合: ${a.sourceRounds.join(", ")}` });
    }

    const isExpanded = this.expandedActions.has(a.id);
    const previewWrap = card.createDiv({ cls: "apc-action-preview-wrap" });
    const toggle = previewWrap.createDiv({ cls: "apc-action-preview-toggle" });
    const togIcon = toggle.createSpan({ cls: "apc-toggle-icon" });
    setIcon(togIcon, isExpanded ? "chevron-down" : "chevron-right");
    toggle.createSpan({ text: isExpanded ? "收起内容" : `查看内容（${a.content.length} 字）` });
    toggle.onclick = () => {
      if (isExpanded) this.expandedActions.delete(a.id);
      else this.expandedActions.add(a.id);
      this.render();
    };
    if (isExpanded) {
      const preview = previewWrap.createDiv({ cls: "apc-action-preview" });
      preview.setText(a.content);
    }

    if (a.tags && a.tags.length > 0) {
      const tagRow = card.createDiv({ cls: "apc-action-card-tags" });
      for (const t of a.tags) {
        if (!t) continue;
        tagRow.createSpan({ cls: "apc-tag", text: `#${t}` });
      }
    }
  }

  private renderEmptyGuide(parent: HTMLElement) {
    const state = this.plugin.taskStore.getState();
    if (state.status !== "idle") return;
    if (state.results.length > 0) return;
    if (state.pipeline.clusters.length > 0) return;

    const isCollapsed = this.isCollapsed("quickStart");
    const guide = parent.createDiv({ cls: `apc-guide ${isCollapsed ? "is-collapsed" : ""}` });

    const titleRow = guide.createDiv({ cls: "apc-guide-title-row" });
    titleRow.onclick = () => this.toggleCollapsed("quickStart");

    const titleLeft = titleRow.createDiv({ cls: "apc-guide-title" });
    const ti = titleLeft.createSpan({ cls: "apc-guide-icon" });
    setIcon(ti, "rocket");
    titleLeft.createSpan({ text: "快速开始" });

    const chev = titleRow.createSpan({ cls: "apc-guide-chev" });
    setIcon(chev, isCollapsed ? "chevron-down" : "chevron-up");

    if (isCollapsed) return;

    guide.createDiv({ cls: "apc-guide-subtitle", text: "三步搭建你的 AI Wiki" });

    const steps = guide.createDiv({ cls: "apc-guide-steps" });
    this.makeGuideStep(steps, "1", "settings", "配置 API", "在设置中填写 API Key 和模型", () => {
      // @ts-ignore
      this.plugin.app.setting.open();
      // @ts-ignore
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
    });
    this.makeGuideStep(steps, "2", "folder-tree", "初始化结构", "创建 raw / wiki / schema 三层目录", async () => {
      await this.plugin.initializeStructure();
      await this.refreshStatusCaches();
      this.render();
      new Notice("✅ 已初始化");
    });
    this.makeGuideStep(steps, "3", "file-text", "编辑 CLAUDE.md", "定义 AI 的工作规则（可选）", async () => {
      await this.plugin.openSchemaFile();
    });

    const cta = guide.createDiv({ cls: "apc-guide-cta" });
    const collectBtn = cta.createEl("button", { cls: "apc-btn-large is-primary" });
    setIcon(collectBtn.createSpan(), "clipboard-paste");
    collectBtn.createSpan({ text: " 立即采集" });
    collectBtn.onclick = async () => await this.plugin.collectFromClipboard({});
  }

  private makeGuideStep(parent: HTMLElement, num: string, icon: string, title: string, desc: string, onClick: () => void) {
    const step = parent.createDiv({ cls: "apc-guide-step" });
    step.onclick = onClick;
    step.createDiv({ cls: "apc-guide-step-num", text: num });
    const iconWrap = step.createDiv({ cls: "apc-guide-step-icon" });
    setIcon(iconWrap, icon);
    const text = step.createDiv({ cls: "apc-guide-step-text" });
    text.createDiv({ cls: "apc-guide-step-title", text: title });
    text.createDiv({ cls: "apc-guide-step-desc", text: desc });
    const arrow = step.createDiv({ cls: "apc-guide-step-arrow" });
    setIcon(arrow, "chevron-right");
  }

  private renderCollapsibleSection(parent: HTMLElement, opts: {
    key: keyof UICollapsedState;
    icon: string;
    title: string;
    badge: string;
    render: (body: HTMLElement) => void;
  }) {
    const isCollapsed = this.isCollapsed(opts.key);
    const sec = parent.createDiv({ cls: `apc-collapsible ${isCollapsed ? "is-collapsed" : "is-expanded"}` });

    const head = sec.createDiv({ cls: "apc-collapsible-head" });
    head.onclick = () => this.toggleCollapsed(opts.key);

    const chev = head.createSpan({ cls: "apc-collapsible-chev" });
    setIcon(chev, isCollapsed ? "chevron-right" : "chevron-down");

    const ic = head.createSpan({ cls: "apc-collapsible-icon" });
    setIcon(ic, opts.icon);

    head.createSpan({ cls: "apc-collapsible-title", text: opts.title });
    head.createSpan({ cls: "apc-collapsible-badge", text: opts.badge });

    if (!isCollapsed) {
      const body = sec.createDiv({ cls: "apc-collapsible-body" });
      try {
        opts.render(body);
        if (body.childElementCount === 0) {
          body.createDiv({ cls: "apc-empty", text: "加载中..." });
        }
      } catch (e) {
        body.createDiv({ cls: "apc-empty", text: `渲染失败: ${e}` });
      }
    }
  }

  private renderWikiStatusBody(body: HTMLElement) {
    if (!this.indexStatusCache) { body.createDiv({ cls: "apc-empty", text: "加载中..." }); return; }
    const s = this.indexStatusCache;
    const total = body.createDiv({ cls: "apc-stat-big" });
    total.createDiv({ cls: "apc-stat-big-value", text: String(s.total) });
    total.createDiv({ cls: "apc-stat-big-label", text: "Wiki 页面总数" });
    const grid = body.createDiv({ cls: "apc-stat-grid" });
    for (const [type, label] of Object.entries(PAGE_TYPE_LABELS)) {
      const cell = grid.createDiv({ cls: "apc-stat-cell" });
      cell.createDiv({ cls: "apc-stat-cell-label", text: label });
      cell.createDiv({ cls: "apc-stat-cell-value", text: String(s.byType[type] ?? 0) });
    }
    if (s.missingBrief > 0) {
      const warn = body.createDiv({ cls: "apc-warn-row" });
      const wi = warn.createSpan({ cls: "apc-warn-icon" });
      setIcon(wi, "alert-triangle");
      warn.createSpan({ text: `${s.missingBrief} 个页面缺简介` });
      const fillBtn = warn.createEl("button", { cls: "apc-mini-btn is-warning" });
      fillBtn.setText("一键补全");
      fillBtn.onclick = async () => {
        await this.plugin.fillMissingBriefs();
        await this.refreshStatusCaches();
        this.render();
      };
    }
    const ops = body.createDiv({ cls: "apc-btn-row" });
    const rebuildBtn = ops.createEl("button", { cls: "apc-btn" });
    setIcon(rebuildBtn.createSpan(), "refresh-cw");
    rebuildBtn.createSpan({ text: " 重建" });
    rebuildBtn.onclick = async () => {
      const r = await this.plugin.indexManager.rebuild();
      await this.refreshStatusCaches();
      this.render();
      new Notice(`✅ ${r.count}`);
    };
    const openBtn = ops.createEl("button", { cls: "apc-btn" });
    setIcon(openBtn.createSpan(), "external-link");
    openBtn.createSpan({ text: " 打开 INDEX" });
    openBtn.onclick = () => this.plugin.openIndexFile();
  }

  private renderSchemaStatusBody(body: HTMLElement) {
    if (!this.schemaStatusCache) { body.createDiv({ cls: "apc-empty", text: "加载中..." }); return; }
    const s = this.schemaStatusCache;
    const grid = body.createDiv({ cls: "apc-stat-grid two-cols" });
    const claudeCell = grid.createDiv({ cls: "apc-stat-cell" });
    claudeCell.createDiv({ cls: "apc-stat-cell-label", text: "📄 CLAUDE.md" });
    claudeCell.createDiv({ cls: `apc-stat-cell-value ${s.claudeLoaded ? "is-success" : "is-error"}`, text: s.claudeLoaded ? `✓ ${s.claudeLines} 行` : "✗ 未加载" });
    const tplCell = grid.createDiv({ cls: "apc-stat-cell" });
    tplCell.createDiv({ cls: "apc-stat-cell-label", text: "📋 模板" });
    tplCell.createDiv({ cls: "apc-stat-cell-value", text: `${s.templates} 个` });
    const ops = body.createDiv({ cls: "apc-btn-row" });
    const editBtn = ops.createEl("button", { cls: "apc-btn" });
    setIcon(editBtn.createSpan(), "file-edit");
    editBtn.createSpan({ text: " 编辑" });
    editBtn.onclick = () => this.plugin.openSchemaFile();
    const initBtn = ops.createEl("button", { cls: "apc-btn" });
    setIcon(initBtn.createSpan(), "folder-plus");
    initBtn.createSpan({ text: " 重新初始化" });
    initBtn.onclick = async () => {
      await this.plugin.schemaManager.initialize();
      await this.refreshStatusCaches();
      this.render();
      new Notice("✅ 已初始化");
    };
  }

  private renderResultsBody(body: HTMLElement) {
    const state = this.plugin.taskStore.getState();
    if (state.results.length === 0) { body.createDiv({ cls: "apc-empty", text: "暂无处理结果" }); return; }
    const list = body.createDiv({ cls: "apc-result-list" });
    for (const r of [...state.results].reverse()) {
      const item = list.createDiv({ cls: `apc-result-card${r.error ? " is-error" : ""}` });
      const head = item.createDiv({ cls: "apc-result-card-head" });
      head.createSpan({ cls: "apc-result-summary", text: r.summary || "(无摘要)" });
      if (r.actions.length > 0) head.createSpan({ cls: "apc-action-count-tag", text: `${r.actions.length} 动作` });
      if (r.error) {
        const err = item.createDiv({ cls: "apc-result-error" });
        const ei = err.createSpan({ cls: "apc-result-error-icon" });
        setIcon(ei, "alert-circle");
        err.createSpan({ text: r.error });
      }
      const links = item.createDiv({ cls: "apc-result-files" });
      const rawLink = links.createDiv({ cls: "apc-file-link" });
      const ri = rawLink.createSpan({ cls: "apc-file-link-icon" });
      setIcon(ri, "file-input");
      const rawPathSpan = rawLink.createSpan({ cls: "apc-file-link-path", text: r.rawFilePath });
      rawPathSpan.onclick = () => this.plugin.openFile(r.rawFilePath);
      for (const a of r.actions) {
        if (!a.path) continue;
        const fl = links.createDiv({ cls: "apc-file-link" });
        const fi = fl.createSpan({ cls: "apc-file-link-icon" });
        setIcon(fi, this.getOpIcon(a.op));
        const titleSpan = fl.createSpan({ cls: "apc-file-link-title", text: a.title });
        const opTag = fl.createSpan({ cls: `apc-file-link-op op-${a.op}`, text: a.op });
        titleSpan.onclick = () => this.plugin.openFile(a.path);
        opTag.onclick = () => this.plugin.openFile(a.path);
      }
    }
  }

  private renderLogsBody(body: HTMLElement) {
    const state = this.plugin.taskStore.getState();
    const ops = body.createDiv({ cls: "apc-btn-row" });
    const clearBtn = ops.createEl("button", { cls: "apc-btn" });
    setIcon(clearBtn.createSpan(), "eraser");
    clearBtn.createSpan({ text: " 清空" });
    clearBtn.onclick = () => this.plugin.taskStore.reset();
    const exportBtn = ops.createEl("button", { cls: "apc-btn" });
    setIcon(exportBtn.createSpan(), "download");
    exportBtn.createSpan({ text: " 导出" });
    exportBtn.onclick = async () => {
      await navigator.clipboard.writeText(state.logs.join("\n"));
      new Notice("✅ 已复制");
    };
    const box = body.createDiv({ cls: "apc-log-box" });
    if (state.logs.length === 0) { box.createDiv({ cls: "apc-empty", text: "暂无日志" }); return; }
    state.logs.forEach((line) => {
      const el = box.createEl("div", { cls: "apc-log-line" });
      let levelCls = "log-default";
      if (line.includes("❌")) levelCls = "log-error";
      else if (line.includes("✅")) levelCls = "log-success";
      else if (line.includes("⚠️")) levelCls = "log-warn";
      else if (line.includes("ℹ️") || line.includes("→") || line.includes("📂") || line.includes("·")) levelCls = "log-info";
      el.addClass(levelCls);
      el.setText(line);
    });
    requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  }

  private getStatusIcon(s: string): string { return ({ idle: "moon", running: "loader-2", awaiting_review: "clipboard-check", done: "check-circle-2", error: "alert-octagon" } as any)[s] ?? "circle"; }
  private getStatusTitle(s: string): string { return ({ idle: "待机", running: "处理中…", awaiting_review: "⚡ 等待审核", done: "✓ 已完成", error: "✗ 出错" } as any)[s] ?? s; }
  private getStatusHint(s: string): string { return ({ idle: "点击右上角 📋 从剪贴板采集", running: "AI 正在工作…", awaiting_review: "请审核 AI 决策后批准", done: "本轮处理结束", error: "请查看错误信息" } as any)[s] ?? ""; }
  private getOpIcon(op: string): string { return ({ create: "file-plus", update: "file-edit", append_section: "list-plus", link: "link" } as any)[op] ?? "file"; }
  private getOpLabel(op: string): string { return ({ create: "新建", update: "更新", append_section: "追加", link: "链接" } as any)[op] ?? op; }
}