import { App } from "obsidian";
import {
  RecallCard,
  RecallScenario,
  WordEntry,
  WordList,
  VocabReviewMode,
  VocabCardMetadata,
  MindOSSettings,
} from "../../../core/types";
import { generateUID, nowISOString, sleep, vaultSave } from "../../../core/utils";
import { SRSEngine } from "../core/srs-engine";
import { RecallCardStore } from "../core/recall-card-store";
import { WordListStore } from "../vocab/word-list-store";
import { AICardGenerator } from "../core/ai-card-generator";

export interface VocabGenerateOptions {
  wordListId: string;
  count: number;                    // 本次生成多少新词
  reviewMode: VocabReviewMode;      // 主复习模式（mixed 时会同时生成多张）
  generateExtraWithAI?: boolean;    // 词条信息不足时用 AI 补全
}

export interface VocabGenerateProgress {
  total: number;
  done: number;
  currentWord: string;
  newCards: number;
  errors: string[];
}

/**
 * 英语单词卡片生成器
 *
 * 工作流程：
 *  1. 根据词库的 startIndex 取出未学的 N 个新词
 *  2. 为每个词按选定的 reviewMode 生成 1-3 张卡片
 *  3. 词条信息不全时（自定义/精简词库）可用 AI 补全
 *  4. 更新 wordList.config.startIndex
 */
