import { App } from "obsidian";
import {
  RecallCard,
  RecallScenario,
  PhraseCardMetadata,
  PhraseEntry,
  SupportedLanguage,
  MindOSSettings,
} from "../../../core/types";
import { generateUID, nowISOString, sleep } from "../../../core/utils";
import { SRSEngine } from "../core/srs-engine";
import { RecallCardStore } from "../core/recall-card-store";
import { AICardGenerator } from "../core/ai-card-generator";
import { SUPPORTED_LANGUAGES } from "../../../core/constants";

export interface GeneratePhraseOptions {
  source: "manual" | "ai_topic";
  language: SupportedLanguage;
  customLanguage?: string;
  // manual 单条添加
  manualEntry?: PhraseEntry;
  // ai_topic AI 按主题生成
  topic?: string;
  count?: number;
  level?: string;
}

export interface PhraseGenerateProgress {
  total: number;
  done: number;
  currentPhrase: string;
  newCards: number;
  errors: string[];
}

/**
 * 多语言短语卡片生成器
 *
 * 数据源：
 *  1. 手动添加：用户填写一条
 *  2. AI 按主题生成：用户指定语言+主题+数量，AI 批量生成
 *
 * 卡片格式：
 *  - 正面：翻译（中文）
 *  - 背面：短语 + 罗马音 + 注释 + 例句
 */
