import { App, Modal, Notice, setIcon } from "obsidian";
import { KnowledgeGap, KnowledgeGapAnalyzer } from "../modules/wiki/knowledge-gaps";

export class KnowledgeGapsModal extends Modal {
  private analyzer: KnowledgeGapAnalyzer;
  private selectedGaps: Set<string> = new Set();
  private isAnalyzing = false;
  private resultContainer: HTMLElement | null = null;

  constructor(app: App, analyzer: KnowledgeGapAnalyzer) {
    super(app);
    this.analyzer = analyzer;
    this.titleEl.setText("🧠 知识空白雷达");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-gaps-modal");
    contentEl.empty();

    this.renderHeader(contentEl);
    this.renderLoading(contentEl);
    this.performAnalysis();
  }

  private renderHeader(parent: HTMLElement) {
    const header = parent.createDiv({ cls: "mindos-gaps-header" });
    header.createEl("h2", { cls: "mindos-gaps-title", text: "🧠 知识空白雷达" });
    header.createEl("p", {
      cls: "mindos-gaps-desc",
      text: "扫描你的 Wiki，发现应该有但还没有的页面",
    });
  }

  private renderLoading(parent: HTMLElement) {
    if (this.resultContainer) {
      this.resultContainer.remove();
    }
    this.resultContainer = parent.createDiv({ cls: "mindos-gaps-loading" });
    const loading = this.resultContainer.createDiv({ cls: "mindos-gaps-loading-content" });
    loading.createEl("div", { cls: "mindos-gaps-spinner" });
    loading.createEl("p", { text: "正在扫描知识库..." });
  }

  private async performAnalysis() {
    this.isAnalyzing = true;
    try {
      const result = await this.analyzer.analyzeKnowledgeGaps();
      this.renderResult(result);
    } catch (e) {
      console.error("Knowledge gap analysis failed:", e);
      if (this.resultContainer) {
        this.resultContainer.empty();
        this.resultContainer.createEl("p", {
          cls: "mindos-gaps-error",
          text: `分析失败：${e instanceof Error ? e.message : "未知错误"}`,
        });
      }
    } finally {
      this.isAnalyzing = false;
    }
  }

  private renderResult(result: { gaps: KnowledgeGap[]; totalPages: number; analyzedPages: number; suggestions: string }) {
    if (this.resultContainer) {
      this.resultContainer.remove();
    }

    const { contentEl } = this;
    this.resultContainer = contentEl.createDiv({ cls: "mindos-gaps-result" });

    this.renderStats(this.resultContainer, result);
    this.renderSuggestions(this.resultContainer, result.suggestions);
    this.renderGapList(this.resultContainer, result.gaps);
    this.renderActions(this.resultContainer, result.gaps);
  }

  private renderStats(parent: HTMLElement, result: { totalPages: number; analyzedPages: number }) {
    const stats = parent.createDiv({ cls: "mindos-gaps-stats" });
    
    const statItems = [
      { label: "知识库总页数", value: result.totalPages },
      { label: "已分析页数", value: result.analyzedPages },
      { label: "发现空白", value: result.totalPages - result.analyzedPages },
    ];

    for (const item of statItems) {
      const stat = stats.createDiv({ cls: "mindos-gaps-stat-item" });
      stat.createEl("span", { cls: "mindos-gaps-stat-value", text: String(item.value) });
      stat.createEl("span", { cls: "mindos-gaps-stat-label", text: item.label });
    }
  }

  private renderSuggestions(parent: HTMLElement, suggestions: string) {
    const suggestionsEl = parent.createDiv({ cls: "mindos-gaps-suggestions" });
    suggestionsEl.createEl("h3", { cls: "mindos-gaps-section-title", text: "💡 AI 建议" });
    suggestionsEl.createEl("p", { cls: "mindos-gaps-suggestion-text", text: suggestions });
  }

  private renderGapList(parent: HTMLElement, gaps: KnowledgeGap[]) {
    const listContainer = parent.createDiv({ cls: "mindos-gaps-list-container" });
    listContainer.createEl("h3", { cls: "mindos-gaps-section-title" }).setText(
      `📋 知识空白列表 (${gaps.length})`
    );

    if (gaps.length === 0) {
      listContainer.createEl("p", { cls: "mindos-gaps-empty", text: "🎉 太棒了！你的知识库非常完整，没有发现明显的知识空白。" });
      return;
    }

    const list = listContainer.createDiv({ cls: "mindos-gaps-list" });

    for (const gap of gaps) {
      const gapItem = list.createDiv({ cls: "mindos-gaps-list-item" });
      
      const checkbox = gapItem.createEl("input", { type: "checkbox" });
      checkbox.checked = this.selectedGaps.has(gap.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selectedGaps.add(gap.id);
        } else {
          this.selectedGaps.delete(gap.id);
        }
        this.updateSelectAll();
      });

