/**
 * MigrationService —— 数据迁移与备份编排（v1.1 / 路线图 4C）
 *
 * 能力：
 * - 导出：Anki 文本 / CSV / Markdown / JSON
 * - 导入：JSON / Anki 文本 / CSV（自动识别）
 * - 完整备份与恢复（卡片 + 插件数据）
 */
import { App, normalizePath } from "obsidian";
import { RecallCard } from "../../core/types";
import { DIR_MIGRATION } from "../../core/constants";
import { vaultSave } from "../../core/utils";
import { RecallCardStore } from "../recall/core/recall-card-store";
import { toAnkiText, toCSV, toMarkdown, toJSON } from "./anki-exporter";
import { parseCards, ParsedImport } from "./data-importer";

export interface ImportSummary {
  imported: number;
  duplicated: number;
  invalid: number;
  errors: string[];
}

export class MigrationService {
  constructor(
    private app: App,
    private getBaseFolder: () => string,
    private cardStore: RecallCardStore,
    private loadPluginData: () => Promise<any>,
    private savePluginData: (data: any) => Promise<void>,
  ) {}

  // ════════════════════════════════════════════════════════════
  // 内部工具
  // ════════════════════════════════════════════════════════════

  private get exportDir(): string {
    return normalizePath(`${this.getBaseFolder()}/${DIR_MIGRATION}`);
  }

  private stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  private async ensureDir(path: string): Promise<void> {
    if (!(await this.app.vault.adapter.exists(path))) {
      await this.app.vault.createFolder(path);
    }
  }

  private async writeFile(fileName: string, content: string): Promise<string> {
    await this.ensureDir(this.exportDir);
    const path = normalizePath(`${this.exportDir}/${fileName}`);
    await vaultSave(this.app, path, content);
    return path;
  }

  async collectAllCards(): Promise<RecallCard[]> {
    return this.cardStore.getAllCards();
  }

  // ════════════════════════════════════════════════════════════
  // 导出
  // ════════════════════════════════════════════════════════════

  async exportAnki(): Promise<string> {
    const cards = await this.collectAllCards();
    return this.writeFile(`mindos-anki-${this.stamp()}.txt`, toAnkiText(cards));
  }

  async exportCSV(): Promise<string> {
    const cards = await this.collectAllCards();
    return this.writeFile(`mindos-cards-${this.stamp()}.csv`, toCSV(cards));
  }

  async exportMarkdown(): Promise<string> {
    const cards = await this.collectAllCards();
    return this.writeFile(`mindos-cards-${this.stamp()}.md`, toMarkdown(cards));
  }

  async exportJSON(): Promise<string> {
    const cards = await this.collectAllCards();
    return this.writeFile(`mindos-cards-${this.stamp()}.json`, toJSON(cards));
  }

  // ════════════════════════════════════════════════════════════
  // 完整备份 / 恢复
  // ════════════════════════════════════════════════════════════

  async exportBackup(): Promise<string> {
    const cards = await this.collectAllCards();
    const pluginData = (await this.loadPluginData()) || {};
    const backup = {
      type: "mindos-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      cardCount: cards.length,
      cards,
      pluginData,
    };
    return this.writeFile(`mindos-backup-${this.stamp()}.json`, JSON.stringify(backup, null, 2));
  }

  async restoreBackup(filePath: string): Promise<{ cards: number; pluginDataRestored: boolean }> {
    const content = await this.app.vault.adapter.read(filePath);
    return this.restoreFromText(content);
  }

  /** 从备份文本恢复（支持本地文件直读） */
  async restoreFromText(content: string): Promise<{ cards: number; pluginDataRestored: boolean }> {
    let data: any;
    try {
      data = JSON.parse(content);
    } catch {
      throw new Error("备份文件不是合法 JSON");
    }
    if (data?.type !== "mindos-backup" || !Array.isArray(data.cards)) {
      throw new Error("备份文件格式不正确（缺少 type=mindos-backup 或 cards 数组）");
    }

    // 卡片：saveCard 按 id upsert，天然去重
    await this.cardStore.saveCards(data.cards);

    // 插件数据：浅合并（备份键优先）
    let pluginDataRestored = false;
    if (data.pluginData && typeof data.pluginData === "object") {
      const current = (await this.loadPluginData()) || {};
      await this.savePluginData({ ...current, ...data.pluginData });
      pluginDataRestored = true;
    }

    return { cards: data.cards.length, pluginDataRestored };
  }

  // ════════════════════════════════════════════════════════════
  // 导入
  // ════════════════════════════════════════════════════════════

  async importFromFile(filePath: string): Promise<ImportSummary> {
    const content = await this.app.vault.adapter.read(filePath);
    return this.importFromText(content);
  }

  /** 从文本导入（支持本地文件直读） */
  async importFromText(content: string): Promise<ImportSummary> {
    const parsed: ParsedImport = parseCards(content);

    // 去重：已存在相同 id 的卡片跳过（JSON 回导场景）
    const existing = await this.cardStore.getAllCards();
    const existingIds = new Set(existing.map((c) => c.id));

    const fresh: RecallCard[] = [];
    let duplicated = 0;
    for (const card of parsed.cards) {
      if (existingIds.has(card.id)) {
        duplicated++;
        continue;
      }
      fresh.push(card);
      existingIds.add(card.id);
    }

    await this.cardStore.saveCards(fresh);

    return {
      imported: fresh.length,
      duplicated,
      invalid: parsed.skipped,
      errors: parsed.errors,
    };
  }
}
