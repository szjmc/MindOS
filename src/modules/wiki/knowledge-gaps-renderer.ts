import { Notice } from "obsidian";
import type MindOSPlugin from "../../../main";
import { KnowledgeGapAnalyzer, KnowledgeGap, GapAnalysisResult } from "./knowledge-gaps";
import { createSvgEl } from "../../core/utils";

export type GapPriority = "high" | "medium" | "low";

export interface ProcessedGap extends KnowledgeGap {
  priority: GapPriority;
  isProcessed: boolean;
}

export class KnowledgeGapsRenderer {
  private plugin: MindOSPlugin;
  private analyzer: KnowledgeGapAnalyzer;
  private container: HTMLElement | null = null;
  private gaps: ProcessedGap[] = [];
  private isLoading = false;
  private isAnalyzed = false;

  constructor(plugin: MindOSPlugin) {
    this.plugin = plugin;
    this.analyzer = plugin.knowledgeGapAnalyzer;
  }

  setContainer(container: HTMLElement) {
    this.container = container;
  }

  async render() {
    if (!this.container) return;
    this.container.empty();

    if (!this.isAnalyzed) {
      this.renderLoading();
      await this.performAnalysis();
      return;
    }

    if (this.gaps.length === 0) {
      this.renderEmptyState();
      return;
    }

    this.renderStats();
    this.renderGapList();
  }

  private renderLoading() {
    if (!this.container) return;

    const loadingWrap = this.container.createDiv({ cls: "mindos-gaps-loading" });
    
    const spinner = loadingWrap.createDiv({ cls: "mindos-gaps-spinner" });
    loadingWrap.createEl("p", { cls: "mindos-gaps-loading-text", text: "正在扫描知识库..." });
    
    const progressBar = loadingWrap.createDiv({ cls: "mindos-gaps-progress-bar" });
    progressBar.createDiv({ cls: "mindos-gaps-progress-fill" });
  }

  private async performAnalysis() {
    if (!this.container || this.isLoading) return;
    
    this.isLoading = true;
    
    try {
      const result = await this.analyzer.analyzeKnowledgeGaps();
      this.gaps = this.processGaps(result.gaps);
      this.isAnalyzed = true;
      
      this.container.empty();
      
      if (this.gaps.length === 0) {
        this.renderEmptyState();
      } else {
        this.renderStats();
        this.renderGapList();
      }
    } catch (error) {
      if (this.container) {
        this.container.empty();
        this.renderError(error);
      }
    } finally {
      this.isLoading = false;
    }
  }

  private processGaps(gaps: KnowledgeGap[]): ProcessedGap[] {
    return gaps.map(gap => {
      let priority: GapPriority = "low";
      
      if (gap.confidence >= 0.7) {
        priority = "high";
      } else if (gap.confidence >= 0.5) {
        priority = "medium";
      }
      
      return {
        ...gap,
        priority,
        isProcessed: false,
      };
    });
  }

