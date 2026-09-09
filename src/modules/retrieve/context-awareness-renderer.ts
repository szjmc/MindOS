import { setIcon, Notice } from "obsidian";
import type MindOSPlugin from "../../../main";
import { ContextAwarenessService, Recommendation } from "./context-awareness";
import { createSvgEl } from "../../core/utils";

export class ContextAwarenessRenderer {
  private plugin: MindOSPlugin;
  private service: ContextAwarenessService;
  private container: HTMLElement | null = null;
  private recommendations: Recommendation[] = [];
  private isLoading = false;

  constructor(plugin: MindOSPlugin) {
    this.plugin = plugin;
    this.service = plugin.contextAwarenessService;
  }

  setContainer(container: HTMLElement) {
    this.container = container;
  }

  destroy() {
  }

  async render() {
    if (!this.container) return;
    this.container.empty();

    const activeFile = this.plugin.app.workspace.getActiveFile();
    
    const isWikiFile = activeFile && (
      activeFile.path.includes('知识库') || 
      activeFile.path.includes('wiki') ||
      activeFile.path.includes(this.plugin.settings.baseFolder)
    );
    
    if (!activeFile || !isWikiFile) {
      this.renderEmptyState(this.container);
      return;
    }

    await this.renderRecommendations(this.container);
  }

  private renderEmptyState(parent: HTMLElement) {
    const emptyWrap = parent.createDiv({ cls: "mindos-context-empty" });
    
    const illustration = emptyWrap.createDiv({ cls: "mindos-context-illustration" });
    const svg = createSvgEl(illustration, "svg", {
      attr: { viewBox: "0 0 200 150", width: "120", height: "90" }
    });
    
    const bookGroup = createSvgEl(svg, "g");
    createSvgEl(bookGroup, "rect", {
      attr: { x: "30", y: "50", width: "60", height: "70", rx: "3", fill: "#f1f1f1", stroke: "#ddd", "stroke-width": "1.5" }
    });
    createSvgEl(bookGroup, "rect", {
      attr: { x: "35", y: "55", width: "50", height: "12", rx: "2", fill: "#e8e8e8" }
    });
    createSvgEl(bookGroup, "rect", {
      attr: { x: "35", y: "72", width: "45", height: "8", rx: "1", fill: "#f8f8f8" }
    });
    createSvgEl(bookGroup, "rect", {
      attr: { x: "35", y: "85", width: "40", height: "8", rx: "1", fill: "#f8f8f8" }
    });
    createSvgEl(bookGroup, "rect", {
      attr: { x: "35", y: "98", width: "35", height: "8", rx: "1", fill: "#f8f8f8" }
    });

    const bookGroup2 = createSvgEl(svg, "g");
    createSvgEl(bookGroup2, "rect", {
      attr: { x: "110", y: "60", width: "50", height: "60", rx: "3", fill: "#fafafa", stroke: "#ddd", "stroke-width": "1.5" }
    });
    createSvgEl(bookGroup2, "rect", {
      attr: { x: "115", y: "65", width: "40", height: "10", rx: "2", fill: "#f0f0f0" }
    });
    createSvgEl(bookGroup2, "rect", {
      attr: { x: "115", y: "80", width: "35", height: "6", rx: "1", fill: "#fafafa" }
    });
    createSvgEl(bookGroup2, "rect", {
      attr: { x: "115", y: "91", width: "30", height: "6", rx: "1", fill: "#fafafa" }
    });

    const linesGroup = createSvgEl(svg, "g", { attr: { stroke: "#b4a7d6", "stroke-width": "2", fill: "none" } });
    createSvgEl(linesGroup, "path", {
      attr: { d: "M 90 75 Q 100 65 110 70", "stroke-dasharray": "4 2" }
    });
    createSvgEl(linesGroup, "path", {
      attr: { d: "M 90 90 Q 105 85 110 95", "stroke-dasharray": "4 2" }
    });

    const arrowGroup = createSvgEl(svg, "g", { attr: { fill: "#b4a7d6" } });
    createSvgEl(arrowGroup, "path", { attr: { d: "M 105 68 L 112 72 L 105 76 Z" } });
    createSvgEl(arrowGroup, "path", { attr: { d: "M 105 88 L 112 92 L 105 96 Z" } });

    emptyWrap.createDiv({ cls: "mindos-context-empty-title", text: "打开一篇Wiki笔记" });
    emptyWrap.createDiv({ cls: "mindos-context-empty-desc", text: "系统将基于上下文为你推荐关联内容" });
  }

