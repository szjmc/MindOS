import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  RecallCard,
  RecallScenario,
  RecallCardStatus,
  RecallSession,
  RecallDailyStats,
  SRSData,
} from "../../core/types";
import {
  DIR_RECALL_CARDS,
  DIR_RECALL_SESSIONS,
  DIR_RECALL_STATS,
  DIR_RECALL,
  RECALL_DEFAULT_NEW_CARDS_PER_DAY,
  RECALL_DEFAULT_REVIEW_LIMIT,
} from "../../core/constants";
import { nowISOString, generateUID } from "../../core/utils";

export class RecallCardStore {
  // 内存缓存：scenario → cards
  private cache = new Map<RecallScenario, RecallCard[]>();
  private loadedScenarios = new Set<RecallScenario>();

  constructor(
    private app: App,
    private getBaseFolder: () => string,
  ) {}

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  // ════════════════════════════════════════════════════════════
  // 初始化
  // ════════════════════════════════════════════════════════════
  async initialize(): Promise<void> {
    await this.ensureFolder(this.path(DIR_RECALL));
    await this.ensureFolder(this.path(DIR_RECALL_CARDS));
    await this.ensureFolder(this.path(DIR_RECALL_SESSIONS));
    await this.ensureFolder(this.path(DIR_RECALL_STATS));

    // 为每个场景创建子目录
    const scenarios: RecallScenario[] = [
      "wiki", "command", "vocab", "interview", "concept", "phrase", "custom"
    ];
    for (const s of scenarios) {
      await this.ensureFolder(this.path(`${DIR_RECALL_CARDS}/${s}`));
    }
  }

  // ════════════════════════════════════════════════════════════
  // 卡片 CRUD
  // ════════════════════════════════════════════════════════════

