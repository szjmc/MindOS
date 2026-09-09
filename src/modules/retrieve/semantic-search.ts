import { MindOSSettings, SearchResult, PageSearchResult, SearchMode } from "../../core/types";
import { VectorStore } from "./vector-store";
import { EmbeddingClient } from "./embedding-client";
import { TokenEstimator } from "./token-estimator";
import { QuotaManager } from "./quota-manager";
import { normalizeText } from "../../core/utils";

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  mode?: SearchMode;
  filterFileType?: string[];  // 仅限定的 fileType
}

export class SemanticSearch {
  constructor(
    private getSettings: () => MindOSSettings,
    private vectorStore: VectorStore,
    private embeddingClient: EmbeddingClient,
    private quotaManager: QuotaManager,
    private logger: (msg: string) => void,
  ) {}

  /**
   * 语义搜索（统一入口）
   */
  async search(query: string, options: SearchOptions = {}): Promise<PageSearchResult[]> {
    const cleanQuery = normalizeText(query);
    if (!cleanQuery) return [];

    const s = this.getSettings();
    const topK = options.topK ?? s.searchTopK ?? 10;
    const minScore = options.minScore ?? s.searchMinScore ?? 0;
    const mode: SearchMode = options.mode ?? "page";

    // 1. 配额检查
    const estimated = TokenEstimator.estimate(cleanQuery);
    const quotaCheck = await this.quotaManager.canConsume(estimated);
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.reason ?? "配额不足");
    }

    // 2. 查询向量化
    let queryVector: number[];
    let actualTokens = 0;
    try {
      const r = await this.embeddingClient.embed([cleanQuery]);
      queryVector = r.vectors[0];
      actualTokens = r.totalTokens;
    } catch (e) {
      throw new Error(`查询向量化失败：${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. 配额计入
    const cost = TokenEstimator.estimateCost(actualTokens, s.costPerMillionTokensEmbedding);
    await this.quotaManager.consume(actualTokens, cost);

    // 4. 向量库搜索
    // page 模式下需要更多 chunk 用于聚合
    const fetchK = mode === "page" ? topK * 4 : topK;
    let chunkResults = await this.vectorStore.search(queryVector, fetchK, minScore);

    // 5. 类型过滤
    if (options.filterFileType && options.filterFileType.length > 0) {
      const set = new Set(options.filterFileType);
      chunkResults = chunkResults.filter((r) => set.has(r.chunk.fileType));
    }

    // 6. 聚合
    if (mode === "chunk") {
      return this.aggregateAsChunks(chunkResults, topK);
    } else {
      return this.aggregateAsPages(chunkResults, topK);
    }
  }

  /**
   * Chunk 模式：每个 chunk 独立成一项（同一页面可能多次出现）
   */
  private aggregateAsChunks(results: SearchResult[], topK: number): PageSearchResult[] {
    return results.slice(0, topK).map((r) => ({
      path: r.chunk.path,
      fileTitle: r.chunk.fileTitle,
      fileType: r.chunk.fileType,
      topScore: r.score,
      matchedChunks: [r],
      bestPreview: this.makePreview(r.chunk.text),
    }));
  }

  /**
   * Page 模式：同一页面合并，按页面最高分排序
   */
  private aggregateAsPages(results: SearchResult[], topK: number): PageSearchResult[] {
    const map = new Map<string, PageSearchResult>();

    for (const r of results) {
      const path = r.chunk.path;
      const existing = map.get(path);

      if (existing) {
        existing.matchedChunks.push(r);
        if (r.score > existing.topScore) {
          existing.topScore = r.score;
          existing.bestPreview = this.makePreview(r.chunk.text);
        }
      } else {
        map.set(path, {
          path,
          fileTitle: r.chunk.fileTitle,
          fileType: r.chunk.fileType,
          topScore: r.score,
          matchedChunks: [r],
          bestPreview: this.makePreview(r.chunk.text),
        });
      }
    }

    const pages = Array.from(map.values());
    pages.sort((a, b) => b.topScore - a.topScore);

    // 每页内的 chunks 按 sectionIndex 排序，便于阅读
    for (const p of pages) {
      p.matchedChunks.sort((a, b) => a.chunk.sectionIndex - b.chunk.sectionIndex);
    }

    return pages.slice(0, topK);
  }

  /**
   * 生成预览文本（去掉 heading，保留正文前 N 字）
   */
  private makePreview(text: string, maxLen = 160): string {
    // 去掉首行的 ## heading
    const lines = text.split("\n");
    if (lines[0] && /^#{1,6}\s+/.test(lines[0])) {
      lines.shift();
    }
    const body = lines.join(" ").replace(/\s+/g, " ").trim();
    if (body.length <= maxLen) return body;
    return body.substring(0, maxLen) + "…";
  }

  /**
   * 用于 RAG：返回原始 chunk 结果（不做页面聚合）
   */
  async searchForRAG(query: string, topK: number, minScore: number = 0): Promise<SearchResult[]> {
    const cleanQuery = normalizeText(query);
    if (!cleanQuery) return [];

    const s = this.getSettings();

    // 配额检查
    const estimated = TokenEstimator.estimate(cleanQuery);
    const quotaCheck = await this.quotaManager.canConsume(estimated);
    if (!quotaCheck.allowed) {
      throw new Error(quotaCheck.reason ?? "配额不足");
    }

    // 向量化
    const r = await this.embeddingClient.embed([cleanQuery]);
    const cost = TokenEstimator.estimateCost(r.totalTokens, s.costPerMillionTokensEmbedding);
    await this.quotaManager.consume(r.totalTokens, cost);

    // 搜索
    return await this.vectorStore.search(r.vectors[0], topK, minScore);
  }
}