  private async renderRecommendations(parent: HTMLElement) {
    if (this.isLoading) return;
    
    this.isLoading = true;
    
    const header = parent.createDiv({ cls: "mindos-context-header" });
    header.createDiv({ cls: "mindos-context-header-title", text: "智能推荐" });
    const refreshBtn = header.createEl("button", { cls: "mindos-context-refresh-btn" });
    const iconSpan = refreshBtn.createEl("span", { cls: "mindos-refresh-icon", text: "🔄" });
    const textSpan = refreshBtn.createEl("span", { cls: "mindos-refresh-text", text: "刷新" });
    refreshBtn.title = "刷新推荐";
    refreshBtn.onclick = () => this.render();

    const loadingEl = parent.createDiv({ cls: "mindos-context-loading" });
    loadingEl.createDiv({ cls: "mindos-context-spinner" });
    loadingEl.createEl("span", { cls: "mindos-context-loading-text", text: "正在分析上下文..." });

    try {
      this.recommendations = await this.service.generateRecommendations(8);
      
      this.recommendations.sort((a, b) => b.score - a.score);
      
      loadingEl.remove();

      if (this.recommendations.length === 0) {
        const emptyState = parent.createDiv({ cls: "mindos-context-no-results" });
        emptyState.createDiv({ cls: "mindos-context-no-results-icon" }).setText("🔍");
        emptyState.createDiv({ cls: "mindos-context-no-results-title", text: "暂无相关推荐" });
        emptyState.createDiv({ cls: "mindos-context-no-results-desc", text: "尝试添加更多标签或链接以获取更好的推荐" });
        return;
      }

      const cardsWrap = parent.createDiv({ cls: "mindos-context-cards" });
      
      for (let i = 0; i < this.recommendations.length; i++) {
        const rec = this.recommendations[i];
        const card = this.createRecommendationCard(rec, i);
        cardsWrap.appendChild(card);
      }
    } catch (error) {
      loadingEl.remove();
      const errorEl = parent.createDiv({ cls: "mindos-context-error" });
      errorEl.createDiv({ cls: "mindos-context-error-icon" }).setText("⚠️");
      const errorMsg = error instanceof Error ? error.message : String(error);
      errorEl.createDiv({ cls: "mindos-context-error-text", text: "推荐失败: " + errorMsg });
    } finally {
      this.isLoading = false;
    }
  }

