import { RecallCard } from "../../../core/types";
import { computeScenarioBoost, computeTagBoost, computeTextSimilarity, cosineSimilarity } from "./card-similarity";
import { CardVectorStore } from "./card-vector-store";

export interface CardRelationItem {
  card: RecallCard;
  score: number;
  textScore: number;
  vectorScore: number;
  reason: string[];
}

interface EmbeddingClientLike {
  getEmbedding?: (text: string) => Promise<number[]>;
  embed?: (text: string) => Promise<number[]>;
}

interface RecallCardStoreLike {
  getAllCards?: () => Promise<RecallCard[]>;
  getCardsByScenario?: (scenario: string) => Promise<RecallCard[]>;
}

export class CardRelationService {
  private recallCardStore: RecallCardStoreLike;
  private cardVectorStore: CardVectorStore;
  private embeddingClient?: EmbeddingClientLike;
  private getSettings?: () => any;
  private log?: (msg: string) => void;
  // 延迟批量向量化
  private pendingCardIds = new Set<string>();
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_DELAY_MS = 3000;
  private readonly BATCH_MAX_SIZE = 20;

  constructor(
    recallCardStore: RecallCardStoreLike,
    cardVectorStore: CardVectorStore,
    embeddingClient?: EmbeddingClientLike,
    getSettings?: () => any,
    log?: (msg: string) => void,
  ) {
    this.recallCardStore = recallCardStore;
    this.cardVectorStore = cardVectorStore;
    this.embeddingClient = embeddingClient;
    this.getSettings = getSettings;
    this.log = log;
  }

  async getRelatedCards(target: RecallCard, limit = 3): Promise<CardRelationItem[]> {
    const allCards = await this.loadAllCards();
    const candidates = allCards.filter((c: any) => c.id !== (target as any).id);

    let targetVector: number[] | null = await this.cardVectorStore.getVector((target as any).id);
    let useVector = false;

    if (!targetVector) {
      targetVector = await this.tryBuildVector(target);
    }
    if (targetVector) useVector = true;

    const results: CardRelationItem[] = [];

    for (const card of candidates) {
      const textScore = computeTextSimilarity(target, card);
      if (textScore < 0.08) continue;

      const tagBoost = computeTagBoost(target, card);
      const scenarioBoost = computeScenarioBoost(target, card);

      let vectorScore = 0;
      if (useVector) {
        let candidateVector = await this.cardVectorStore.getVector((card as any).id);
        if (!candidateVector) {
          candidateVector = await this.tryBuildVector(card);
        }
        if (candidateVector && targetVector) {
          vectorScore = Math.max(0, cosineSimilarity(targetVector, candidateVector));
        }
      }

      const finalScore =
        textScore * 0.65 +
        vectorScore * 0.25 +
        tagBoost * 0.06 +
        scenarioBoost * 0.04;

      if (finalScore < 0.12) continue;

      const reason: string[] = [];
      if (textScore > 0.2) reason.push("内容相近");
      if (vectorScore > 0.25) reason.push("语义相关");
      if (tagBoost > 0) reason.push("标签重合");
      if (scenarioBoost > 0) reason.push("同场景");

      results.push({
        card,
        score: finalScore,
        textScore,
        vectorScore,
        reason,
      });
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(2, Math.min(3, limit)));
  }

  async rebuildVectors(cards?: RecallCard[]): Promise<number> {
    if (!this.canUseEmbedding()) return 0;

    const all = cards || await this.loadAllCards();
    let count = 0;

    for (const card of all) {
      const id = (card as any).id;
      if (!id) continue;

      const existing = await this.cardVectorStore.getVector(id);
      if (existing) continue;

      const vector = await this.tryBuildVector(card);
      if (vector) count++;
    }

    this.log?.(`Card vectors rebuilt: ${count}`);
    return count;
  }

  async refreshCardVector(card: RecallCard): Promise<boolean> {
    const vec = await this.tryBuildVector(card, true);
    return !!vec;
  }

  private async loadAllCards(): Promise<RecallCard[]> {
    if (this.recallCardStore.getAllCards) {
      return await this.recallCardStore.getAllCards();
    }
    return [];
  }

  private cardToText(card: RecallCard): string {
    const front = (card as any).front || "";
    const back = (card as any).back || "";
    const tags = ((card as any).tags || []).join(" ");
    const scenario = (card as any).scenario || "";
    return [scenario, front, back, tags].filter(Boolean).join("\n");
  }

  private canUseEmbedding(): boolean {
    const s = this.getSettings?.();
    return !!(
      this.embeddingClient &&
      (this.embeddingClient.getEmbedding || this.embeddingClient.embed) &&
      s?.embeddingApiKey
    );
  }

  private async tryBuildVector(card: RecallCard, force = false): Promise<number[] | null> {
    const id = (card as any).id;
    if (!id || !this.canUseEmbedding()) return null;

    if (!force) {
      const existing = await this.cardVectorStore.getVector(id);
      if (existing) return existing;
    }

    try {
      const text = this.cardToText(card);
      const vector = this.embeddingClient!.getEmbedding
        ? await this.embeddingClient!.getEmbedding(text)
        : await this.embeddingClient!.embed!(text);

      if (vector?.length) {
        await this.cardVectorStore.setVector(id, vector);
        return vector;
      }
    } catch (e) {
      this.log?.(`build card vector failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    return null;
  }

  scheduleCardVectorUpdate(card: RecallCard): void {
    if (!this.canUseEmbedding()) return;
    const id = (card as any).id;
    if (!id) return;

    this.pendingCardIds.add(id);

    if (this.pendingCardIds.size >= this.BATCH_MAX_SIZE) {
      this.flushPendingVectors();
      return;
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = setTimeout(() => {
      this.flushPendingVectors();
    }, this.BATCH_DELAY_MS);
  }

  private async flushPendingVectors(): Promise<void> {
    if (this.pendingCardIds.size === 0) return;

    const ids = Array.from(this.pendingCardIds);
    this.pendingCardIds.clear();
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    this.log?.(`Flushing ${ids.length} pending card vectors`);

    const allCards = await this.loadAllCards();
    const cardsToProcess = allCards.filter((c: any) => ids.includes(c.id));

    for (const card of cardsToProcess) {
      try {
        await this.tryBuildVector(card, true);
      } catch (e) {
        this.log?.(`Error processing card ${(card as any).id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    this.log?.(`Completed flushing ${cardsToProcess.length} card vectors`);
  }

  dispose(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.pendingCardIds.clear();
  }
}