  async loadScenario(scenario: RecallScenario): Promise<RecallCard[]> {
    if (this.loadedScenarios.has(scenario)) {
      return this.cache.get(scenario) ?? [];
    }

    const folderPath = this.path(`${DIR_RECALL_CARDS}/${scenario}`);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    const cards: RecallCard[] = [];

    if (folder instanceof TFolder) {
      for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "json") {
          try {
            const content = await this.app.vault.read(child);
            const card = JSON.parse(content) as RecallCard;
            if (card.id && card.front && card.back) {
              cards.push(card);
            }
          } catch {
            // 跳过损坏文件
          }
        }
      }
    }

    this.cache.set(scenario, cards);
    this.loadedScenarios.add(scenario);
    return cards;
  }

  async getCard(scenario: RecallScenario, id: string): Promise<RecallCard | null> {
    const cards = await this.loadScenario(scenario);
    return cards.find((c) => c.id === id) ?? null;
  }

  async saveCard(card: RecallCard): Promise<void> {
    // 更新缓存
    const cards = await this.loadScenario(card.scenario);
    const idx = cards.findIndex((c) => c.id === card.id);
    if (idx >= 0) {
      cards[idx] = card;
    } else {
      cards.push(card);
    }
    this.cache.set(card.scenario, cards);

    // 持久化
    const filePath = this.path(`${DIR_RECALL_CARDS}/${card.scenario}/${card.id}.json`);
    const content = JSON.stringify(card, null, 2);
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) {
      await this.app.vault.modify(f, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  async saveCards(cards: RecallCard[]): Promise<void> {
    for (const card of cards) {
      await this.saveCard(card);
    }
  }

  async deleteCard(scenario: RecallScenario, id: string): Promise<void> {
    const cards = await this.loadScenario(scenario);
    const filtered = cards.filter((c) => c.id !== id);
    this.cache.set(scenario, filtered);

    const filePath = this.path(`${DIR_RECALL_CARDS}/${scenario}/${id}.json`);
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) {
      await this.app.vault.delete(f);
    }
  }

  async suspendCard(scenario: RecallScenario, id: string): Promise<void> {
    const card = await this.getCard(scenario, id);
    if (!card) return;
    card.status = "suspended";
    card.updatedAt = nowISOString();
    await this.saveCard(card);
  }

  // ════════════════════════════════════════════════════════════
  // 查询
  // ════════════════════════════════════════════════════════════

  async getDueCards(
    scenario: RecallScenario,
    opts: {
      newLimit?: number;
      reviewLimit?: number;
      includeNew?: boolean;
    } = {},
  ): Promise<RecallCard[]> {
    const cards = await this.loadScenario(scenario);
    const today = new Date().toISOString().substring(0, 10);
    const newLimit = opts.newLimit ?? RECALL_DEFAULT_NEW_CARDS_PER_DAY;
    const reviewLimit = opts.reviewLimit ?? RECALL_DEFAULT_REVIEW_LIMIT;

    const newCards: RecallCard[] = [];
    const reviewCards: RecallCard[] = [];

    for (const card of cards) {
      if (card.status === "suspended") continue;

      if (card.status === "new" || card.srs.repetitions === 0) {
        newCards.push(card);
      } else if (card.srs.nextReview <= today) {
        reviewCards.push(card);
      }
    }

    // 复习卡片按到期时间排序（最早的优先）
    reviewCards.sort((a, b) => a.srs.nextReview.localeCompare(b.srs.nextReview));

    const result: RecallCard[] = [];

    // 先加复习卡片
    result.push(...reviewCards.slice(0, reviewLimit));

    // 再加新卡片
    if (opts.includeNew !== false) {
      result.push(...newCards.slice(0, newLimit));
    }

    return result;
  }

  async getScenarioStats(scenario: RecallScenario): Promise<{
    total: number;
    newCount: number;
    dueCount: number;
    masteredCount: number;
    suspendedCount: number;
  }> {
    const cards = await this.loadScenario(scenario);
    const today = new Date().toISOString().substring(0, 10);

    let newCount = 0;
    let dueCount = 0;
    let masteredCount = 0;
    let suspendedCount = 0;

    for (const card of cards) {
      if (card.status === "suspended") { suspendedCount++; continue; }
      if (card.status === "new" || card.srs.repetitions === 0) { newCount++; continue; }
      if (card.status === "mastered") { masteredCount++; }
      if (card.srs.nextReview <= today) dueCount++;
    }

    return {
      total: cards.length,
      newCount,
      dueCount,
      masteredCount,
      suspendedCount,
    };
  }

  async getAllCards(scenario: RecallScenario): Promise<RecallCard[]> {
    return await this.loadScenario(scenario);
  }

  // ════════════════════════════════════════════════════════════
  // 复习后更新卡片
  // ════════════════════════════════════════════════════════════

  async updateAfterReview(
    card: RecallCard,
    newSRS: SRSData,
    rating: number,
    responseTimeMs: number,
  ): Promise<RecallCard> {
    const updated: RecallCard = {
      ...card,
      srs: newSRS,
      stats: {
        totalReviews: card.stats.totalReviews + 1,
        correctCount: card.stats.correctCount + (rating >= 3 ? 1 : 0),
        wrongCount: card.stats.wrongCount + (rating < 3 ? 1 : 0),
        avgResponseTimeMs: card.stats.totalReviews === 0
          ? responseTimeMs
          : Math.round(
              (card.stats.avgResponseTimeMs * card.stats.totalReviews + responseTimeMs) /
              (card.stats.totalReviews + 1),
            ),
        streak: rating >= 3 ? card.stats.streak + 1 : 0,
      },
      status: this.deriveStatus(newSRS),
      updatedAt: nowISOString(),
    };

    await this.saveCard(updated);
    return updated;
  }

  private deriveStatus(srs: SRSData): RecallCardStatus {
    if (srs.repetitions === 0) return "new";
    if (srs.interval < 1) return "learning";
    if (srs.interval >= 21) return "mastered";
    return "review";
  }

  // ════════════════════════════════════════════════════════════
  // 会话管理
  // ════════════════════════════════════════════════════════════

  async createSession(scenario: RecallScenario, cardIds: string[]): Promise<RecallSession> {
    const session: RecallSession = {
      id: `recall_${generateUID()}`,
      scenario,
      startedAt: nowISOString(),
      cardIds,
      results: [],
      totalCards: cardIds.length,
      doneCards: 0,
      correctCards: 0,
    };
    await this.persistSession(session);
    return session;
  }

  async updateSession(session: RecallSession): Promise<void> {
    await this.persistSession(session);
  }

  private async persistSession(session: RecallSession): Promise<void> {
    await this.ensureFolder(this.path(DIR_RECALL_SESSIONS));
    const filePath = this.path(`${DIR_RECALL_SESSIONS}/${session.id}.json`);
    const content = JSON.stringify(session, null, 2);
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) {
      await this.app.vault.modify(f, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 每日统计
  // ════════════════════════════════════════════════════════════

  async getTodayStats(): Promise<RecallDailyStats> {
    const today = new Date().toISOString().substring(0, 10);
    const filePath = this.path(`${DIR_RECALL_STATS}/${today}.json`);
    const f = this.app.vault.getAbstractFileByPath(filePath);

    if (f instanceof TFile) {
      try {
        const content = await this.app.vault.read(f);
        return JSON.parse(content) as RecallDailyStats;
      } catch {
        // 损坏则重建
      }
    }

    return this.defaultDailyStats(today);
  }

  async recordReview(
    scenario: RecallScenario,
    isCorrect: boolean,
    isNew: boolean,
    timeMs: number,
  ): Promise<void> {
    const stats = await this.getTodayStats();
    stats.totalReviewed++;
    if (isCorrect) stats.correctCount++;
    if (isNew) stats.newCards++;
    stats.timeSpentMs += timeMs;
    stats.byScenario[scenario] = (stats.byScenario[scenario] ?? 0) + 1;

    await this.ensureFolder(this.path(DIR_RECALL_STATS));
    const filePath = this.path(`${DIR_RECALL_STATS}/${stats.date}.json`);
    const content = JSON.stringify(stats, null, 2);
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) {
      await this.app.vault.modify(f, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  private defaultDailyStats(date: string): RecallDailyStats {
    return {
      date,
      totalReviewed: 0,
      correctCount: 0,
      newCards: 0,
      timeSpentMs: 0,
      byScenario: {
        wiki: 0, command: 0, vocab: 0,
        interview: 0, concept: 0, phrase: 0, custom: 0,
      },
    };
  }

  // ════════════════════════════════════════════════════════════
  // 工具
  // ════════════════════════════════════════════════════════════

  invalidateCache(scenario?: RecallScenario) {
    if (scenario) {
      this.cache.delete(scenario);
      this.loadedScenarios.delete(scenario);
    } else {
      this.cache.clear();
      this.loadedScenarios.clear();
    }
  }

  private async ensureFolder(p: string) {
    const path = normalizePath(p);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}