      const gapContent = gapItem.createDiv({ cls: "mindos-gaps-gap-content" });
      
      const gapHeader = gapContent.createDiv({ cls: "mindos-gaps-gap-header" });
      gapHeader.createEl("span", { cls: "mindos-gaps-gap-title", text: gap.title });
      
      const typeBadge = gapHeader.createEl("span", {
        cls: `mindos-gaps-type-badge mindos-gaps-type-${gap.pageType}`,
        text: this.getPageTypeLabel(gap.pageType),
      });
      
      const confidence = gapContent.createDiv({ cls: "mindos-gaps-confidence" });
      const confidenceBar = confidence.createDiv({ cls: "mindos-gaps-confidence-bar" });
      const confidenceFill = confidenceBar.createDiv({ cls: "mindos-gaps-confidence-fill" });
      confidenceFill.style.width = `${gap.confidence * 100}%`;
      confidence.createEl("span", { cls: "mindos-gaps-confidence-text", text: `${Math.round(gap.confidence * 100)}%` });

      gapContent.createEl("p", { cls: "mindos-gaps-gap-reason", text: gap.reason });
      
      const related = gapContent.createDiv({ cls: "mindos-gaps-related" });
      related.createEl("span", { cls: "mindos-gaps-related-label", text: "关联页面：" });
      related.createEl("span", { cls: "mindos-gaps-related-value", text: gap.suggestedBy });
    }

    const selectAllRow = listContainer.createDiv({ cls: "mindos-gaps-select-all-row" });
    const selectAll = selectAllRow.createEl("input", { type: "checkbox" });
    selectAll.addEventListener("change", () => {
      if (selectAll.checked) {
        gaps.forEach(g => this.selectedGaps.add(g.id));
      } else {
        this.selectedGaps.clear();
      }
      list.querySelectorAll("input[type='checkbox']").forEach((el) => {
        (el as HTMLInputElement).checked = selectAll.checked;
      });
    });
    selectAllRow.createEl("label", { text: "全选" });
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

  private updateSelectAll() {
    const selectAll = this.resultContainer?.querySelector(".mindos-gaps-select-all-row input");
    if (selectAll) {
      const allCheckboxes = this.resultContainer?.querySelectorAll(".mindos-gaps-list-item input");
      const total = allCheckboxes?.length || 0;
      const checked = this.selectedGaps.size;
      (selectAll as HTMLInputElement).checked = total > 0 && checked === total;
    }
  }

  private renderActions(parent: HTMLElement, gaps: KnowledgeGap[]) {
    const actions = parent.createDiv({ cls: "mindos-gaps-actions" });

    const refreshBtn = actions.createEl("button", { cls: "mindos-gaps-btn mindos-gaps-btn-secondary" });
    setIcon(refreshBtn.createSpan(), "refresh-cw");
    refreshBtn.createSpan({ text: " 重新分析" });
    refreshBtn.addEventListener("click", () => {
      this.renderLoading(parent);
      this.performAnalysis();
    });

    if (gaps.length > 0) {
      const createBtn = actions.createEl("button", { cls: "mindos-gaps-btn mindos-gaps-btn-primary" });
      setIcon(createBtn.createSpan(), "plus");
      createBtn.createSpan({ text: " 创建选中页面" });
      createBtn.addEventListener("click", () => this.createSelectedPages(gaps));
    }
  }

  private async createSelectedPages(gaps: KnowledgeGap[]) {
    const selectedGaps = gaps.filter(g => this.selectedGaps.has(g.id));
    
    if (selectedGaps.length === 0) {
      new Notice("请先选择要创建的页面");
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const gap of selectedGaps) {
      try {
        const path = await this.analyzer.createGapPage(gap);
        if (path) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
        console.error(`Failed to create ${gap.title}:`, e);
      }
    }

    new Notice(`创建完成！成功: ${successCount}, 失败: ${failCount}`);
    
    this.selectedGaps.clear();
    this.renderLoading(this.contentEl);
    this.performAnalysis();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}