export class RecallPhraseGenerator {
  private srsEngine: SRSEngine;

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private cardStore: RecallCardStore,
    private aiGenerator: AICardGenerator,
    private logger: (msg: string) => void,
  ) {
    this.srsEngine = new SRSEngine("sm2");
  }

  // ════════════════════════════════════════════════════════════
  // 主入口
  // ════════════════════════════════════════════════════════════
  async generate(
    opts: GeneratePhraseOptions,
    onProgress?: (p: PhraseGenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    if (opts.source === "manual") {
      return await this.generateManual(opts);
    }
    return await this.generateByTopic(opts, onProgress);
  }

  // ════════════════════════════════════════════════════════════
  // 手动添加
  // ════════════════════════════════════════════════════════════
  private async generateManual(opts: GeneratePhraseOptions): Promise<{ newCards: number; errors: string[] }> {
    const entry = opts.manualEntry;
    if (!entry || !entry.phrase || !entry.translation) {
      throw new Error("请填写短语和翻译");
    }

    const card = this.makeCard(entry, opts.language, opts.customLanguage);
    await this.cardStore.saveCard(card);
    this.cardStore.invalidateCache("phrase");

    this.logger(`✅ 短语卡片已创建：${entry.phrase}`);
    return { newCards: 1, errors: [] };
  }

  // ════════════════════════════════════════════════════════════
  // AI 按主题批量生成
  // ════════════════════════════════════════════════════════════
  private async generateByTopic(
    opts: GeneratePhraseOptions,
    onProgress?: (p: PhraseGenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    if (!opts.topic) {
      throw new Error("请输入主题");
    }
    const count = opts.count ?? 10;
    const langInfo = this.getLanguageInfo(opts.language, opts.customLanguage);

    const progress: PhraseGenerateProgress = {
      total: count,
      done: 0,
      currentPhrase: "",
      newCards: 0,
      errors: [],
    };
    onProgress?.(progress);

    this.logger(`ℹ️ AI 生成 ${langInfo.name} 短语：主题「${opts.topic}」× ${count} 条`);

    const systemPrompt = `你是${langInfo.name}短语卡片生成专家。
根据用户指定的主题，生成符合该主题的实用短语。

输出严格 JSON：
{
  "phrases": [
    {
      "phrase": "${langInfo.name}短语",
      "translation": "中文翻译",
      "romanization": "${langInfo.romanizationLabel}",
      "level": "难度等级（如 N5/A1）",
      "notes": "语法/用法说明（可选）",
      "examples": ["例句1", "例句2"]
    }
  ]
}`;

    const levelHint = opts.level ? `难度水平：${opts.level}` : "";
    const userPrompt = `请生成 ${count} 个${langInfo.name}「${opts.topic}」主题的实用短语。
${levelHint}

要求：
1. 每个短语必须真实地道，可以直接使用
2. romanization 必须正确（${langInfo.romanizationLabel}）
3. 至少 1 个例句
4. notes 简短说明使用场景或语法点
5. 按从易到难排序`;

    try {
      const items = await this.aiGenerator.generateSimple<any>(
        systemPrompt,
        userPrompt,
        0.4,
      );

      let newCards = 0;
      const errors: string[] = [];
      const cards: RecallCard[] = [];

      for (const item of items) {
        if (!item?.phrase || !item?.translation) continue;

        progress.currentPhrase = item.phrase;
        onProgress?.(progress);

        const entry: PhraseEntry = {
          phrase: String(item.phrase).trim(),
          translation: String(item.translation).trim(),
          romanization: item.romanization ? String(item.romanization).trim() : undefined,
          level: item.level ? String(item.level).trim() : undefined,
          notes: item.notes ? String(item.notes).trim() : undefined,
          examples: Array.isArray(item.examples)
            ? item.examples.map((e: any) => String(e).trim()).filter(Boolean)
            : [],
          category: opts.topic,
        };

        const card = this.makeCard(entry, opts.language, opts.customLanguage);
        cards.push(card);
        newCards++;
        progress.newCards = newCards;
        progress.done++;
        onProgress?.(progress);
      }

      if (cards.length > 0) {
        await this.cardStore.saveCards(cards);
        this.cardStore.invalidateCache("phrase");
      }

      this.logger(`✅ ${langInfo.name} 短语生成完成：${newCards} 张`);
      return { newCards, errors };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger(`❌ AI 生成失败：${msg}`);
      throw new Error(msg);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 构造卡片
  // ════════════════════════════════════════════════════════════
  private makeCard(
    entry: PhraseEntry,
    language: SupportedLanguage,
    customLanguage?: string,
  ): RecallCard {
    const id = `phrase_${generateUID()}`;
    const langInfo = this.getLanguageInfo(language, customLanguage);

    const meta: PhraseCardMetadata = {
      language,
      customLanguage,
      category: entry.category,
      romanization: entry.romanization,
      level: entry.level,
    };

    // 正面：中文翻译 + 类别提示
    let front = `**${entry.translation}**`;
    if (entry.category) {
      front += `\n\n*${entry.category}*`;
    }

    // 背面：短语 + 罗马音 + 备注 + 例句
    let back = `# ${entry.phrase}`;
    if (entry.romanization) {
      back += `\n\n${langInfo.romanizationLabel}：\`${entry.romanization}\``;
    }
    if (entry.level) {
      back += `\n\n难度：${entry.level}`;
    }
    if (entry.notes) {
      back += `\n\n**说明：** ${entry.notes}`;
    }

    const hints: string[] = [];
    if (entry.level) hints.push(`难度：${entry.level}`);
    if (entry.romanization) hints.push(`首音：${entry.romanization.substring(0, 3)}...`);

    return {
      id,
      scenario: "phrase" as RecallScenario,
      front,
      back,
      hints,
      examples: entry.examples ?? [],
      metadata: meta,
      sourcePath: undefined,
      sourceSection: `${langInfo.flag} ${langInfo.name}${entry.category ? " / " + entry.category : ""}`,
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      tags: ["phrase", language, entry.category, entry.level].filter(Boolean) as string[],
      status: "new",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }

  // ════════════════════════════════════════════════════════════
  // 工具：获取语言信息
  // ════════════════════════════════════════════════════════════
  private getLanguageInfo(
    code: SupportedLanguage,
    customName?: string,
  ): { name: string; flag: string; romanizationLabel: string } {
    if (code === "custom" && customName) {
      return { name: customName, flag: "🌐", romanizationLabel: "发音" };
    }

    const found = SUPPORTED_LANGUAGES.find((l) => l.code === code);
    if (found) return found;

    return { name: code, flag: "🌐", romanizationLabel: "发音" };
  }
}