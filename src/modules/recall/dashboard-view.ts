import { App, Modal, setIcon, Notice } from "obsidian";
import {
  DashboardOverview,
  DashboardPeriod,
} from "../../core/types";
import {
  RECALL_SCENARIO_META,
} from "../../core/constants";
import { DashboardService } from "./dashboard-service";

export class DashboardView extends Modal {
  private currentPeriod: DashboardPeriod = "week";
  private overview: DashboardOverview | null = null;
  private isLoading = false;

  constructor(
    app: App,
    private service: DashboardService,
  ) {
    super(app);
  }

  async onOpen() {
    await this.refresh();
  }

  // ════════════════════════════════════════════════════════════
  // 主刷新
  // ════════════════════════════════════════════════════════════
  private async refresh() {
    this.isLoading = true;
    this.render();

    try {
      this.overview = await this.service.buildOverview(this.currentPeriod);
    } catch (e) {
      new Notice(`❌ 加载失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  // ════════════════════════════════════════════════════════════
  // 渲染
  // ════════════════════════════════════════════════════════════
  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-dashboard-modal");

    this.renderHeader(contentEl);

    if (this.isLoading) {
      const loading = contentEl.createDiv({ cls: "mindos-dashboard-loading" });
      const ic = loading.createSpan();
      setIcon(ic, "loader-2");
      ic.style.animation = "mindos-spin 1.2s linear infinite";
      loading.createSpan({ text: " 数据加载中..." });
      return;
    }

    if (!this.overview) {
      contentEl.createDiv({ cls: "mindos-empty", text: "暂无数据" });
      return;
    }

    this.renderTopMetrics(contentEl, this.overview);
    this.renderHeatmap(contentEl, this.overview);
    this.renderTrendChart(contentEl, this.overview);
    this.renderScenarioComparison(contentEl, this.overview);
    this.renderCardLibrary(contentEl, this.overview);
  }

  // ════════════════════════════════════════════════════════════
  // 头部 + 周期切换
  // ════════════════════════════════════════════════════════════
  private renderHeader(parent: HTMLElement) {
    const head = parent.createDiv({ cls: "mindos-dashboard-head" });

    const titleWrap = head.createDiv({ cls: "mindos-dashboard-title-wrap" });
    const ic = titleWrap.createSpan({ cls: "mindos-dashboard-title-icon" });
    setIcon(ic, "bar-chart-3");
    titleWrap.createSpan({ cls: "mindos-dashboard-title", text: "学习数据看板" });

    // 周期 Tab
    const tabs = head.createDiv({ cls: "mindos-dashboard-period-tabs" });
    const periods: Array<{ key: DashboardPeriod; label: string }> = [
      { key: "today", label: "今日" },
      { key: "week", label: "本周" },
      { key: "month", label: "本月" },
      { key: "all", label: "全部" },
    ];

    for (const p of periods) {
      const tab = tabs.createDiv({
        cls: `mindos-dashboard-period-tab ${this.currentPeriod === p.key ? "is-active" : ""}`,
        text: p.label,
      });
      tab.onclick = () => {
        if (this.currentPeriod === p.key) return;
        this.currentPeriod = p.key;
        this.refresh();
      };
    }
  }

  // ════════════════════════════════════════════════════════════
  // 顶部 6 大核心指标
  // ════════════════════════════════════════════════════════════
  private renderTopMetrics(parent: HTMLElement, ov: DashboardOverview) {
    const grid = parent.createDiv({ cls: "mindos-dashboard-top-metrics" });

    const accuracyPct = (ov.averageAccuracy * 100).toFixed(1);
    const timeStr = this.formatDuration(ov.totalTimeMs);

    this.makeMetric(grid, {
      icon: "check-circle",
      iconClass: "is-success",
      value: String(ov.totalReviewed),
      label: this.periodLabel() + "复习",
      sub: ov.totalDays > 0 ? `共 ${ov.totalDays} 天` : "",
    });

    this.makeMetric(grid, {
      icon: "target",
      iconClass: "is-info",
      value: `${accuracyPct}%`,
      label: "平均正确率",
      sub: `${ov.totalCorrect} / ${ov.totalReviewed}`,
    });

    this.makeMetric(grid, {
      icon: "clock",
      iconClass: "is-warning",
      value: timeStr,
      label: "总学习时长",
      sub: ov.totalReviewed > 0
        ? `平均 ${this.formatDuration(ov.totalTimeMs / Math.max(1, ov.totalReviewed))}/张`
        : "",
    });

    this.makeMetric(grid, {
      icon: "sparkles",
      iconClass: "is-primary",
      value: String(ov.totalNewCards),
      label: "新学卡片",
      sub: ov.totalDays > 0 ? `平均 ${(ov.totalNewCards / ov.totalDays).toFixed(1)}/天` : "",
    });

    this.makeMetric(grid, {
      icon: "flame",
      iconClass: "is-danger",
      value: String(ov.currentStreak),
      label: "当前连续天数",
      sub: ov.longestStreak > 0 ? `最长 ${ov.longestStreak} 天` : "",
    });

    this.makeMetric(grid, {
      icon: "alarm-clock",
      iconClass: "is-info",
      value: String(ov.dueToday),
      label: "今日待复习",
      sub: ov.newAvailable > 0 ? `${ov.newAvailable} 张新卡可学` : "",
    });
  }

  private makeMetric(
    parent: HTMLElement,
    opts: {
      icon: string;
      iconClass: string;
      value: string;
      label: string;
      sub?: string;
    },
  ) {
    const card = parent.createDiv({ cls: "mindos-dashboard-metric" });

    const iconWrap = card.createDiv({ cls: `mindos-dashboard-metric-icon ${opts.iconClass}` });
    setIcon(iconWrap, opts.icon);

    const body = card.createDiv({ cls: "mindos-dashboard-metric-body" });
    body.createDiv({ cls: "mindos-dashboard-metric-value", text: opts.value });
    body.createDiv({ cls: "mindos-dashboard-metric-label", text: opts.label });
    if (opts.sub) {
      body.createDiv({ cls: "mindos-dashboard-metric-sub", text: opts.sub });
    }
  }

  // ════════════════════════════════════════════════════════════
  // 热力图（最近 90 天）
  // ════════════════════════════════════════════════════════════
  private renderHeatmap(parent: HTMLElement, ov: DashboardOverview) {
    const card = parent.createDiv({ cls: "mindos-dashboard-card" });

    const head = card.createDiv({ cls: "mindos-dashboard-card-head" });
    const ic = head.createSpan({ cls: "mindos-dashboard-card-icon" });
    setIcon(ic, "calendar-days");
    head.createSpan({ cls: "mindos-dashboard-card-title", text: "学习热力图（最近 90 天）" });

    const heatmapWrap = card.createDiv({ cls: "mindos-dashboard-heatmap-wrap" });

    // 热力图按周分组
    const data = ov.heatmap;
    const startDate = new Date(data[0].date);

    // 让第一周对齐到周日 (week 从周日开始)
    const startDay = startDate.getDay(); // 0=周日

    // 生成网格
    const grid = heatmapWrap.createDiv({ cls: "mindos-dashboard-heatmap-grid" });

    // 列：周
    const totalCells = data.length + startDay;
    const totalWeeks = Math.ceil(totalCells / 7);

    for (let w = 0; w < totalWeeks; w++) {
      const col = grid.createDiv({ cls: "mindos-dashboard-heatmap-col" });

      for (let d = 0; d < 7; d++) {
        const cellIdx = w * 7 + d - startDay;
        const cell = col.createDiv({ cls: "mindos-dashboard-heatmap-cell" });

        if (cellIdx < 0 || cellIdx >= data.length) {
          cell.addClass("is-empty");
          continue;
        }

        const day = data[cellIdx];
        cell.addClass(`level-${day.level}`);
        cell.setAttribute(
          "title",
          `${day.date} · ${day.count > 0 ? `复习 ${day.count} 张` : "未学习"}`,
        );
      }
    }

    // 图例
    const legend = heatmapWrap.createDiv({ cls: "mindos-dashboard-heatmap-legend" });
    legend.createSpan({ cls: "mindos-dashboard-heatmap-legend-label", text: "少" });
    for (let i = 0; i < 5; i++) {
      legend.createSpan({ cls: `mindos-dashboard-heatmap-cell level-${i}` });
    }
    legend.createSpan({ cls: "mindos-dashboard-heatmap-legend-label", text: "多" });
  }

  // ════════════════════════════════════════════════════════════
  // 趋势曲线（最近 30 天柱状图）
  // ════════════════════════════════════════════════════════════
  private renderTrendChart(parent: HTMLElement, ov: DashboardOverview) {
    const card = parent.createDiv({ cls: "mindos-dashboard-card" });

    const head = card.createDiv({ cls: "mindos-dashboard-card-head" });
    const ic = head.createSpan({ cls: "mindos-dashboard-card-icon" });
    setIcon(ic, "trending-up");
    head.createSpan({ cls: "mindos-dashboard-card-title", text: "复习趋势（最近 30 天）" });

    // 找最大值用于归一化
    const maxReviewed = Math.max(1, ...ov.dailyTrend.map((d) => d.reviewed));

    const chartWrap = card.createDiv({ cls: "mindos-dashboard-chart-wrap" });
    const bars = chartWrap.createDiv({ cls: "mindos-dashboard-bars" });

    for (const day of ov.dailyTrend) {
      const col = bars.createDiv({ cls: "mindos-dashboard-bar-col" });

      const barEl = col.createDiv({ cls: "mindos-dashboard-bar" });
      const heightPct = (day.reviewed / maxReviewed) * 100;
      barEl.style.height = `${heightPct}%`;

      // 颜色根据正确率
      if (day.reviewed === 0) {
        barEl.addClass("is-empty");
      } else if (day.accuracy >= 0.8) {
        barEl.addClass("is-excellent");
      } else if (day.accuracy >= 0.6) {
        barEl.addClass("is-good");
      } else {
        barEl.addClass("is-low");
      }

      // 提示
      const tip = day.reviewed > 0
        ? `${day.date}\n复习 ${day.reviewed} 张 · 正确率 ${(day.accuracy * 100).toFixed(0)}%`
        : `${day.date}\n未学习`;
      col.setAttribute("title", tip);

      // X 轴标签（每 5 天显示一次）
      const idx = ov.dailyTrend.indexOf(day);
      if (idx % 5 === 0 || idx === ov.dailyTrend.length - 1) {
        const dateLabel = col.createDiv({ cls: "mindos-dashboard-bar-label" });
        const parts = day.date.split("-");
        dateLabel.setText(`${parts[1]}/${parts[2]}`);
      }
    }

    // 图例
    const legend = card.createDiv({ cls: "mindos-dashboard-chart-legend" });
    this.makeLegendChip(legend, "正确率 ≥ 80%", "is-excellent");
    this.makeLegendChip(legend, "60-79%", "is-good");
    this.makeLegendChip(legend, "< 60%", "is-low");
  }

  private makeLegendChip(parent: HTMLElement, label: string, cls: string) {
    const chip = parent.createDiv({ cls: "mindos-dashboard-legend-chip" });
    chip.createSpan({ cls: `mindos-dashboard-legend-color ${cls}` });
    chip.createSpan({ text: label });
  }

  // ════════════════════════════════════════════════════════════
  // 场景对比
  // ════════════════════════════════════════════════════════════
  private renderScenarioComparison(parent: HTMLElement, ov: DashboardOverview) {
    const card = parent.createDiv({ cls: "mindos-dashboard-card" });

    const head = card.createDiv({ cls: "mindos-dashboard-card-head" });
    const ic = head.createSpan({ cls: "mindos-dashboard-card-icon" });
    setIcon(ic, "list-tree");
    head.createSpan({ cls: "mindos-dashboard-card-title", text: "场景对比（按复习数排序）" });

    const list = card.createDiv({ cls: "mindos-dashboard-scenario-list" });

    if (ov.scenarioStats.every((s) => s.totalCards === 0 && s.totalReviewed === 0)) {
      list.createDiv({ cls: "mindos-empty", text: "尚未在任何场景产生数据" });
      return;
    }

    const maxReview = Math.max(1, ...ov.scenarioStats.map((s) => s.totalReviewed));

    for (const s of ov.scenarioStats) {
      if (s.totalCards === 0 && s.totalReviewed === 0) continue;

      const item = list.createDiv({ cls: "mindos-dashboard-scenario-item" });

      // 头部
      const itemHead = item.createDiv({ cls: "mindos-dashboard-scenario-head" });
      const ic = itemHead.createSpan({ cls: "mindos-dashboard-scenario-icon" });
      setIcon(ic, s.icon);
      itemHead.createSpan({ cls: "mindos-dashboard-scenario-name", text: s.label });
      itemHead.createSpan({
        cls: "mindos-dashboard-scenario-review-count",
        text: `${s.totalReviewed} 次复习`,
      });

      // 进度条
      const barWrap = item.createDiv({ cls: "mindos-dashboard-scenario-bar-wrap" });
      const bar = barWrap.createDiv({ cls: "mindos-dashboard-scenario-bar" });
      bar.style.width = `${(s.totalReviewed / maxReview) * 100}%`;

      // 数据
      const stats = item.createDiv({ cls: "mindos-dashboard-scenario-stats" });
      stats.createSpan({ text: `📚 ${s.totalCards} 张` });
      stats.createSpan({ text: ` · ✅ ${s.masteredCount} 已掌握` });
      if (s.totalReviewed > 0) {
        stats.createSpan({
          text: ` · 🎯 正确率 ${(s.accuracy * 100).toFixed(0)}%`,
        });
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 卡片库总览（状态分布饼图）
  // ════════════════════════════════════════════════════════════
  private renderCardLibrary(parent: HTMLElement, ov: DashboardOverview) {
    const card = parent.createDiv({ cls: "mindos-dashboard-card" });

    const head = card.createDiv({ cls: "mindos-dashboard-card-head" });
    const ic = head.createSpan({ cls: "mindos-dashboard-card-icon" });
    setIcon(ic, "library");
    head.createSpan({ cls: "mindos-dashboard-card-title", text: `卡片库总览（共 ${ov.totalCards} 张）` });

    if (ov.totalCards === 0) {
      card.createDiv({ cls: "mindos-empty", text: "暂无卡片，开始创建吧！" });
      return;
    }

    const wrap = card.createDiv({ cls: "mindos-dashboard-library-wrap" });

    // 状态分布条
    const statusWrap = wrap.createDiv({ cls: "mindos-dashboard-status-wrap" });
    statusWrap.createDiv({
      cls: "mindos-dashboard-section-label",
      text: "📊 状态分布",
    });

    const statusBar = statusWrap.createDiv({ cls: "mindos-dashboard-status-bar" });
    const statusList = [
      { key: "new", label: "新卡片", cls: "is-new" },
      { key: "learning", label: "学习中", cls: "is-learning" },
      { key: "review", label: "复习中", cls: "is-review" },
      { key: "mastered", label: "已掌握", cls: "is-mastered" },
      { key: "suspended", label: "暂停", cls: "is-suspended" },
    ];

    for (const s of statusList) {
      const count = ov.cardsByStatus[s.key] ?? 0;
      if (count === 0) continue;
      const pct = (count / ov.totalCards) * 100;
      const seg = statusBar.createDiv({ cls: `mindos-dashboard-status-seg ${s.cls}` });
      seg.style.width = `${pct}%`;
      seg.setAttribute("title", `${s.label}: ${count} 张 (${pct.toFixed(1)}%)`);
    }

    // 图例
    const statusLegend = statusWrap.createDiv({ cls: "mindos-dashboard-status-legend" });
    for (const s of statusList) {
      const count = ov.cardsByStatus[s.key] ?? 0;
      if (count === 0) continue;
      const chip = statusLegend.createDiv({ cls: "mindos-dashboard-status-legend-chip" });
      chip.createSpan({ cls: `mindos-dashboard-status-legend-dot ${s.cls}` });
      chip.createSpan({ text: `${s.label} ${count}` });
    }

    // 场景分布
    const scenarioWrap = wrap.createDiv({ cls: "mindos-dashboard-scenario-dist-wrap" });
    scenarioWrap.createDiv({
      cls: "mindos-dashboard-section-label",
      text: "📂 场景分布",
    });

    const scenarioList = scenarioWrap.createDiv({ cls: "mindos-dashboard-scenario-dist-list" });

    for (const [key, meta] of Object.entries(RECALL_SCENARIO_META)) {
      const count = ov.cardsByScenario[key] ?? 0;
      if (count === 0) continue;

      const item = scenarioList.createDiv({ cls: "mindos-dashboard-scenario-dist-item" });
      const ic = item.createSpan();
      setIcon(ic, meta.icon);
      item.createSpan({ cls: "mindos-dashboard-scenario-dist-label", text: meta.label });
      item.createSpan({ cls: "mindos-dashboard-scenario-dist-count", text: `${count}` });

      const pct = (count / ov.totalCards) * 100;
      const miniBar = item.createDiv({ cls: "mindos-dashboard-scenario-dist-bar" });
      miniBar.createDiv({ cls: "mindos-dashboard-scenario-dist-fill" }).style.width = `${pct}%`;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 工具
  // ════════════════════════════════════════════════════════════
  private periodLabel(): string {
    return ({
      today: "今日",
      week: "本周",
      month: "本月",
      all: "累计",
    } as any)[this.currentPeriod] ?? "";
  }

  private formatDuration(ms: number): string {
    if (!ms || ms < 0) return "0 秒";
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec} 秒`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分`;
    const hours = Math.floor(min / 60);
    const remainMin = min % 60;
    if (remainMin === 0) return `${hours} 小时`;
    return `${hours}h ${remainMin}m`;
  }

  onClose() {
    this.contentEl.empty();
  }
}