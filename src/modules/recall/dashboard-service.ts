import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  DashboardOverview,
  DashboardPeriod,
  RecallDailyStats,
  RecallScenario,
  RecallCard,
} from "../../core/types";
import {
  DIR_RECALL_STATS,
  RECALL_SCENARIO_META,
} from "../../core/constants";
import { RecallCardStore } from "./recall-card-store";

export class DashboardService {
  constructor(
    private app: App,
    private getBaseFolder: () => string,
    private cardStore: RecallCardStore,
  ) {}

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  // ════════════════════════════════════════════════════════════
  // 主入口：构建 Dashboard 数据
  // ════════════════════════════════════════════════════════════
  async buildOverview(period: DashboardPeriod = "week"): Promise<DashboardOverview> {
    // 1. 拉取所有每日统计
    const allDailyStats = await this.loadAllDailyStats();

    // 2. 按 period 过滤
    const filtered = this.filterByPeriod(allDailyStats, period);

    // 3. 综合数据
    const totalReviewed = filtered.reduce((s, d) => s + d.totalReviewed, 0);
    const totalCorrect = filtered.reduce((s, d) => s + d.correctCount, 0);
    const totalTimeMs = filtered.reduce((s, d) => s + d.timeSpentMs, 0);
    const totalNewCards = filtered.reduce((s, d) => s + d.newCards, 0);
    const totalDays = filtered.filter((d) => d.totalReviewed > 0).length;
    const averageAccuracy = totalReviewed > 0 ? totalCorrect / totalReviewed : 0;

    // 4. 卡片库总览
    const allCards = await this.collectAllCards();
    const cardsByStatus = this.groupByStatus(allCards);
    const cardsByScenario = this.groupByScenario(allCards);

    // 5. 待复习
    const today = new Date().toISOString().substring(0, 10);
    const dueToday = allCards.filter((c) => {
      if (c.status === "suspended" || c.status === "new") return false;
      return c.srs.nextReview && c.srs.nextReview <= today;
    }).length;

    const newAvailable = allCards.filter((c) =>
      c.status === "new" || c.srs.repetitions === 0,
    ).length;

    // 6. 连续学习
    const { current, longest } = this.calculateStreaks(allDailyStats);

    // 7. 趋势数据（最近 30 天）
    const dailyTrend = this.buildDailyTrend(allDailyStats, 30);

    // 8. 热力图（最近 90 天）
    const heatmap = this.buildHeatmap(allDailyStats, 90);

    // 9. 场景对比
    const scenarioStats = this.buildScenarioStats(allCards, allDailyStats);

    return {
      period,
      totalReviewed,
      totalCorrect,
      averageAccuracy,
      totalTimeMs,
      totalNewCards,
      totalDays,
      totalCards: allCards.length,
      cardsByStatus,
      cardsByScenario,
      dueToday,
      newAvailable,
      currentStreak: current,
      longestStreak: longest,
      dailyTrend,
      heatmap,
      scenarioStats,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 数据加载
  // ════════════════════════════════════════════════════════════
  private async loadAllDailyStats(): Promise<RecallDailyStats[]> {
    const folderPath = this.path(DIR_RECALL_STATS);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return [];

    const stats: RecallDailyStats[] = [];

    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "json") {
        try {
          const content = await this.app.vault.read(child);
          const data = JSON.parse(content) as RecallDailyStats;
          if (data.date) stats.push(data);
        } catch {}
      }
    }

    return stats.sort((a, b) => a.date.localeCompare(b.date));
  }

  private async collectAllCards(): Promise<RecallCard[]> {
    const scenarios: RecallScenario[] = [
      "wiki", "command", "vocab",
      "interview", "concept", "phrase", "custom",
    ];

    const all: RecallCard[] = [];
    for (const sc of scenarios) {
      const cards = await this.cardStore.getAllCards(sc);
      all.push(...cards);
    }
    return all;
  }

  // ════════════════════════════════════════════════════════════
  // 周期过滤
  // ════════════════════════════════════════════════════════════
  private filterByPeriod(
    stats: RecallDailyStats[],
    period: DashboardPeriod,
  ): RecallDailyStats[] {
    if (period === "all") return stats;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let cutoff: Date;
    if (period === "today") {
      cutoff = today;
    } else if (period === "week") {
      cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 6);
    } else {
      // month
      cutoff = new Date(today);
      cutoff.setDate(cutoff.getDate() - 29);
    }

