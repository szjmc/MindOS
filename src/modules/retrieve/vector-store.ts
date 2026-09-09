import { App, normalizePath, TFile } from "obsidian";
import { FILE_VECTORS, DIR_SYSTEM } from "../../core/constants";
import { ChunkMeta, VectorIndex, SearchResult } from "../../core/types";
import { nowISOString, vaultSave } from "../../core/utils";

export class VectorStore {
  private index: VectorIndex | null = null;
  private dirty = false;

  constructor(
    private app: App,
    private getBaseFolder: () => string,
  ) {}

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  async load(): Promise<VectorIndex> {
    if (this.index) return this.index;

    const f = this.app.vault.getAbstractFileByPath(this.path(FILE_VECTORS));
    if (f instanceof TFile) {
      try {
        const content = await this.app.vault.read(f);
        const parsed = JSON.parse(content) as VectorIndex;
        if (parsed.version === 1 && Array.isArray(parsed.chunks)) {
          this.index = parsed;
          return this.index;
        }
      } catch {
        // 解析失败，重建
      }
    }

    this.index = this.empty();
    return this.index;
  }

  async save(): Promise<void> {
    if (!this.index || !this.dirty) return;
    await this.ensureFolder(this.path(DIR_SYSTEM));
    this.index.updatedAt = nowISOString();
    this.index.totalChunks = this.index.chunks.length;
    const pageSet = new Set(this.index.chunks.map((c) => c.path));
    this.index.totalPages = pageSet.size;

    const content = JSON.stringify(this.index);
    const path = this.path(FILE_VECTORS);
    await vaultSave(this.app, path, content);
    this.dirty = false;
  }

  /** 添加/更新一组 chunk（按 id 去重） */
  async upsertChunks(chunks: ChunkMeta[]): Promise<void> {
    const idx = await this.load();
    const map = new Map(idx.chunks.map((c) => [c.id, c]));
    for (const c of chunks) {
      map.set(c.id, c);
    }
    idx.chunks = Array.from(map.values());
    this.dirty = true;
  }

  /** 删除指定文件的所有 chunk */
  async removeByPath(path: string): Promise<void> {
    const idx = await this.load();
    const before = idx.chunks.length;
    idx.chunks = idx.chunks.filter((c) => c.path !== path);
    if (idx.chunks.length !== before) {
      this.dirty = true;
    }
  }

  /** 删除多个文件的 chunk */
  async removeByPaths(paths: string[]): Promise<void> {
    const set = new Set(paths);
    const idx = await this.load();
    const before = idx.chunks.length;
    idx.chunks = idx.chunks.filter((c) => !set.has(c.path));
    if (idx.chunks.length !== before) {
      this.dirty = true;
    }
  }

  /** 清空所有向量 */
  async clear(): Promise<void> {
    this.index = this.empty();
    this.dirty = true;
    await this.save();
  }

  /** 检查 chunk 是否需要重建（基于 hash） */
  async needsRebuild(chunkId: string, hash: string): Promise<boolean> {
    const idx = await this.load();
    const existing = idx.chunks.find((c) => c.id === chunkId);
    return !existing || existing.hash !== hash;
  }

  /** 获取某文件的所有 chunk */
  async getChunksByPath(path: string): Promise<ChunkMeta[]> {
    const idx = await this.load();
    return idx.chunks.filter((c) => c.path === path);
  }

  /** 获取所有 chunk */
  async getAllChunks(): Promise<ChunkMeta[]> {
    const idx = await this.load();
    return idx.chunks;
  }

  /** 获取已索引的文件列表（路径 → mtime）*/
  async getIndexedFiles(): Promise<Map<string, number>> {
    const idx = await this.load();
    const map = new Map<string, number>();
    for (const c of idx.chunks) {
      const cur = map.get(c.path) ?? 0;
      if (c.fileMtime > cur) map.set(c.path, c.fileMtime);
    }
    return map;
  }

  /** 设置索引元信息 */
  async setMeta(model: string, dim: number): Promise<void> {
    const idx = await this.load();
    idx.model = model;
    idx.vectorDim = dim;
    this.dirty = true;
  }

  async getMeta(): Promise<{ model: string; dim: number; total: number; pages: number }> {
    const idx = await this.load();
    return {
      model: idx.model,
      dim: idx.vectorDim,
      total: idx.chunks.length,
      pages: new Set(idx.chunks.map((c) => c.path)).size,
    };
  }

  /** 余弦相似度搜索 */
  async search(queryVector: number[], topK: number, minScore: number = 0): Promise<SearchResult[]> {
    const idx = await this.load();
    if (idx.chunks.length === 0) return [];

    const results: SearchResult[] = [];
    for (const chunk of idx.chunks) {
      if (chunk.vector.length !== queryVector.length) continue;
      const score = this.cosine(queryVector, chunk.vector);
      if (score >= minScore) {
        results.push({ chunk, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** 余弦相似度 */
  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private empty(): VectorIndex {
    return {
      version: 1,
      model: "",
      vectorDim: 0,
      totalChunks: 0,
      totalPages: 0,
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
      chunks: [],
    };
  }

  private async ensureFolder(p: string) {
    const path = normalizePath(p);
    if (await this.app.vault.adapter.exists(path)) return;
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e: any) {
          if (!e?.message?.includes?.("already exists")) throw e;
        }
      }
    }
  }
}