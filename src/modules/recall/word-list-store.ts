import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  WordList,
  WordEntry,
  WordListUserConfig,
  WordListProgress,
} from "../../core/types";
import {
  DIR_RECALL_WORDLISTS,
  BUILTIN_WORDLISTS,
  VOCAB_DEFAULT_NEW_PER_DAY,
} from "../../core/constants";
import { nowISOString } from "../../core/utils";
import { BUILTIN_VOCAB_DATA } from "./builtin-vocab-data";

/**
 * 词库存储管理器
 *
 * 数据存储：
 *   _system/recall/wordlists/
 *     ├── lists.json              ← 词库元信息 + 用户配置
 *     ├── cet4.json               ← CET4 词条数据（按需加载）
 *     ├── cet6.json               ← ...
 *     ├── custom_xxx.json         ← 用户自定义词库
 *     └── ...
 */
export class WordListStore {
  private listsCache: Map<string, WordList> = new Map();
  private entriesCache: Map<string, WordEntry[]> = new Map();
  private listsLoaded = false;

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
    await this.ensureFolder(this.path(DIR_RECALL_WORDLISTS));
    await this.loadLists();
    await this.installBuiltinIfMissing();
  }

  /**
   * 安装内置词库（如果不存在的话）
   */
  private async installBuiltinIfMissing(): Promise<void> {
    for (const def of BUILTIN_WORDLISTS) {
      if (this.listsCache.has(def.id)) continue;

      const wl: WordList = {
        id: def.id,
        name: def.name,
        description: def.description,
        source: "builtin",
        level: def.level,
        totalWords: def.totalWords,
        language: "en",
        cover: def.cover,
        createdAt: nowISOString(),
        updatedAt: nowISOString(),
        config: {
          enabled: false,           // 默认未启用，用户主动启用
          newPerDay: VOCAB_DEFAULT_NEW_PER_DAY,
          reviewMode: "en_to_cn",
          startIndex: 0,
          totalLearned: 0,
        },
      };

      this.listsCache.set(def.id, wl);
    }

    await this.saveLists();
  }

  // ════════════════════════════════════════════════════════════
  // 词库元信息 CRUD
  // ════════════════════════════════════════════════════════════
  private async loadLists(): Promise<void> {
    const filePath = this.path(`${DIR_RECALL_WORDLISTS}/lists.json`);
    const f = this.app.vault.getAbstractFileByPath(filePath);

    if (f instanceof TFile) {
      try {
        const content = await this.app.vault.read(f);
        const data = JSON.parse(content) as WordList[];
        this.listsCache.clear();
        for (const wl of data) {
          this.listsCache.set(wl.id, wl);
        }
      } catch {
        // 损坏，重置
      }
    }

    this.listsLoaded = true;
  }

  private async saveLists(): Promise<void> {
    await this.ensureFolder(this.path(DIR_RECALL_WORDLISTS));
    const filePath = this.path(`${DIR_RECALL_WORDLISTS}/lists.json`);
    const content = JSON.stringify(Array.from(this.listsCache.values()), null, 2);
    const f = this.app.vault.getAbstractFileByPath(filePath);
    if (f instanceof TFile) {
      await this.app.vault.modify(f, content);
    } else {
      await this.app.vault.create(filePath, content);
    }
  }

  async getAllLists(): Promise<WordList[]> {
    if (!this.listsLoaded) await this.loadLists();
    return Array.from(this.listsCache.values());
  }

  async getList(id: string): Promise<WordList | null> {
    if (!this.listsLoaded) await this.loadLists();
    return this.listsCache.get(id) ?? null;
  }

  async updateListConfig(id: string, config: Partial<WordListUserConfig>): Promise<void> {
    const wl = await this.getList(id);
    if (!wl) return;
    wl.config = { ...(wl.config ?? this.defaultConfig()), ...config };
    wl.updatedAt = nowISOString();
    this.listsCache.set(id, wl);
    await this.saveLists();
  }

  private defaultConfig(): WordListUserConfig {
    return {
      enabled: false,
      newPerDay: VOCAB_DEFAULT_NEW_PER_DAY,
      reviewMode: "en_to_cn",
      startIndex: 0,
      totalLearned: 0,
    };
  }

  async deleteList(id: string): Promise<void> {
    const wl = await this.getList(id);
    if (!wl) return;
    if (wl.source === "builtin") {
      throw new Error("内置词库不可删除");
    }

    this.listsCache.delete(id);
    await this.saveLists();

    const entriesPath = this.path(`${DIR_RECALL_WORDLISTS}/${id}.json`);
    const f = this.app.vault.getAbstractFileByPath(entriesPath);
    if (f instanceof TFile) {
      await this.app.vault.delete(f);
    }
    this.entriesCache.delete(id);
  }

  // ════════════════════════════════════════════════════════════
  // 词条 CRUD
  // ════════════════════════════════════════════════════════════
  async getEntries(listId: string): Promise<WordEntry[]> {
    if (this.entriesCache.has(listId)) {
      return this.entriesCache.get(listId)!;
    }

    let entries: WordEntry[] = [];

    // 内置词库优先从代码读取（启动快）
    const builtinData = (BUILTIN_VOCAB_DATA as any)[listId];
    if (builtinData) {
      entries = builtinData;
    } else {
      // 自定义词库从文件读取
      const filePath = this.path(`${DIR_RECALL_WORDLISTS}/${listId}.json`);
      const f = this.app.vault.getAbstractFileByPath(filePath);
      if (f instanceof TFile) {
        try {
          const content = await this.app.vault.read(f);
          entries = JSON.parse(content) as WordEntry[];
        } catch {}
      }
    }

    this.entriesCache.set(listId, entries);
    return entries;
  }

  /**
   * 按词频排序后取范围内的词条
   * @param listId 词库 ID
   * @param start 起始 index
   * @param count 数量
   */
  async getEntriesRange(listId: string, start: number, count: number): Promise<WordEntry[]> {
    const all = await this.getEntries(listId);
    return all.slice(start, start + count);
  }

  /**
   * 创建自定义词库
   */
  async createCustomList(opts: {
    name: string;
    description?: string;
    entries: WordEntry[];
    cover?: string;
  }): Promise<WordList> {
    const id = `custom_${Date.now()}`;
    const wl: WordList = {
      id,
      name: opts.name,
      description: opts.description ?? "",
      source: "custom",
      level: "自定义",
      totalWords: opts.entries.length,
      language: "en",
      cover: opts.cover ?? "📔",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
      config: this.defaultConfig(),
    };

    this.listsCache.set(id, wl);
    await this.saveLists();

    // 保存词条
    const filePath = this.path(`${DIR_RECALL_WORDLISTS}/${id}.json`);
    await this.app.vault.create(filePath, JSON.stringify(opts.entries, null, 2));
    this.entriesCache.set(id, opts.entries);

    return wl;
  }

  /**
   * 从 CSV 文本导入词库
   * 格式：word,definition[,phonetic,partOfSpeech,example_en,example_cn]
   */
  async importFromCSV(name: string, csvText: string): Promise<WordList> {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
    const entries: WordEntry[] = [];

    for (const line of lines) {
      const cols = this.parseCSVLine(line);
      if (cols.length < 2) continue;

      const word = cols[0].trim();
      if (!word) continue;

      entries.push({
        word,
        definitions: [cols[1].trim()],
        phonetic: cols[2]?.trim() || undefined,
        partOfSpeech: cols[3]?.trim() || undefined,
        examples: cols[4]?.trim()
          ? [{ en: cols[4].trim(), cn: cols[5]?.trim() }]
          : undefined,
      });
    }

    if (entries.length === 0) {
      throw new Error("CSV 文件没有解析出任何单词");
    }

    return await this.createCustomList({
      name,
      description: `从 CSV 导入，共 ${entries.length} 词`,
      entries,
    });
  }

  /**
   * 从 TXT 文本导入（每行一个 单词,释义）
   */
  async importFromTXT(name: string, txtText: string): Promise<WordList> {
    const lines = txtText.split(/\r?\n/).filter((l) => l.trim());
    const entries: WordEntry[] = [];

    for (const line of lines) {
      // 支持多种分隔符：tab / 中英文逗号 / 空格 + 中文释义
      const m = line.match(/^([a-zA-Z][a-zA-Z'\-\s]*?)[\s,，\t]+(.+)$/);
      if (!m) continue;

      const word = m[1].trim();
      const definition = m[2].trim();

      if (!word || !definition) continue;

      entries.push({
        word,
        definitions: [definition],
      });
    }

    if (entries.length === 0) {
      throw new Error("TXT 文件没有解析出任何单词");
    }

    return await this.createCustomList({
      name,
      description: `从 TXT 导入，共 ${entries.length} 词`,
      entries,
    });
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += c;
      }
    }
    result.push(current);
    return result;
  }

  // ════════════════════════════════════════════════════════════
  // 进度统计
  // ════════════════════════════════════════════════════════════
  async getProgress(listId: string, vocabCards: any[]): Promise<WordListProgress> {
    const wl = await this.getList(listId);
    if (!wl) {
      return {
        wordListId: listId,
        totalWords: 0,
        startedWords: 0,
        masteredWords: 0,
        inProgressWords: 0,
      };
    }

    const cardsForThisList = vocabCards.filter(
      (c) => c.metadata?.wordList === listId,
    );

    const wordsCovered = new Set<string>();
    const wordsMastered = new Set<string>();

    for (const c of cardsForThisList) {
      const word = c.metadata?.word;
      if (!word) continue;
      wordsCovered.add(word);
      if (c.status === "mastered") {
        wordsMastered.add(word);
      }
    }

    return {
      wordListId: listId,
      totalWords: wl.totalWords,
      startedWords: wordsCovered.size,
      masteredWords: wordsMastered.size,
      inProgressWords: wordsCovered.size - wordsMastered.size,
      lastStudiedAt: wl.updatedAt,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 缓存管理
  // ════════════════════════════════════════════════════════════
  invalidateCache() {
    this.listsCache.clear();
    this.entriesCache.clear();
    this.listsLoaded = false;
  }

  // ════════════════════════════════════════════════════════════
  // 工具
  // ════════════════════════════════════════════════════════════
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