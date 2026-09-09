import { App, normalizePath } from "obsidian";
import { vaultSave } from "../../../core/utils";

interface CardVectorIndex {
  updatedAt: string;
  model?: string;
  vectors: Record<string, number[]>;
}

export class CardVectorStore {
  private app: App;
  private getBaseFolder: () => string;

  constructor(app: App, getBaseFolder: () => string) {
    this.app = app;
    this.getBaseFolder = getBaseFolder;
  }

  private get filePath(): string {
    return normalizePath(`${this.getBaseFolder()}/_系统数据/复习/卡片向量.json`);
  }

  async load(): Promise<CardVectorIndex> {
    const file = this.app.vault.getAbstractFileByPath(this.filePath);
    if (!file) {
      return {
        updatedAt: new Date().toISOString(),
        vectors: {},
      };
    }

    try {
      const content = await this.app.vault.read(file as any);
      const data = JSON.parse(content);
      return {
        updatedAt: data.updatedAt || new Date().toISOString(),
        model: data.model,
        vectors: data.vectors || {},
      };
    } catch {
      return {
        updatedAt: new Date().toISOString(),
        vectors: {},
      };
    }
  }

  async save(index: CardVectorIndex): Promise<void> {
    await this.ensureParentFolder();
    const content = JSON.stringify(index, null, 2);
    await vaultSave(this.app, this.filePath, content);
  }

  async getVector(cardId: string): Promise<number[] | null> {
    const index = await this.load();
    return index.vectors[cardId] || null;
  }

  async setVector(cardId: string, vector: number[], model?: string): Promise<void> {
    const index = await this.load();
    index.vectors[cardId] = vector;
    index.updatedAt = new Date().toISOString();
    if (model) index.model = model;
    await this.save(index);
  }

  async setVectors(batch: Record<string, number[]>, model?: string): Promise<void> {
    const index = await this.load();
    for (const [id, vec] of Object.entries(batch)) {
      index.vectors[id] = vec;
    }
    index.updatedAt = new Date().toISOString();
    if (model) index.model = model;
    await this.save(index);
  }

  async removeVector(cardId: string): Promise<void> {
    const index = await this.load();
    delete index.vectors[cardId];
    index.updatedAt = new Date().toISOString();
    await this.save(index);
  }

  async clear(): Promise<void> {
    await this.save({
      updatedAt: new Date().toISOString(),
      vectors: {},
    });
  }

  private async ensureParentFolder() {
    const path = normalizePath(`${this.getBaseFolder()}/_系统数据/复习`);
    const exists = this.app.vault.getAbstractFileByPath(path);
    if (exists) return;

    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
}