  private renderEmptyState() {
    if (!this.container) return;

    const emptyWrap = this.container.createDiv({ cls: "mindos-gaps-empty" });
    
    const illustration = emptyWrap.createDiv({ cls: "mindos-gaps-illustration" });
    const svg = createSvgEl(illustration, "svg", {
      attr: { viewBox: "0 0 200 120", width: "160", height: "96" }
    });
    
    const circleGroup = createSvgEl(svg, "g");
    createSvgEl(circleGroup, "circle", {
      attr: { cx: "100", cy: "60", r: "45", fill: "none", stroke: "#10b981", "stroke-width": "3", "stroke-dasharray": "283", "stroke-dashoffset": "0" }
    });
    
    createSvgEl(circleGroup, "circle", {
      attr: { cx: "100", cy: "60", r: "35", fill: "none", stroke: "#34d399", "stroke-width": "2", "stroke-dasharray": "220", "stroke-dashoffset": "0" }
    });
    
    createSvgEl(circleGroup, "circle", {
      attr: { cx: "100", cy: "60", r: "25", fill: "none", stroke: "#6ee7b7", "stroke-width": "2", "stroke-dasharray": "157", "stroke-dashoffset": "0" }
    });
    
    const checkGroup = createSvgEl(svg, "g", { attr: { fill: "#10b981" } });
    createSvgEl(checkGroup, "path", { attr: { d: "M 85 60 L 95 70 L 115 50", stroke: "#10b981", "stroke-width": "3", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" } });
    
    const statsGroup = createSvgEl(svg, "g", { attr: { fill: "#10b981", "font-size": "10", "font-family": "system-ui" } });
    createSvgEl(statsGroup, "text", { attr: { x: "25", y: "45" }, text: "✓ 完整" });
    createSvgEl(statsGroup, "text", { attr: { x: "140", y: "45" }, text: "✓ 无缺" });
    createSvgEl(statsGroup, "text", { attr: { x: "25", y: "85" }, text: "✓ 覆盖" });
    createSvgEl(statsGroup, "text", { attr: { x: "140", y: "85" }, text: "✓ 关联" });

    emptyWrap.createDiv({ cls: "mindos-gaps-empty-title", text: "🎉 当前主题知识覆盖较完整，继续保持！" });
    emptyWrap.createDiv({ cls: "mindos-gaps-empty-desc", text: "系统未发现明显的知识空白，建议继续丰富内容" });

    const actionsWrap = emptyWrap.createDiv({ cls: "mindos-gaps-empty-actions" });
    
    const refreshBtn = actionsWrap.createEl("button", { cls: "mindos-gaps-btn mindos-gaps-btn-secondary" });
    const icon = refreshBtn.createEl("span", { cls: "mindos-gaps-btn-icon", text: "🔄" });
    const text = refreshBtn.createEl("span", { cls: "mindos-gaps-btn-text", text: "重新扫描" });
    refreshBtn.onclick = () => {
      this.isAnalyzed = false;
      this.render();
    };
  }

  private renderError(error: any) {
    if (!this.container) return;

    const errorWrap = this.container.createDiv({ cls: "mindos-gaps-error" });
    errorWrap.createDiv({ cls: "mindos-gaps-error-icon", text: "⚠️" });
    errorWrap.createDiv({ cls: "mindos-gaps-error-title", text: "分析失败" });
    errorWrap.createDiv({ cls: "mindos-gaps-error-desc", text: error instanceof Error ? error.message : String(error) });

    const retryBtn = this.container.createEl("button", { cls: "mindos-gaps-btn mindos-gaps-btn-primary" });
    const retryIcon = retryBtn.createEl("span", { cls: "mindos-gaps-btn-icon", text: "🔄" });
    const retryText = retryBtn.createEl("span", { cls: "mindos-gaps-btn-text", text: "重试" });
    retryBtn.onclick = () => {
      this.isAnalyzed = false;
      this.render();
    };
  }

  private renderStats() {
    if (!this.container) return;

    const totalGaps = this.gaps.length;
    const highPriorityCount = this.gaps.filter(g => g.priority === "high").length;
    const processedCount = this.gaps.filter(g => g.isProcessed).length;
    const processedRate = totalGaps > 0 ? Math.round((processedCount / totalGaps) * 100) : 0;

    const statsWrap = this.container.createDiv({ cls: "mindos-gaps-stats" });
    
    const totalCard = statsWrap.createDiv({ cls: "mindos-gaps-stat-card" });
    totalCard.createDiv({ cls: "mindos-gaps-stat-value", text: String(totalGaps) });
    totalCard.createDiv({ cls: "mindos-gaps-stat-label", text: "缺口总数" });
    
    const highCard = statsWrap.createDiv({ cls: "mindos-gaps-stat-card" });
    highCard.createDiv({ cls: "mindos-gaps-stat-value mindos-gaps-stat-high", text: String(highPriorityCount) });
    highCard.createDiv({ cls: "mindos-gaps-stat-label", text: "高优先级" });

    const rateCard = statsWrap.createDiv({ cls: "mindos-gaps-stat-card" });
    rateCard.createDiv({ cls: "mindos-gaps-stat-value", text: `${processedRate}%` });
    rateCard.createDiv({ cls: "mindos-gaps-stat-label", text: "已处理率" });

    const refreshBtn = statsWrap.createEl("button", { cls: "mindos-gaps-refresh-btn" });
    refreshBtn.createEl("span", { text: "🔄" });
    refreshBtn.createEl("span", { text: "刷新" });
    refreshBtn.onclick = () => {
      this.isAnalyzed = false;
      this.render();
    };
  }

  private renderGapList() {
    if (!this.container) return;

    const listWrap = this.container.createDiv({ cls: "mindos-gaps-list" });

    for (const gap of this.gaps) {
      this.renderGapCard(listWrap, gap);
    }
  }

  private renderGapCard(parent: HTMLElement, gap: ProcessedGap) {
    const card = parent.createDiv({ cls: `mindos-gaps-card mindos-gaps-priority-${gap.priority}${gap.isProcessed ? " is-processed" : ""}` });

    const cardHeader = card.createDiv({ cls: "mindos-gaps-card-header" });
    cardHeader.createDiv({ cls: "mindos-gaps-card-title", text: gap.title });

    const badges = cardHeader.createDiv({ cls: "mindos-gaps-card-badges" });
    badges.createEl("span", {
      cls: "mindos-gaps-priority-badge",
      text: gap.priority === "high" ? "高" : gap.priority === "medium" ? "中" : "低"
    });
    badges.createEl("span", {
      cls: "mindos-gaps-type-badge",
      text: this.getPageTypeLabel(gap.pageType)
    });

    const reason = card.createDiv({ cls: "mindos-gaps-card-reason", text: gap.reason });
    const related = card.createDiv({ cls: "mindos-gaps-card-related" });
    related.createEl("span", { text: "关联页面：" });
    related.createEl("span", { text: gap.suggestedBy });

    const confidence = card.createDiv({ cls: "mindos-gaps-card-confidence" });
    const progressBar = confidence.createDiv({ cls: "mindos-gaps-confidence-bar" });
    const progressFill = progressBar.createDiv({ cls: "mindos-gaps-confidence-fill" });
    progressFill.style.width = `${gap.confidence * 100}%`;
    confidence.createEl("span", { text: `${Math.round(gap.confidence * 100)}%` });

    const actions = card.createDiv({ cls: "mindos-gaps-card-actions" });
    
    const createBtn = actions.createEl("button", { cls: "mindos-gaps-action-btn mindos-gaps-action-create" });
    createBtn.createEl("span", { text: "📝" });
    createBtn.createEl("span", { text: "一键创建笔记" });
    createBtn.onclick = () => this.createGapPage(gap);

    const viewBtn = actions.createEl("button", { cls: "mindos-gaps-action-btn" });
    viewBtn.createEl("span", { text: "📖" });
    viewBtn.createEl("span", { text: "查看关联页面" });
    viewBtn.onclick = () => this.viewRelatedPage(gap);

    const ignoreBtn = actions.createEl("button", { cls: "mindos-gaps-action-btn mindos-gaps-action-ignore" });
    ignoreBtn.createEl("span", { text: gap.isProcessed ? "↩️" : "✕" });
    ignoreBtn.createEl("span", { text: gap.isProcessed ? "已处理" : "标记已处理" });
    ignoreBtn.onclick = () => this.toggleProcessed(gap);
  }

  private getPageTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      entity: "实体",
      concept: "概念",
      topic: "主题",
      comparison: "对比",
      overview: "概览",
    };
    return labels[type] || type;
  }

  private async createGapPage(gap: ProcessedGap) {
    this.plugin.isOpeningFile = true;
    try {
      const path = await this.analyzer.createGapPage(gap);
      if (path) {
        new Notice(`✅ 已创建：${gap.title}`);
        await this.plugin.openFile(path);
      } else {
        new Notice("文件已存在");
      }
    } catch (error) {
      new Notice(`创建失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimeout(() => {
        this.plugin.isOpeningFile = false;
      }, 500);
    }
  }

  private async viewRelatedPage(gap: ProcessedGap) {
    this.plugin.isOpeningFile = true;
    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(gap.relatedPages[0]);
      if (file) {
        await this.plugin.openFile(gap.relatedPages[0]);
      }
    } catch (error) {
      new Notice(`打开失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setTimeout(() => {
        this.plugin.isOpeningFile = false;
      }, 500);
    }
  }

  private toggleProcessed(gap: ProcessedGap) {
    gap.isProcessed = !gap.isProcessed;
    this.render();
    new Notice(gap.isProcessed ? `已标记"${gap.title}"为已处理` : `已取消标记"${gap.title}"`);
  }
}
