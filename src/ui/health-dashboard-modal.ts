import { App, Modal } from "obsidian";
import { HealthReportGenerator } from "../modules/wiki/health-report";
import { HealthReport, HealthMetrics } from "../core/types";

export class HealthDashboardModal extends Modal {
  private report: HealthReport | null = null;
  private isLoading = true;

  constructor(
    app: App,
    private generator: HealthReportGenerator,
  ) {
    super(app);
    this.titleEl.setText("🏥 知识库健康度报告");
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-health-modal");
    contentEl.empty();

    this.renderHeader(contentEl);
    this.renderLoading(contentEl);

    try {
      this.report = await this.generator.generate();
      this.isLoading = false;
      this.renderContent(contentEl);
    } catch (e) {
      contentEl.empty();
      contentEl.createEl("p", {
        cls: "mindos-health-error",
        text: `生成报告失败：${e instanceof Error ? e.message : "未知错误"}`,
      });
    }
  }

  private renderHeader(parent: HTMLElement) {
    const header = parent.createDiv({ cls: "mindos-health-header" });
    header.createEl("h3", { cls: "mindos-health-title", text: "🏥 知识库健康度报告" });
  }

  private renderLoading(parent: HTMLElement) {
    const loading = parent.createDiv({ cls: "mindos-health-loading" });
    loading.createEl("div", { cls: "mindos-health-spinner" });
    loading.createEl("p", { cls: "mindos-health-loading-text", text: "正在分析知识库..." });
  }

  private renderContent(parent: HTMLElement) {
    parent.empty();
    this.renderHeader(parent);

    if (!this.report) return;

    const { metrics, healthScore, recommendations } = this.report;

    // Score circle
    this.renderScore(parent, healthScore);

    // Date
    parent.createEl("p", {
      cls: "mindos-health-date",
      text: `生成时间：${new Date(this.report.generatedAt).toLocaleString("zh-CN")}`,
    });

    // Metric cards
    this.renderMetricsGrid(parent, metrics);

    // Maturity distribution
    if (Object.keys(metrics.maturityDistribution).length > 0) {
      this.renderMaturitySection(parent, metrics);
    }

    // Freshness
    this.renderFreshnessSection(parent, metrics);

    // Top linked
    if (metrics.topLinkedPages.length > 0) {
      this.renderTopLinkedSection(parent, metrics);
    }

    // Recommendations
    this.renderRecommendations(parent, recommendations);
  }

  private renderScore(parent: HTMLElement, score: number) {
    const scoreSection = parent.createDiv({ cls: "mindos-health-score-section" });
    const circle = scoreSection.createDiv({ cls: "mindos-health-score-circle" });

    const level = score >= 80 ? "is-good" : score >= 60 ? "is-moderate" : "is-poor";
    const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

    circle.style.setProperty("--score-color", color);
    circle.addClass(level);

    circle.createDiv({ cls: "mindos-health-score-num", text: String(score) });
    circle.createDiv({
      cls: "mindos-health-score-label",
      text: score >= 80 ? "优秀" : score >= 60 ? "良好" : "需改善",
    });
  }

  private renderMetricsGrid(parent: HTMLElement, m: HealthMetrics) {
    const grid = parent.createDiv({ cls: "mindos-health-grid" });

    const cards: { icon: string; label: string; value: string | number; sub?: string }[] = [
      { icon: "📄", label: "总页面", value: m.totalPages },
      { icon: "📝", label: "总字数", value: m.totalWords.toLocaleString() },
      { icon: "📊", label: "平均字数/页", value: m.averageWordCount, sub: "词" },
      { icon: "🔗", label: "平均链接/页", value: m.averageLinksPerPage },
      { icon: "🏝️", label: "孤立页面", value: m.orphanPages, sub: `${m.totalPages > 0 ? Math.round(m.orphanPages / m.totalPages * 100) : 0}%` },
      { icon: "📄", label: "内容不足", value: m.stubPages, sub: "< 50词" },
    ];

    for (const card of cards) {
      const cell = grid.createDiv({ cls: "mindos-health-card" });
      cell.createDiv({ cls: "mindos-health-card-icon", text: card.icon });
      const info = cell.createDiv({ cls: "mindos-health-card-info" });
      info.createDiv({ cls: "mindos-health-card-value" }).setText(String(card.value));
      info.createDiv({ cls: "mindos-health-card-label" }).setText(card.label);
      if (card.sub) {
        info.createDiv({ cls: "mindos-health-card-sub" }).setText(card.sub);
      }
    }
  }

  private renderMaturitySection(parent: HTMLElement, m: HealthMetrics) {
    const section = parent.createDiv({ cls: "mindos-health-section" });
    section.createEl("h4", { text: "🌱 成熟度分布" });

    const bar = section.createDiv({ cls: "mindos-health-bar-container" });
    const entries = Object.entries(m.maturityDistribution)
      .sort((a, b) => b[1] - a[1]);

    for (const [mat, count] of entries) {
      const row = bar.createDiv({ cls: "mindos-health-bar-row" });
      row.createSpan({ cls: "mindos-health-bar-label", text: mat });
      const fill = row.createDiv({ cls: "mindos-health-bar-track" });
      const pct = Math.round((count / m.totalPages) * 100);
      fill.createDiv({
        cls: "mindos-health-bar-fill",
        attr: { style: `width:${pct}%` },
      });
      row.createSpan({ cls: "mindos-health-bar-count", text: String(count) });
    }
  }

  private renderFreshnessSection(parent: HTMLElement, m: HealthMetrics) {
    const section = parent.createDiv({ cls: "mindos-health-section" });
    section.createEl("h4", { text: "⏰ 更新活跃度" });

    const f = m.freshnessDistribution;
    const container = section.createDiv({ cls: "mindos-health-freshness" });

    const items = [
      { label: "最近更新 (≤30天)", count: f.recent, cls: "is-recent" },
      { label: "中等 (1-6月)", count: f.moderate, cls: "is-moderate" },
      { label: "长期未更 (>6月)", count: f.stale, cls: "is-stale" },
    ];

    for (const item of items) {
      const row = container.createDiv({ cls: `mindos-health-fresh-item ${item.cls}` });
      row.createSpan({ cls: "mindos-health-fresh-dot" });
      row.createSpan({ cls: "mindos-health-fresh-label", text: item.label });
      row.createSpan({ cls: "mindos-health-fresh-count", text: String(item.count) });
    }
  }

  private renderTopLinkedSection(parent: HTMLElement, m: HealthMetrics) {
    const section = parent.createDiv({ cls: "mindos-health-section" });
    section.createEl("h4", { text: "📌 热门页面 Top 5" });

    const list = section.createDiv({ cls: "mindos-health-toplist" });
    for (let i = 0; i < Math.min(5, m.topLinkedPages.length); i++) {
      const p = m.topLinkedPages[i];
      const item = list.createDiv({ cls: "mindos-health-topitem" });
      item.createSpan({ cls: "mindos-health-toprank", text: `${i + 1}` });
      item.createSpan({ cls: "mindos-health-toppath", text: p.path });
      item.createSpan({ cls: "mindos-health-toplinks", text: `${p.links} 个引用` });
    }
  }

  private renderRecommendations(parent: HTMLElement, recs: string[]) {
    const section = parent.createDiv({ cls: "mindos-health-section" });
    section.createEl("h4", { text: "💡 优化建议" });

    const list = section.createDiv({ cls: "mindos-health-recs" });
    for (const rec of recs) {
      list.createDiv({ cls: "mindos-health-rec", text: rec });
    }
  }
}