    const cutoffStr = cutoff.toISOString().substring(0, 10);
    return stats.filter((s) => s.date >= cutoffStr);
  }

  // ════════════════════════════════════════════════════════════
  // 卡片状态/场景分组
  // ════════════════════════════════════════════════════════════
  private groupByStatus(cards: RecallCard[]): Record<string, number> {
    const result: Record<string, number> = {
      new: 0, learning: 0, review: 0, mastered: 0, suspended: 0,
    };
    for (const c of cards) {
      if (result[c.status] !== undefined) result[c.status]++;
    }
    return result;
  }

  private groupByScenario(cards: RecallCard[]): Record<string, number> {
    const result: Record<string, number> = {
      wiki: 0, command: 0, vocab: 0,
      interview: 0, concept: 0, phrase: 0, custom: 0,
    };
    for (const c of cards) {
      if (result[c.scenario] !== undefined) result[c.scenario]++;
    }
    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 连续天数计算
  // ════════════════════════════════════════════════════════════
  private calculateStreaks(stats: RecallDailyStats[]): { current: number; longest: number } {
    const validDays = new Set(
      stats.filter((s) => s.totalReviewed > 0).map((s) => s.date),
    );

    let current = 0;
    let longest = 0;
    let runningStreak = 0;

    if (validDays.size === 0) return { current: 0, longest: 0 };

    // 从最早日期到今天遍历，计算最长连续
    const sorted = Array.from(validDays).sort();
    let prevDate: Date | null = null;

    for (const dateStr of sorted) {
      const d = new Date(dateStr);
      if (!prevDate) {
        runningStreak = 1;
      } else {
        const diff = (d.getTime() - prevDate.getTime()) / 86400000;
        if (diff === 1) {
          runningStreak++;
        } else {
          runningStreak = 1;
        }
      }
      longest = Math.max(longest, runningStreak);
      prevDate = d;
    }

    // 当前连续：从今天往前看
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let cursor = new Date(today);

    // 如果今天没复习，从昨天开始算
    const todayStr = today.toISOString().substring(0, 10);
    if (!validDays.has(todayStr)) {
      cursor.setDate(cursor.getDate() - 1);
    }

    while (true) {
      const cursorStr = cursor.toISOString().substring(0, 10);
      if (validDays.has(cursorStr)) {
        current++;
        cursor.setDate(cursor.getDate() - 1);
      } else {
        break;
      }
    }

    return { current, longest };
  }

  // ════════════════════════════════════════════════════════════
  // 每日趋势（最近 N 天）
  // ════════════════════════════════════════════════════════════
  private buildDailyTrend(stats: RecallDailyStats[], days: number): DashboardOverview["dailyTrend"] {
    const map = new Map(stats.map((s) => [s.date, s]));
    const result: DashboardOverview["dailyTrend"] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().substring(0, 10);

      const data = map.get(dateStr);
      result.push({
        date: dateStr,
        reviewed: data?.totalReviewed ?? 0,
        correct: data?.correctCount ?? 0,
        accuracy: data && data.totalReviewed > 0
          ? data.correctCount / data.totalReviewed
          : 0,
        newCards: data?.newCards ?? 0,
        timeMs: data?.timeSpentMs ?? 0,
      });
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 热力图数据（最近 N 天）
  // ════════════════════════════════════════════════════════════
  private buildHeatmap(stats: RecallDailyStats[], days: number): DashboardOverview["heatmap"] {
    const map = new Map(stats.map((s) => [s.date, s]));
    const result: DashboardOverview["heatmap"] = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().substring(0, 10);

      const data = map.get(dateStr);
      const count = data?.totalReviewed ?? 0;
      const level: 0 | 1 | 2 | 3 | 4 =
        count === 0 ? 0 :
        count < 5 ? 1 :
        count < 15 ? 2 :
        count < 30 ? 3 : 4;

      result.push({ date: dateStr, count, level });
    }

    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 场景对比
  // ════════════════════════════════════════════════════════════
  private buildScenarioStats(
    cards: RecallCard[],
    dailyStats: RecallDailyStats[],
  ): DashboardOverview["scenarioStats"] {
    // 累计每个场景的复习数
    const reviewCounts: Record<string, number> = {};
    for (const d of dailyStats) {
      for (const [scenario, count] of Object.entries(d.byScenario ?? {})) {
        reviewCounts[scenario] = (reviewCounts[scenario] ?? 0) + count;
      }
    }

    // 场景分组卡片
    const cardsByScenario = new Map<string, RecallCard[]>();
    for (const c of cards) {
      if (!cardsByScenario.has(c.scenario)) {
        cardsByScenario.set(c.scenario, []);
      }
      cardsByScenario.get(c.scenario)!.push(c);
    }

    const result: DashboardOverview["scenarioStats"] = [];

    for (const [key, meta] of Object.entries(RECALL_SCENARIO_META)) {
      const scenarioCards = cardsByScenario.get(key) ?? [];
      const masteredCount = scenarioCards.filter((c) => c.status === "mastered").length;

      const totalReviews = scenarioCards.reduce((s, c) => s + c.stats.totalReviews, 0);
      const totalCorrect = scenarioCards.reduce((s, c) => s + c.stats.correctCount, 0);
      const accuracy = totalReviews > 0 ? totalCorrect / totalReviews : 0;

      result.push({
        scenario: key,
        label: meta.label,
        icon: meta.icon,
        totalReviewed: reviewCounts[key] ?? 0,
        totalCards: scenarioCards.length,
        masteredCount,
        accuracy,
      });
    }

    // 按总复习数排序
    result.sort((a, b) => b.totalReviewed - a.totalReviewed);
    return result;
  }
}