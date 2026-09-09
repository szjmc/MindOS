import { Notice, TFile, Modal, App, setIcon } from "obsidian";
import type MindOSPlugin from "../../../main";
import { VersionManager } from "./version-manager";
import { diffVersions, DiffResult } from "./version-differ";
import { PageVersion } from "../../core/types";
import { FilePreviewModal } from "./file-preview-modal";
import { QualityAnalyzer } from "./quality-analyzer";
import { isWikiContentFile, createSvgEl } from "../../core/utils";

export type EvolutionTab = "versions" | "health";
export type VersionFilter = "all" | "latest" | "added" | "modified";

export interface HealthMetric {
  name: string;
  value: number;
  maxValue: number;
  score: number;
  label: string;
  level: "excellent" | "good" | "needs-improvement" | "to-add";
}

export interface HealthReport {
  generatedAt: string;
  totalScore: number;
  level: "优秀" | "良好" | "需优化" | "待补充";
  analyzedNotes: number;
  analyzedWords: number;
  metrics: HealthMetric[];
  suggestions: {
    id: string;
    priority: "high" | "medium" | "low";
    title: string;
    description: string;
    actionable: boolean;
    targetPaths?: string[];
    estimatedImpact?: string;
  }[];
}

class VersionDiffModal extends Modal {
  constructor(
    app: App,
    private oldVersion: PageVersion,
    private newVersion: PageVersion,
    private filePath: string,
  ) {
    super(app);
    this.modalEl.addClass("mindos-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    const header = contentEl.createDiv({ cls: "mindos-modal-header" });
    header.createEl("h2", { text: "版本对比" });

    const body = contentEl.createDiv({ cls: "mindos-modal-body" });
    const diff = diffVersions(this.oldVersion.content, this.newVersion.content);

    const diffInfo = body.createDiv({ cls: "mindos-diff-info" });
    diffInfo.createEl("span", { text: `新增 ${diff.additions} 行`, cls: "diff-add" });
    diffInfo.createEl("span", { text: `删除 ${diff.deletions} 行`, cls: "diff-remove" });

    const diffArea = body.createDiv({ cls: "mindos-diff-area" });
    const table = diffArea.createEl("table", { cls: "mindos-diff-table" });

    for (const line of diff.lines) {
      const tr = table.createEl("tr", { cls: `diff-${line.type}` });
      tr.createEl("td", { cls: "diff-lineno", text: line.lineNumber.old != null ? String(line.lineNumber.old) : "" });
      tr.createEl("td", { cls: "diff-lineno", text: line.lineNumber.new != null ? String(line.lineNumber.new) : "" });
      tr.createEl("td", { cls: "diff-content", text: line.content });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class WikiEvolutionRenderer {
  private plugin: MindOSPlugin;
  private versionManager: VersionManager;
  private qualityAnalyzer: QualityAnalyzer;
  private currentTab: EvolutionTab = "versions";
  private container: HTMLElement | null = null;
  private selectedFile: TFile | null = null;
  private healthReport: HealthReport | null = null;
  private versions: PageVersion[] = [];
  private filteredVersions: PageVersion[] = [];
  private isLoading: boolean = false;
  private currentFilter: VersionFilter = "all";
  private displayedCount: number = 10;
  private dropdownOpen: boolean = false;
  private tabChangeCallback: ((tab: EvolutionTab) => void) | null = null;

  constructor(plugin: MindOSPlugin) {
    this.plugin = plugin;
    this.versionManager = plugin.versionManager;
    this.qualityAnalyzer = new QualityAnalyzer(plugin.app, () => plugin.settings);
  }

  setContainer(container: HTMLElement) {
    this.container = container;
  }

  setTab(tab: EvolutionTab) {
    this.currentTab = tab;
  }

  setTabChangeCallback(cb: (tab: EvolutionTab) => void) {
    this.tabChangeCallback = cb;
  }

  async render() {
    if (!this.container) return;
    this.container.empty();

    const wrap = this.container.createDiv({ cls: "mindos-evolution-view" });
    this.renderTabBar(wrap);
    
    const content = wrap.createDiv({ cls: "mindos-evolution-content" });
    
    if (this.currentTab === "versions") {
      await this.renderVersionsTab(content);
    } else {
      await this.renderHealthTab(content);
    }
  }

  private renderTopBar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "mindos-topbar" });
    const left = bar.createDiv({ cls: "mindos-topbar-left" });
    const titleWrap = left.createDiv({ cls: "mindos-brand" });
    const iconEl = titleWrap.createSpan({ cls: "mindos-brand-icon" });
    setIcon(iconEl, "git-branch");
    titleWrap.createSpan({ cls: "mindos-brand-text", text: "知识演化" });
    titleWrap.createSpan({ cls: "mindos-version-tag", text: `v${this.plugin.manifest.version}` });
  }

  private renderTabBar(parent: HTMLElement) {
    const tabs = parent.createDiv({ cls: "mindos-tab-bar" });
    const tabConfig: Record<EvolutionTab, { label: string; icon: string }> = {
      versions: { label: "版本历史", icon: "history" },
      health:   { label: "健康度报告", icon: "heart-pulse" },
    };

    for (const [key, info] of Object.entries(tabConfig)) {
      const btn = tabs.createDiv({
        cls: `mindos-tab-btn ${this.currentTab === key ? "is-active" : ""}`,
      });
      const ic = btn.createSpan({ cls: "mindos-tab-btn-icon" });
      setIcon(ic, info.icon);
      btn.createSpan({ cls: "mindos-tab-btn-label", text: info.label });
      btn.onclick = async () => {
        this.currentTab = key as EvolutionTab;
        if (this.tabChangeCallback) this.tabChangeCallback(this.currentTab);
        await this.render();
      };
    }
  }

  private async renderVersionsTab(parent: HTMLElement) {
    const container = parent.createDiv({ cls: "mindos-evolution-versions-container" });

    // 页面选择器 - 优化版本
    const selector = container.createDiv({ cls: "mindos-evolution-page-selector" });
    selector.createSpan({ cls: "mindos-evolution-selector-label", text: "📄 选择页面：" });

    const files = this.getWikiFiles();
    const selectWrapper = selector.createDiv({ cls: "mindos-evolution-select-wrapper" });
    
    // 自定义下拉框
    const customSelect = selectWrapper.createDiv({ cls: "mindos-evolution-custom-select" });
    const selectDisplay = customSelect.createDiv({ cls: "mindos-evolution-select-display" });
    const selectText = selectDisplay.createSpan({ cls: "mindos-evolution-select-text", text: "-- 请选择一个 Wiki 页面 --" });
    const selectArrow = selectDisplay.createSpan({ cls: "mindos-evolution-select-arrow", text: "▼" });
    
    const dropdown = customSelect.createDiv({ cls: "mindos-evolution-select-dropdown" });
    
    // 自动选中当前打开的文件
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (activeFile && files.some(f => f.path === activeFile.path)) {
      this.selectedFile = activeFile;
      selectText.setText(activeFile.basename);
    }

    // 添加选项
    for (const f of files) {
      const option = dropdown.createDiv({ cls: "mindos-evolution-select-option", text: f.basename });
      option.onclick = async () => {
        selectText.setText(f.basename);
        this.selectedFile = f;
        this.dropdownOpen = false;
        dropdown.removeClass("is-open");
        // 更新选中路径显示
        const pathDisplay = selector.querySelector(".mindos-evolution-selected-path");
        if (pathDisplay) {
          pathDisplay.setText(f.path);
        }
        await this.loadVersions(f.path, listContainer);
      };
    }

    // 切换下拉框
    selectDisplay.onclick = (e) => {
      e.stopPropagation();
      this.dropdownOpen = !this.dropdownOpen;
      dropdown.toggleClass("is-open", this.dropdownOpen);
    };

    // 点击外部关闭下拉框
    document.addEventListener("click", () => {
      this.dropdownOpen = false;
      dropdown.removeClass("is-open");
    });

    // 选中的文件路径显示
    const selectedPath = selector.createDiv({ cls: "mindos-evolution-selected-path" });
    if (this.selectedFile) {
      selectedPath.setText(this.selectedFile.path);
    }

    const listContainer = container.createDiv({ cls: "mindos-evolution-versions-list" });
    
    if (this.selectedFile) {
      await this.loadVersions(this.selectedFile.path, listContainer);
    } else {
      this.renderVersionsEmpty(listContainer);
    }
  }

  private getWikiFiles(): TFile[] {
    const { vault } = this.plugin.app;
    const baseFolder = this.plugin.settings.baseFolder;
    
    return vault.getMarkdownFiles()
      .filter(f => isWikiContentFile(f, baseFolder))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private isWikiFile(file: TFile): boolean {
    const baseFolder = this.plugin.settings.baseFolder;
    return isWikiContentFile(file, baseFolder);
  }

  private renderVersionsEmpty(parent: HTMLElement) {
    const empty = parent.createDiv({ cls: "mindos-evolution-empty" });
    empty.createDiv({ cls: "mindos-evolution-empty-icon", text: "📝" });
    empty.createDiv({ cls: "mindos-evolution-empty-title", text: "笔记修改/更新后，即可查看版本演化轨迹" });
    empty.createDiv({ cls: "mindos-evolution-empty-desc", text: "选择一个页面来查看它的版本历史" });
  }

  private async loadVersions(filePath: string, container: HTMLElement) {
    container.empty();
    this.isLoading = true;
    this.displayedCount = 10;
    
    const loading = container.createDiv({ cls: "mindos-evolution-loading" });
    loading.createDiv({ cls: "mindos-evolution-spinner" });
    loading.createEl("p", { text: "正在加载版本历史..." });

    try {
      this.versions = await this.versionManager.getVersions(filePath);
      
      // 如果没有版本记录，获取当前文件内容作为初始版本
      if (this.versions.length === 0) {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          const content = await this.plugin.app.vault.read(file);
          this.versions = [{
            id: "current",
            pagePath: filePath,
            content,
            wordCount: content.length,
            timestamp: new Date().toISOString(),
            hash: ""
          }];
        }
      }
      
      this.filteredVersions = [...this.versions];
      this.isLoading = false;
      container.empty();

      if (this.versions.length === 0) {
        const empty = container.createDiv({ cls: "mindos-evolution-empty" });
        empty.createDiv({ cls: "mindos-evolution-empty-icon", text: "📝" });
        empty.createDiv({ cls: "mindos-evolution-empty-title", text: "暂无版本记录" });
        empty.createDiv({ cls: "mindos-evolution-empty-desc", text: "该页面还没有任何历史版本，修改并保存后会自动生成" });
        return;
      }

      // 筛选器
      const filterContainer = container.createDiv({ cls: "mindos-evolution-filter-container" });
      this.renderFilters(filterContainer, container, filePath);

      // 页面信息头部
      const header = container.createDiv({ cls: "mindos-evolution-versions-header" });
      header.createSpan({ cls: "mindos-evolution-versions-path", text: filePath });
      header.createSpan({ cls: "mindos-evolution-versions-count", text: `${this.filteredVersions.length} 个版本` });

      // 时间线容器（用于滚动加载）
      const timelineWrapper = container.createDiv({ cls: "mindos-evolution-timeline-wrapper" });
      const timeline = timelineWrapper.createDiv({ cls: "mindos-evolution-timeline" });

      // 渲染初始版本
      this.renderVersionItems(timeline, filePath, 0, this.displayedCount);

      // 滚动加载监听
      this.setupScrollLoad(timelineWrapper, timeline, filePath);
    } catch (e) {
      this.isLoading = false;
      container.empty();
      const error = container.createDiv({ cls: "mindos-evolution-error" });
      error.createDiv({ cls: "mindos-evolution-error-icon", text: "⚠️" });
      error.createDiv({ cls: "mindos-evolution-error-message", text: `加载失败：${e instanceof Error ? e.message : "未知错误"}` });
    }
  }

  private renderFilters(container: HTMLElement, listContainer: HTMLElement, filePath: string) {
    const filterBar = container.createDiv({ cls: "mindos-evolution-filter-bar" });
    filterBar.createSpan({ cls: "mindos-evolution-filter-label", text: "筛选：" });

    const filters: { value: VersionFilter, label: string }[] = [
      { value: "all", label: "全部" },
      { value: "latest", label: "最新" },
      { value: "added", label: "新增" },
      { value: "modified", label: "修改" }
    ];

    for (const filter of filters) {
      const btn = filterBar.createDiv({ 
        cls: `mindos-evolution-filter-btn ${this.currentFilter === filter.value ? "is-active" : ""}`,
        text: filter.label
      });
      btn.onclick = async () => {
        this.currentFilter = filter.value;
        this.displayedCount = 10;
        await this.applyFilter(listContainer, filePath);
      };
    }
  }

  private async applyFilter(container: HTMLElement, filePath: string) {
    // 应用筛选逻辑
    switch (this.currentFilter) {
      case "all":
        this.filteredVersions = [...this.versions];
        break;
      case "latest":
        this.filteredVersions = this.versions.slice(0, 1);
        break;
      case "added":
      case "modified":
        // 简单模拟：这里可以根据实际变更类型筛选
        this.filteredVersions = [...this.versions];
        break;
    }

    // 重新渲染
    const timeline = container.querySelector(".mindos-evolution-timeline") as HTMLElement;
    const header = container.querySelector(".mindos-evolution-versions-header") as HTMLElement;
    if (header) {
      const countEl = header.querySelector(".mindos-evolution-versions-count");
      if (countEl) {
        countEl.setText(`${this.filteredVersions.length} 个版本`);
      }
    }
    if (timeline) {
      timeline.empty();
      this.renderVersionItems(timeline, filePath, 0, this.displayedCount);
    }

    // 更新筛选按钮状态
    const filterBtns = container.querySelectorAll(".mindos-evolution-filter-btn");
    filterBtns.forEach(btn => {
      btn.removeClass("is-active");
      if ((btn as HTMLElement).innerText === this.getFilterLabel(this.currentFilter)) {
        btn.addClass("is-active");
      }
    });
  }

  private getFilterLabel(filter: VersionFilter): string {
    const labels: Record<VersionFilter, string> = {
      all: "全部",
      latest: "最新",
      added: "新增",
      modified: "修改"
    };
    return labels[filter];
  }

  private renderVersionItems(
    timeline: HTMLElement, 
    filePath: string, 
    start: number, 
    count: number
  ) {
    const end = Math.min(start + count, this.filteredVersions.length);
    for (let i = start; i < end; i++) {
      const version = this.filteredVersions[i];
      const isLatest = i === 0;
      this.renderVersionItem(timeline, version, isLatest, i, this.filteredVersions.length, filePath);
    }
  }

  private setupScrollLoad(
    wrapper: HTMLElement, 
    timeline: HTMLElement, 
    filePath: string
  ) {
    const loadMore = () => {
      if (this.displayedCount >= this.filteredVersions.length) return;
      
      // 检查是否滚动到底部
      const scrollTop = wrapper.scrollTop;
      const scrollHeight = wrapper.scrollHeight;
      const clientHeight = wrapper.clientHeight;
      
      if (scrollTop + clientHeight >= scrollHeight - 100) {
        const prevCount = this.displayedCount;
        this.displayedCount = Math.min(this.displayedCount + 10, this.filteredVersions.length);
        this.renderVersionItems(timeline, filePath, prevCount, 10);
      }
    };

    wrapper.addEventListener("scroll", loadMore);
  }

  private renderVersionItem(
    parent: HTMLElement, 
    version: PageVersion, 
    isLatest: boolean, 
    index: number, 
    total: number,
    filePath: string
  ) {
    const item = parent.createDiv({ cls: "mindos-evolution-version-item" });

    // 时间线标记
    const marker = item.createDiv({ cls: "mindos-evolution-version-marker" });
    const dot = marker.createDiv({ cls: `mindos-evolution-version-dot ${isLatest ? "is-latest" : ""}` });
    
    if (index < total - 1) {
      marker.createDiv({ cls: "mindos-evolution-version-line" });
    }

    const body = item.createDiv({ cls: "mindos-evolution-version-body" });
    const itemHeader = body.createDiv({ cls: "mindos-evolution-version-header" });
    
    itemHeader.createSpan({ 
      cls: "mindos-evolution-version-number", 
      text: `v${total - index}` 
    });
    itemHeader.createSpan({ 
      cls: "mindos-evolution-version-time", 
      text: this.formatTime(version.timestamp) 
    });
    
    // 状态标签
    const statusBadge = itemHeader.createEl("span", { 
      cls: `mindos-evolution-version-badge ${isLatest ? "is-latest" : "is-history"}`,
      text: isLatest ? "最新" : "历史"
    });

    // 版本摘要
    const summary = body.createDiv({ cls: "mindos-evolution-version-summary" });
    if (index < total - 1) {
      const prevVersion = this.versions[this.versions.indexOf(version) + 1] || version;
      const diff = diffVersions(prevVersion.content, version.content);
      const summaryText = this.getChangeSummary(diff);
      summary.setText(summaryText);
      
      // 变更统计
      const changes = body.createDiv({ cls: "mindos-evolution-version-changes" });
      if (diff.additions > 0) {
        changes.createEl("span", { 
          cls: "mindos-evolution-change-add", 
          text: `+${diff.additions} 行` 
        });
      }
      if (diff.deletions > 0) {
        changes.createEl("span", { 
          cls: "mindos-evolution-change-remove", 
          text: `-${diff.deletions} 行` 
        });
      }
    } else {
      summary.setText("初始版本");
      const changes = body.createDiv({ cls: "mindos-evolution-version-changes" });
      changes.createEl("span", { 
        cls: "mindos-evolution-change-add", 
        text: `+${version.wordCount} 字` 
      });
    }

    // 操作按钮
    const actions = body.createDiv({ cls: "mindos-evolution-version-actions" });

    const viewBtn = actions.createEl("button", { 
      cls: "mindos-evolution-action-btn mindos-evolution-action-view", 
      text: "👁️ 查看" 
    });
    viewBtn.onclick = () => this.viewVersion(version, filePath);

    if (!isLatest) {
      const restoreBtn = actions.createEl("button", { 
        cls: "mindos-evolution-action-btn mindos-evolution-action-restore", 
        text: "↩️ 恢复" 
      });
      restoreBtn.onclick = async () => await this.restoreVersion(version, filePath);
    }

    if (index < total - 1) {
      const diffBtn = actions.createEl("button", { 
        cls: "mindos-evolution-action-btn mindos-evolution-action-diff", 
        text: "📊 对比" 
      });
      diffBtn.onclick = () => {
        const nextIndex = this.versions.indexOf(version) + 1;
        if (nextIndex < this.versions.length) {
          this.showDiff(version, this.versions[nextIndex], filePath);
        }
      };
    }
  }

  private getChangeSummary(diff: DiffResult): string {
    const parts: string[] = [];
    if (diff.additions > 0) {
      parts.push(`新增 ${diff.additions} 行`);
    }
    if (diff.deletions > 0) {
      parts.push(`删除 ${diff.deletions} 行`);
    }
    return parts.length > 0 ? parts.join("，") : "内容微调";
  }

  private viewVersion(version: PageVersion, filePath: string) {
    new FilePreviewModal(this.plugin, version, filePath).open();
  }

  private async restoreVersion(version: PageVersion, filePath: string) {
    if (!confirm(`确定要将 \"${filePath}\" 恢复到此版本吗？当前内容将被覆盖！`)) {
      return;
    }

    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file && file instanceof TFile) {
        await this.plugin.app.vault.modify(file, version.content);
        new Notice("✅ 已成功恢复到该版本！");
        
        // 刷新版本列表
        if (this.container) {
          const contentArea = this.container.querySelector(".mindos-evolution-content") as HTMLElement;
          if (contentArea) {
            contentArea.empty();
            await this.renderVersionsTab(contentArea);
          }
        }
      }
    } catch (e) {
      new Notice(`恢复失败：${e instanceof Error ? e.message : "未知错误"}`);
    }
  }

  private showDiff(newVersion: PageVersion, oldVersion: PageVersion, filePath: string) {
    new VersionDiffModal(this.plugin.app, oldVersion, newVersion, filePath).open();
  }

  // ════════════════════════════════════════════════════════════
  // 健康度报告 Tab
  // ════════════════════════════════════════════════════════════
  private async renderHealthTab(parent: HTMLElement) {
    const container = parent.createDiv({ cls: "mindos-health-container" });

    // 操作栏
    const ops = container.createDiv({ cls: "mindos-health-ops" });
    const refreshBtn = ops.createEl("button", { cls: "mindos-btn is-primary" });
    const refreshIcon = refreshBtn.createSpan({ cls: "mindos-btn-icon" });
    setIcon(refreshIcon, "refresh-cw");
    refreshBtn.createSpan({ cls: "mindos-btn-text", text: "重新分析" });

    const contentArea = container.createDiv({ cls: "mindos-health-content" });

    // 绑定刷新
    refreshBtn.onclick = async () => {
      this.qualityAnalyzer.invalidateCache();
      this.healthReport = null;
      await this.doLoadHealthReport(contentArea);
    };

    if (this.healthReport) {
      this.renderHealthContent(contentArea, this.healthReport);
    } else {
      await this.doLoadHealthReport(contentArea);
    }
  }

  private async doLoadHealthReport(container: HTMLElement) {
    container.empty();

    const loading = container.createDiv({ cls: "mindos-health-loading" });
    loading.createDiv({ cls: "mindos-health-spinner" });
    loading.createEl("p", { cls: "mindos-health-loading-text", text: "正在分析知识库..." });

    try {
      const raw = await this.qualityAnalyzer.analyze();
      // 将 QualityReport 直接映射为 HealthReport（本地接口）
      this.healthReport = {
        generatedAt: raw.generatedAt,
        totalScore: raw.totalScore,
        level: raw.level as HealthReport["level"],
        analyzedNotes: raw.analyzedNotes,
        analyzedWords: raw.analyzedWords,
        metrics: raw.metrics.map(m => ({
          name: m.name,
          value: m.value,
          maxValue: m.maxValue,
          score: m.score,
          label: m.label,
          level: m.level
        })),
        suggestions: raw.suggestions.map(s => ({
          id: s.id,
          priority: s.priority,
          title: s.title,
          description: s.description,
          actionable: s.actionable,
          targetPaths: s.targetPaths,
          estimatedImpact: s.estimatedImpact
        }))
      };
      container.empty();
      this.renderHealthContent(container, this.healthReport);
    } catch (e) {
      container.empty();
      const err = container.createDiv({ cls: "mindos-health-error" });
      const errIcon = err.createSpan({ cls: "mindos-health-error-icon" });
      setIcon(errIcon, "alert-triangle");
      err.createEl("p", { text: `生成报告失败：${e instanceof Error ? e.message : "未知错误"}` });
    }
  }

  private renderHealthContent(parent: HTMLElement, report: HealthReport) {
    parent.empty();

    // ── 空状态 ──
    if (!report || report.metrics.length === 0 || report.analyzedNotes === 0) {
      const empty = parent.createDiv({ cls: "mindos-health-empty" });
      const emptyIcon = empty.createDiv({ cls: "mindos-health-empty-icon" });
      setIcon(emptyIcon, "book-open");
      empty.createDiv({ cls: "mindos-health-empty-title", text: "知识库为空" });
      empty.createDiv({ cls: "mindos-health-empty-desc", text: "创建 Wiki 笔记后，系统将自动分析知识质量" });
      return;
    }

    // ── 总览卡片 ──
    const overview = parent.createDiv({ cls: "mindos-health-overview" });

    // 环形评分
    const circleWrap = overview.createDiv({ cls: "mindos-health-circle-wrap" });
    const score = report.totalScore;
    const scoreColor = score >= 80 ? "var(--mindos-success)" : score >= 60 ? "var(--mindos-warning)" : score >= 40 ? "var(--mindos-info)" : "var(--mindos-danger)";
    const circumference = 2 * Math.PI * 36;
    const strokeDash = circumference * score / 100;

    const svg = createSvgEl(circleWrap, "svg", {
      attr: { width: "88", height: "88", viewBox: "0 0 88 88" }
    });
    // 底圆
    createSvgEl(svg, "circle", {
      attr: { cx: "44", cy: "44", r: "36", fill: "none", stroke: "var(--mindos-bg-tertiary)", "stroke-width": "7" }
    });
    // 进度圆
    createSvgEl(svg, "circle", {
      attr: {
        cx: "44", cy: "44", r: "36",
        fill: "none",
        stroke: scoreColor,
        "stroke-width": "7",
        "stroke-dasharray": `${strokeDash.toFixed(2)} ${circumference.toFixed(2)}`,
        "stroke-dashoffset": "0",
        transform: "rotate(-90 44 44)",
        "stroke-linecap": "round"
      }
    });

    const scoreInner = circleWrap.createDiv({ cls: "mindos-health-circle-inner" });
    scoreInner.createDiv({ cls: "mindos-health-circle-score", text: String(score) });
    scoreInner.createDiv({ cls: "mindos-health-circle-label", text: "综合评分" });

    // 概要信息
    const summary = overview.createDiv({ cls: "mindos-health-summary" });
    const levelBadge = summary.createDiv({ cls: `mindos-health-level-badge level-${this.getLevelKey(score)}` });
    levelBadge.createEl("span", { text: report.level });

    const statsRow = summary.createDiv({ cls: "mindos-health-stats-row" });
    const statItems = [
      { icon: "file-text", value: String(report.analyzedNotes), label: "篇笔记" },
      { icon: "type", value: this.formatNumber(report.analyzedWords), label: "总字数" },
      { icon: "clock", value: this.formatTime(report.generatedAt), label: "分析时间" },
    ];
    for (const s of statItems) {
      const statEl = statsRow.createDiv({ cls: "mindos-health-stat" });
      const statIcon = statEl.createSpan({ cls: "mindos-health-stat-icon" });
      setIcon(statIcon, s.icon);
      statEl.createSpan({ cls: "mindos-health-stat-value", text: s.value });
      statEl.createSpan({ cls: "mindos-health-stat-label", text: s.label });
    }

    // ── 四维度卡片 ──
    const dimSection = parent.createDiv({ cls: "mindos-health-section" });
    const dimHead = dimSection.createDiv({ cls: "mindos-health-section-head" });
    const dimIcon = dimHead.createSpan({ cls: "mindos-health-section-icon" });
    setIcon(dimIcon, "bar-chart-2");
    dimHead.createSpan({ cls: "mindos-health-section-title", text: "质量维度" });

    const dimGrid = dimSection.createDiv({ cls: "mindos-health-dim-grid" });

    const dimIcons: Record<string, string> = {
      "结构完整性": "layout",
      "关联度": "git-branch",
      "更新活跃度": "refresh-cw",
      "信息密度": "layers"
    };
    const dimDescs: Record<string, string> = {
      "结构完整性": "标题、列表、代码块等元素的丰富程度",
      "关联度": "页面间双向链接的覆盖和密度",
      "更新活跃度": "最近修改时间的分布情况",
      "信息密度": "笔记字数是否达到有价值的范围"
    };

    for (const dim of report.metrics) {
      const card = dimGrid.createDiv({ cls: `mindos-health-dim-card level-${dim.level}` });
      const cardTop = card.createDiv({ cls: "mindos-health-dim-top" });
      const dimIconEl = cardTop.createSpan({ cls: "mindos-health-dim-icon" });
      setIcon(dimIconEl, dimIcons[dim.name] ?? "activity");
      cardTop.createSpan({ cls: "mindos-health-dim-name", text: dim.name });
      const dimScore = cardTop.createSpan({ cls: `mindos-health-dim-score level-${dim.level}`, text: String(dim.score) });

      const bar = card.createDiv({ cls: "mindos-health-dim-bar" });
      const fill = bar.createDiv({ cls: `mindos-health-dim-fill level-${dim.level}` });
      fill.style.width = "0%";
      // requestAnimationFrame 动画
      requestAnimationFrame(() => { fill.style.width = `${dim.score}%`; });

      card.createDiv({ cls: "mindos-health-dim-desc", text: dimDescs[dim.name] ?? dim.label });
    }

    // ── 优化建议 ──
    if (report.suggestions.length > 0) {
      const actionable = report.suggestions.filter(s => s.actionable);

      const sugSection = parent.createDiv({ cls: "mindos-health-section" });
      const sugHead = sugSection.createDiv({ cls: "mindos-health-section-head" });
      const sugIcon = sugHead.createSpan({ cls: "mindos-health-section-icon" });
      setIcon(sugIcon, "lightbulb");
      sugHead.createSpan({ cls: "mindos-health-section-title", text: "优化建议" });

      // 一键修复按钮（仅有可执行建议时显示）
      if (actionable.length > 0) {
        const fixAllBtn = sugHead.createEl("button", { cls: "mindos-btn is-sm is-success mindos-health-fix-all-btn" });
        const fixIcon = fixAllBtn.createSpan({ cls: "mindos-btn-icon" });
        setIcon(fixIcon, "zap");
        fixAllBtn.createSpan({ cls: "mindos-btn-text", text: `一键修复 (${actionable.length})` });
        fixAllBtn.onclick = () => this.fixAllIssues(parent, report, fixAllBtn);
      }

      const sugList = sugSection.createDiv({ cls: "mindos-health-sug-list" });

      for (const sug of report.suggestions) {
        const item = sugList.createDiv({ cls: `mindos-health-sug-item priority-${sug.priority}` });

        // 优先级徽章
        const priorityMap: Record<string, { label: string; icon: string }> = {
          high:   { label: "高优先", icon: "alert-circle" },
          medium: { label: "中优先", icon: "info" },
          low:    { label: "低优先", icon: "check-circle" }
        };
        const pm = priorityMap[sug.priority] ?? { label: sug.priority, icon: "circle" };
        const badge = item.createDiv({ cls: `mindos-health-sug-badge priority-${sug.priority}` });
        const badgeIcon = badge.createSpan();
        setIcon(badgeIcon, pm.icon);
        badge.createSpan({ text: pm.label });

        // 内容
        const body = item.createDiv({ cls: "mindos-health-sug-body" });
        body.createDiv({ cls: "mindos-health-sug-title", text: sug.title });
        body.createDiv({ cls: "mindos-health-sug-desc", text: sug.description });
        if (sug.estimatedImpact) {
          const impact = body.createDiv({ cls: "mindos-health-sug-impact" });
          const impactIcon = impact.createSpan();
          setIcon(impactIcon, "trending-up");
          impact.createSpan({ text: sug.estimatedImpact });
        }

        // 受影响文件数（折叠显示）
        if (sug.targetPaths && sug.targetPaths.length > 0) {
          const filesToggle = body.createDiv({ cls: "mindos-health-sug-files-toggle" });
          const toggleIcon = filesToggle.createSpan({ cls: "mindos-health-sug-toggle-icon" });
          setIcon(toggleIcon, "chevron-right");
          filesToggle.createSpan({ text: `涉及 ${sug.targetPaths.length} 个文件` });
          const filesList = body.createDiv({ cls: "mindos-health-sug-files is-hidden" });
          for (const p of sug.targetPaths.slice(0, 10)) {
            const fileItem = filesList.createDiv({ cls: "mindos-health-sug-file" });
            const fileIcon = fileItem.createSpan({ cls: "mindos-health-sug-file-icon" });
            setIcon(fileIcon, "file-text");
            fileItem.createSpan({ text: p.replace(/\.md$/, "") });
          }
          if (sug.targetPaths.length > 10) {
            filesList.createDiv({ cls: "mindos-health-sug-file-more", text: `还有 ${sug.targetPaths.length - 10} 个文件...` });
          }
          filesToggle.onclick = () => {
            const open = filesList.toggleClass("is-hidden", !filesList.hasClass("is-hidden"));
            toggleIcon.empty();
            setIcon(toggleIcon, filesList.hasClass("is-hidden") ? "chevron-right" : "chevron-down");
          };
        }

        // 一键优化按钮
        if (sug.actionable) {
          const btn = item.createEl("button", { cls: "mindos-btn is-sm is-primary mindos-health-sug-fix-btn" });
          const btnIcon = btn.createSpan({ cls: "mindos-btn-icon" });
          setIcon(btnIcon, "zap");
          btn.createSpan({ cls: "mindos-btn-text", text: "一键优化" });
          btn.onclick = () => this.executeSingleFix(sug.id, parent, report, btn);
        }
      }
    }
  }

  // ── 辅助：执行单项修复 ──
  private async executeSingleFix(
    suggestionId: string,
    contentArea: HTMLElement,
    currentReport: HealthReport,
    btn: HTMLButtonElement
  ) {
    btn.disabled = true;
    const btnIcon = btn.querySelector(".mindos-btn-icon") as HTMLElement;
    if (btnIcon) { btnIcon.empty(); setIcon(btnIcon, "loader"); }
    btn.querySelector(".mindos-btn-text")!.textContent = "执行中...";

    try {
      const result = await this.qualityAnalyzer.executeFix(suggestionId);
      if (result.success) {
        new Notice(`✅ ${result.message}`);
        // 强制刷新报告
        this.healthReport = null;
        await this.doLoadHealthReport(contentArea);
      } else {
        new Notice(result.message, 4000);
        btn.disabled = false;
        if (btnIcon) { btnIcon.empty(); setIcon(btnIcon, "zap"); }
        btn.querySelector(".mindos-btn-text")!.textContent = "一键优化";
      }
    } catch (error) {
      new Notice(`执行失败: ${error instanceof Error ? error.message : "未知错误"}`, 4000);
      btn.disabled = false;
    }
  }

  // ── 辅助：批量修复 ──
  private async fixAllIssues(
    contentArea: HTMLElement,
    report: HealthReport,
    btn: HTMLButtonElement
  ) {
    const actionable = report.suggestions.filter(s => s.actionable);
    if (actionable.length === 0) {
      new Notice("没有可以自动修复的问题");
      return;
    }

    btn.disabled = true;
    const btnIcon = btn.querySelector(".mindos-btn-icon") as HTMLElement;
    if (btnIcon) { btnIcon.empty(); setIcon(btnIcon, "loader"); }
    btn.querySelector(".mindos-btn-text")!.textContent = "修复中...";

    try {
      let totalFixed = 0;
      for (const sug of actionable) {
        try {
          const result = await this.qualityAnalyzer.executeFix(sug.id);
          if (result.success) totalFixed += result.fixedCount;
        } catch (e) {
          console.error(`修复 ${sug.id} 失败:`, e);
        }
      }

      if (totalFixed > 0) {
        new Notice(`✅ 批量修复完成，共修复 ${totalFixed} 个问题`);
      } else {
        new Notice("所有问题已是最优状态");
      }
      this.healthReport = null;
      await this.doLoadHealthReport(contentArea);
    } catch (error) {
      new Notice(`批量修复失败: ${error instanceof Error ? error.message : "未知错误"}`, 4000);
      btn.disabled = false;
    }
  }

  private getLevelKey(score: number): string {
    if (score >= 80) return "excellent";
    if (score >= 60) return "good";
    if (score >= 40) return "needs-improvement";
    return "to-add";
  }

  private formatNumber(n: number): string {
    if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
    return n.toLocaleString();
  }

  private formatTime(iso: string): string {
    const d = new Date(iso.replace(" ", "T"));
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60_000);
    
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins}分钟前`;
    
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}小时前`;
    
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}天前`;
    
    return d.toLocaleDateString("zh-CN") + " " + d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }
}