export class RecallVocabGenerator {
  private srsEngine: SRSEngine;

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private cardStore: RecallCardStore,
    private wordListStore: WordListStore,
    private aiGenerator: AICardGenerator,
    private logger: (msg: string) => void,
  ) {
    this.srsEngine = new SRSEngine("sm2");
  }

  // ════════════════════════════════════════════════════════════
  // 主入口：生成单词卡片
  // ════════════════════════════════════════════════════════════
  async generate(
    opts: VocabGenerateOptions,
    onProgress?: (p: VocabGenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    const wl = await this.wordListStore.getList(opts.wordListId);
    if (!wl) throw new Error(`词库不存在：${opts.wordListId}`);

    const config = wl.config!;
    const startIndex = config.startIndex;

    // 取出待学习的词条
    const entries = await this.wordListStore.getEntriesRange(
      opts.wordListId,
      startIndex,
      opts.count,
    );

    if (entries.length === 0) {
      throw new Error(`词库「${wl.name}」已学完，无可用新词`);
    }

    const progress: VocabGenerateProgress = {
      total: entries.length,
      done: 0,
      currentWord: "",
      newCards: 0,
      errors: [],
    };
    onProgress?.(progress);

    this.logger(`ℹ️ 词库「${wl.name}」开始生成 ${entries.length} 个单词的卡片`);

    let newCards = 0;
    const allCards: RecallCard[] = [];

    for (const entry of entries) {
      progress.currentWord = entry.word;
      onProgress?.(progress);

      try {
        let workingEntry = entry;

        // 词条信息不足时用 AI 补全
        if (opts.generateExtraWithAI && this.needsEnrichment(entry)) {
          try {
            workingEntry = await this.enrichWithAI(entry);
            await sleep(300);
          } catch (e) {
            this.logger(`⚠️ ${entry.word} AI 补全失败，使用原词条`);
          }
        }

        // 生成该词的卡片
        const cardsForWord = this.generateCardsForWord(
          workingEntry,
          wl,
          opts.reviewMode,
        );

        allCards.push(...cardsForWord);
        newCards += cardsForWord.length;
        progress.newCards = newCards;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        progress.errors.push(`${entry.word}: ${msg}`);
        this.logger(`❌ ${entry.word}: ${msg}`);
      }

      progress.done++;
      onProgress?.(progress);
    }

    // 批量保存卡片
    if (allCards.length > 0) {
      await this.cardStore.saveCards(allCards);
    }

    // 更新词库进度
    await this.wordListStore.updateListConfig(opts.wordListId, {
      startIndex: startIndex + entries.length,
      totalLearned: (config.totalLearned ?? 0) + entries.length,
    });

    this.cardStore.invalidateCache("vocab");
    this.logger(`✅ 单词卡片生成完成：${newCards} 张（${entries.length} 个新词）`);

    return { newCards, errors: progress.errors };
  }

  // ════════════════════════════════════════════════════════════
  // 单个单词的卡片生成
  // ════════════════════════════════════════════════════════════
  private generateCardsForWord(
    entry: WordEntry,
    wl: WordList,
    mode: VocabReviewMode,
  ): RecallCard[] {
    const modes: VocabReviewMode[] = mode === "mixed"
      ? ["en_to_cn", "cn_to_en"]   // mixed = 中英互译两张卡
      : [mode];

    return modes.map((m) => this.makeCardForMode(entry, wl, m));
  }

  private makeCardForMode(
    entry: WordEntry,
    wl: WordList,
    mode: VocabReviewMode,
  ): RecallCard {
    const id = `vocab_${wl.id}_${entry.word.replace(/\s+/g, "_")}_${mode}_${generateUID()}`;
    const meta: VocabCardMetadata = {
      word: entry.word,
      phonetic: entry.phonetic,
      partOfSpeech: entry.partOfSpeech,
      wordList: wl.id,
      reviewMode: mode,
      frequency: entry.frequency,
      entry,
    };

    let front = "";
    let back = "";
    let hints: string[] = [];
    let examples: string[] = [];

    const definitionsText = entry.definitions.join("；");

    if (mode === "en_to_cn") {
      // 英 → 中：看英文猜中文
      front = entry.word;
      const phoneticLine = entry.phonetic ? `\n\n${entry.phonetic}` : "";
      const posLine = entry.partOfSpeech ? `\n\n*${entry.partOfSpeech}*` : "";
      back = `**${entry.word}**${phoneticLine}${posLine}\n\n**释义：** ${definitionsText}`;

      if (entry.englishDef) {
        back += `\n\n*${entry.englishDef}*`;
      }

      if (entry.partOfSpeech) hints.push(`词性：${entry.partOfSpeech}`);
      if (entry.phonetic) hints.push(`音标：${entry.phonetic}`);

    } else if (mode === "cn_to_en") {
      // 中 → 英：看中文猜英文
      front = `**${definitionsText}**${entry.partOfSpeech ? `\n\n*${entry.partOfSpeech}*` : ""}`;
      const phoneticLine = entry.phonetic ? `\n\n${entry.phonetic}` : "";
      back = `# ${entry.word}${phoneticLine}\n\n**释义：** ${definitionsText}`;

      // 提示首字母
      hints.push(`首字母：${entry.word[0].toUpperCase()}`);
      hints.push(`长度：${entry.word.length} 个字母`);

    } else if (mode === "spell") {
      // 拼写模式：看中文 + 听音标 写出英文
      front = `${definitionsText}${entry.phonetic ? `\n\n${entry.phonetic}` : ""}${entry.partOfSpeech ? `\n\n*${entry.partOfSpeech}*` : ""}`;
      back = `# ${entry.word}\n\n${definitionsText}`;

      hints.push(`首字母：${entry.word[0].toUpperCase()}`);
      hints.push(`字母数：${entry.word.replace(/\s+/g, '').length}`);
    }

    // 例句
    if (entry.examples && entry.examples.length > 0) {
      for (const ex of entry.examples) {
        examples.push(ex.cn ? `${ex.en}\n→ ${ex.cn}` : ex.en);
      }
    }

    // 同/反义词
    if (entry.synonyms && entry.synonyms.length > 0) {
      back += `\n\n**同义词：** ${entry.synonyms.join(", ")}`;
    }
    if (entry.antonyms && entry.antonyms.length > 0) {
      back += `\n\n**反义词：** ${entry.antonyms.join(", ")}`;
    }

    return {
      id,
      scenario: "vocab" as RecallScenario,
      front,
      back,
      hints,
      examples,
      metadata: meta,
      sourcePath: undefined,
      sourceSection: `${wl.cover ?? "📚"} ${wl.name}`,
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      tags: ["vocab", wl.id, wl.level ?? "", mode].filter(Boolean),
      status: "new",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }

  // ════════════════════════════════════════════════════════════
  // AI 补全词条信息（用于精简词库）
  // ════════════════════════════════════════════════════════════
  private needsEnrichment(entry: WordEntry): boolean {
    if (!entry.examples || entry.examples.length === 0) return true;
    if (!entry.phonetic) return true;
    if (entry.definitions.length === 0) return true;
    return false;
  }

  private async enrichWithAI(entry: WordEntry): Promise<WordEntry> {
    const systemPrompt = `你是英语词典编辑专家。给定一个英文单词，输出完整的词条信息。
输出严格 JSON：
{
  "phonetic": "/音标/",
  "partOfSpeech": "n. v. adj. adv. 等",
  "definitions": ["中文释义1", "中文释义2"],
  "englishDef": "英文简短释义",
  "examples": [{"en": "英文例句", "cn": "中文翻译"}],
  "synonyms": ["近义词1", "近义词2"],
  "antonyms": ["反义词1"]
}`;

    const userPrompt = `请提供单词「${entry.word}」的完整词条信息。
${entry.partOfSpeech ? `已知词性：${entry.partOfSpeech}` : ""}
${entry.definitions.length > 0 ? `已知释义：${entry.definitions.join("；")}` : ""}

要求：
- 至少 1 个例句（带中文翻译）
- 释义保留已知的，可以补充
- 例句要地道实用`;

    const result = await this.aiGenerator.generateSimple<any>(
      systemPrompt,
      userPrompt,
      0.2,
    );

    const aiData = result[0];
    if (!aiData) return entry;

    return {
      ...entry,
      phonetic: entry.phonetic || aiData.phonetic,
      partOfSpeech: entry.partOfSpeech || aiData.partOfSpeech,
      definitions: entry.definitions.length > 0
        ? entry.definitions
        : (Array.isArray(aiData.definitions) ? aiData.definitions : []),
      englishDef: entry.englishDef || aiData.englishDef,
      examples: entry.examples && entry.examples.length > 0
        ? entry.examples
        : (Array.isArray(aiData.examples) ? aiData.examples : []),
      synonyms: entry.synonyms || aiData.synonyms,
      antonyms: entry.antonyms || aiData.antonyms,
    };
  }

  // ════════════════════════════════════════════════════════════
  // AI 扩展词库（为空词库批量生成词条）
  // ════════════════════════════════════════════════════════════
  async expandWordList(
    wordListId: string,
    count: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ added: number }> {
    const wl = await this.wordListStore.getList(wordListId);
    if (!wl) throw new Error(`词库不存在：${wordListId}`);

    if (wl.source !== "builtin" && wl.source !== "custom") {
      throw new Error(`不支持扩展该类型词库`);
    }

    const existing = await this.wordListStore.getEntries(wordListId);
    const existingSet = new Set(existing.map((e) => e.word.toLowerCase()));

    const batchSize = 20;
    const batches = Math.ceil(count / batchSize);
    const newEntries: WordEntry[] = [];

    this.logger(`ℹ️ 开始 AI 扩展词库「${wl.name}」（目标 ${count} 词，分 ${batches} 批）`);

    for (let i = 0; i < batches; i++) {
      const remaining = count - newEntries.length;
      if (remaining <= 0) break;

      const batchCount = Math.min(batchSize, remaining);
      const startIdx = existing.length + newEntries.length + 1;

      const systemPrompt = `你是英语词典编辑专家。请为指定的英语水平词库生成核心词汇。
输出严格 JSON：
{
  "words": [
    {
      "word": "单词",
      "phonetic": "/音标/",
      "partOfSpeech": "词性",
      "definitions": ["释义1", "释义2"],
      "examples": [{"en": "例句", "cn": "翻译"}],
      "frequency": 词频排名（数字）
    }
  ]
}`;

      const excludeList = Array.from(existingSet).slice(0, 50).join(", ");
      const userPrompt = `请为「${wl.name}」（${wl.level}）生成 ${batchCount} 个核心高频词汇。

要求：
1. 词频从 ${startIdx} 名开始
2. 每个词必须包含音标、词性、至少 1 个释义、1 个例句
3. 不要包含以下已有词汇：${excludeList || "（无）"}
4. 选择真正高频实用的词，避免生僻词`;

      try {
        const items = await this.aiGenerator.generateSimple<any>(
          systemPrompt,
          userPrompt,
          0.3,
        );

        for (const item of items) {
          if (!item?.word) continue;
          const word = String(item.word).trim();
          if (!word || existingSet.has(word.toLowerCase())) continue;

          existingSet.add(word.toLowerCase());

          newEntries.push({
            word,
            phonetic: item.phonetic,
            partOfSpeech: item.partOfSpeech,
            definitions: Array.isArray(item.definitions) ? item.definitions : [String(item.definitions ?? "")],
            examples: Array.isArray(item.examples) ? item.examples : [],
            frequency: item.frequency || (existing.length + newEntries.length + 1),
          });
        }

        onProgress?.(newEntries.length, count);
        await sleep(500);
      } catch (e) {
        this.logger(`❌ 第 ${i + 1} 批失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (newEntries.length === 0) {
      throw new Error("AI 未生成任何有效词条");
    }

    // 合并保存
    const allEntries = [...existing, ...newEntries];
    await this.persistEntries(wordListId, allEntries);

    this.logger(`✅ 词库「${wl.name}」扩展完成：新增 ${newEntries.length} 词`);
    return { added: newEntries.length };
  }

  /**
   * 持久化词条（替换文件中的全部词条）
   */
  private async persistEntries(wordListId: string, entries: WordEntry[]): Promise<void> {
    const filePath = `${this.getSettings().baseFolder}/_系统数据/复习/词库/${wordListId}.json`;
    const content = JSON.stringify(entries, null, 2);
    await vaultSave(this.app, filePath, content);
    this.wordListStore.invalidateCache();
  }
}