  private createRecommendationCard(rec: Recommendation, index: number): HTMLElement {
    const card = document.createElement("div");
    const safeScore = Number.isFinite(rec.score) ? rec.score : 0.5;
    
    let cardClass = "mindos-context-card";
    if (safeScore >= 0.7) {
      cardClass += " mindos-context-card-highlight";
    } else if (safeScore >= 0.5) {
      cardClass += " mindos-context-card-medium";
    }
    card.className = cardClass;

    const cardHeader = card.createDiv({ cls: "mindos-context-card-header" });
    
    const scoreBadge = cardHeader.createEl("span", { 
      cls: "mindos-context-score " + this.getScoreClass(safeScore),
      text: Math.round(safeScore * 100) + "%"
    });
    
    const pageType = this.getPageType(rec.category, rec.file.basename);
    const typeBadge = cardHeader.createEl("span", { 
      cls: "mindos-context-type-badge mindos-context-type-" + pageType,
      text: pageType
    });

    card.createDiv({ cls: "mindos-context-card-title", text: rec.file.basename });
    
    if (rec.matchReason) {
      card.createDiv({ cls: "mindos-context-card-reason", text: rec.matchReason });
    }

    if (rec.preview) {
      card.createDiv({ cls: "mindos-context-card-preview", text: rec.preview });
    }

    const actions = card.createDiv({ cls: "mindos-context-card-actions" });
    
    const openBtn = actions.createEl("button", { cls: "mindos-context-action-btn mindos-context-action-open" });
    openBtn.createEl("span", { cls: "mindos-action-icon", text: "👁️" });
    openBtn.createEl("span", { cls: "mindos-action-tooltip", text: "打开" });
    openBtn.title = "打开查看";
    openBtn.onclick = () => this.openFile(rec.file.path);

    const linkBtn = actions.createEl("button", { cls: "mindos-context-action-btn mindos-context-action-link" });
    linkBtn.createEl("span", { cls: "mindos-action-icon", text: "🔗" });
    linkBtn.createEl("span", { cls: "mindos-action-tooltip", text: "关联" });
    linkBtn.title = "一键添加关联";
    linkBtn.onclick = () => this.addLink(rec.file.basename);

    const ignoreBtn = actions.createEl("button", { cls: "mindos-context-action-btn mindos-context-action-ignore" });
    ignoreBtn.createEl("span", { cls: "mindos-action-icon", text: "✕" });
    ignoreBtn.createEl("span", { cls: "mindos-action-tooltip", text: "忽略" });
    ignoreBtn.title = "不感兴趣";
    ignoreBtn.onclick = () => this.ignoreRecommendation(rec, card);

    return card;
  }

  private getPageType(category: string, basename: string): string {
    const lower = basename.toLowerCase();
    if (lower.includes("主题") || lower.includes("topic")) {
      return "主题";
    } else if (lower.includes("概念") || lower.includes("concept")) {
      return "概念";
    } else if (category.toLowerCase().includes("entity") || lower.includes("实体")) {
      return "实体";
    }
    if (basename.match(/^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/)) {
      return "实体";
    }
    return "概念";
  }

  private getScoreClass(score: number): string {
    if (score >= 0.7) return "mindos-score-high";
    if (score >= 0.4) return "mindos-score-medium";
    return "mindos-score-low";
  }

  private async openFile(path: string) {
    this.plugin.isOpeningFile = true;
    try {
      await this.plugin.openFile(path);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      new Notice("打开文件失败: " + errorMsg);
    } finally {
      setTimeout(() => {
        this.plugin.isOpeningFile = false;
      }, 500);
    }
  }

  private async addLink(pageName: string) {
    const activeFile = this.plugin.app.workspace.getActiveFile();
    if (!activeFile) return;

    try {
      const content = await this.plugin.app.vault.read(activeFile);
      const link = "[[" + pageName + "]]";
      
      if (content.includes(link)) {
        new Notice("链接已存在");
        return;
      }

      let newContent = content;
      if (!content.endsWith("\n")) {
        newContent += "\n";
      }
      newContent += "\n" + link;

      await this.plugin.app.vault.modify(activeFile, newContent);
      new Notice("已添加关联");
      
      setTimeout(() => this.render(), 500);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      new Notice("添加链接失败: " + errorMsg);
    }
  }

  private ignoreRecommendation(rec: Recommendation, card: HTMLElement) {
    card.style.opacity = "0.5";
    card.style.transform = "scale(0.98)";
    
    setTimeout(() => {
      card.remove();
      this.recommendations = this.recommendations.filter(r => r.file.path !== rec.file.path);
      
      if (this.recommendations.length === 0 && this.container) {
        this.render();
      }
    }, 300);
    
    new Notice("已屏蔽此推荐");
  }
}
