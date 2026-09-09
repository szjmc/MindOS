import { App, TFile } from "obsidian";
import {
  RecallCard,
  RecallScenario,
  ConceptCardMetadata,
  MindOSSettings,
} from "../../../core/types";
import { IndexManager } from "../../wiki/index-manager";
import { parseFrontmatter, generateUID, nowISOString, sleep } from "../../../core/utils";
import { SRSEngine } from "../core/srs-engine";
import { RecallCardStore } from "../core/recall-card-store";
import { AICardGenerator } from "../core/ai-card-generator";

export interface GenerateConceptOptions {
  source: "wiki" | "manual";
  maxCardsPerPage?: number;
  onlyNewPages?: boolean;
  // manual 模式
  conceptName?: string;
  domain?: string;
}

export interface ConceptGenerateProgress {
  total: number;
  done: number;
  currentFile: string;
  newCards: number;
  errors: string[];
}

/**
 * 概念定义卡片生成器
 *
 * 数据源：
 *  1. Wiki 扫描：提取 concept 类型的页面 → 生成"概念→定义"卡片
 *  2. 手动添加：用户指定概念名，AI 生成完整定义
 */
export class RecallConceptGenerator {
  private srsEngine: SRSEngine;

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private indexManager: IndexManager,
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
    opts: GenerateConceptOptions,
    onProgress?: (p: ConceptGenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    if (opts.source === "manual") {
      return await this.generateManual(opts);
    }
    return await this.generateFromWiki(opts, onProgress);
  }

  // ════════════════════════════════════════════════════════════
  // 手动添加单个概念
  // ════════════════════════════════════════════════════════════
  private async generateManual(opts: GenerateConceptOptions): Promise<{ newCards: number; errors: string[] }> {
    const conceptName = opts.conceptName?.trim();
    if (!conceptName) {
      throw new Error("请输入概念名");
    }

    this.logger(`ℹ️ 手动生成概念卡片：${conceptName}`);

    const systemPrompt = `你是概念定义卡片生成专家。给定一个概念名，生成一张精准的复习卡片。
输出严格 JSON：
{
  "concept": "概念名",
  "definition": "精准的定义（≤80字）",
  "explanation": "详细解释（可用 Markdown）",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "examples": ["示例1", "示例2"],
  "relatedConcepts": ["相关概念1", "相关概念2"],
  "domain": "所属领域"
}`;

    const userPrompt = `请为「${conceptName}」生成定义卡片。
${opts.domain ? `所属领域：${opts.domain}` : ""}

要求：
1. definition 必须精准、可背诵
2. explanation 详细但不冗长（200字以内）
3. 提供 2-4 个关键要点
4. 至少 1 个具体示例`;

    try {
      const result = await this.aiGenerator.generateSimple<any>(
        systemPrompt,
        userPrompt,
        0.2,
      );

      if (result.length === 0 || !result[0]?.concept) {
        throw new Error("AI 未返回有效结果");
      }

      const item = result[0];
      const card = this.makeCard({
        conceptName: item.concept ?? conceptName,
        definition: item.definition ?? "",
        explanation: item.explanation ?? "",
        keyPoints: Array.isArray(item.keyPoints) ? item.keyPoints : [],
        examples: Array.isArray(item.examples) ? item.examples : [],
        relatedConcepts: Array.isArray(item.relatedConcepts) ? item.relatedConcepts : [],
        domain: item.domain ?? opts.domain ?? "通用",
        sourcePath: undefined,
      });

      await this.cardStore.saveCard(card);
      this.cardStore.invalidateCache("concept");

      this.logger(`✅ 概念卡片已创建：${conceptName}`);
      return { newCards: 1, errors: [] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger(`❌ ${conceptName}: ${msg}`);
      return { newCards: 0, errors: [`${conceptName}: ${msg}`] };
    }
  }

  // ════════════════════════════════════════════════════════════
  // Wiki 扫描生成
  // ════════════════════════════════════════════════════════════
  private async generateFromWiki(
    opts: GenerateConceptOptions,
    onProgress?: (p: ConceptGenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    const allPages = await this.indexManager.scanAllWikiPages();
    let pages = allPages.filter((p) => p.type === "concept");

    if (pages.length === 0) {
      throw new Error("Wiki 中没有 concept 类型的页面");
    }

    if (opts.onlyNewPages) {
      const existing = await this.cardStore.getAllCards("concept");
      const coveredPaths = new Set(
        existing
          .map((c) => (c.metadata as ConceptCardMetadata)?.sourcePath)
          .filter(Boolean),
      );
      pages = pages.filter((p) => !coveredPaths.has(p.path));
    }

    const progress: ConceptGenerateProgress = {
      total: pages.length,
      done: 0,
      currentFile: "",
      newCards: 0,
      errors: [],
    };
    onProgress?.(progress);

    this.logger(`ℹ️ 概念扫描：${pages.length} 个 concept 页面`);

    let newCards = 0;
    const errors: string[] = [];
    const maxCards = opts.maxCardsPerPage ?? 2;

    for (const page of pages) {
      progress.currentFile = page.path;
      onProgress?.(progress);

      try {
        const file = this.app.vault.getAbstractFileByPath(page.path);
        if (!(file instanceof TFile)) continue;

        const content = await this.app.vault.read(file);
        const { body } = parseFrontmatter(content);

        if (body.trim().length < 50) {
          progress.done++;
          continue;
        }

        const cards = await this.generateCardsForConceptPage(
          page.path,
          page.title,
          body,
          maxCards,
        );

        await this.cardStore.saveCards(cards);
        newCards += cards.length;
        progress.newCards = newCards;
        this.logger(`✅ ${page.title}：生成 ${cards.length} 张概念卡片`);

        await sleep(500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${page.path}: ${msg}`);
        this.logger(`❌ ${page.path}: ${msg}`);
      }

      progress.done++;
      onProgress?.(progress);
    }

    this.cardStore.invalidateCache("concept");
    return { newCards, errors };
  }

  // ════════════════════════════════════════════════════════════
  // 单页 AI 生成
  // ════════════════════════════════════════════════════════════
  private async generateCardsForConceptPage(
    path: string,
    title: string,
    body: string,
    maxCards: number,
  ): Promise<RecallCard[]> {
    const systemPrompt = `你是概念定义卡片生成专家。
从给定的 Wiki 概念页面中提取核心概念，每个概念做成一张精准定义卡。

输出严格 JSON：
{
  "cards": [
    {
      "concept": "概念名（核心术语）",
      "definition": "精准的定义（一句话，≤80字）",
      "explanation": "详细解释（可用 Markdown）",
      "keyPoints": ["要点1", "要点2"],
      "examples": ["示例1"],
      "relatedConcepts": ["相关概念1", "相关概念2"],
      "domain": "所属领域"
    }
  ]
}`;

    const userPrompt = `请从以下 Wiki 概念页面中提取概念定义卡片，最多 ${maxCards} 张。

页面标题：${title}

═══ 笔记内容 ═══

${body.substring(0, 3000)}

═══════════════

要求：
1. 主概念是「${title}」本身，必须有一张
2. 如果页面提到其他重要子概念（如"OOP" 中的"封装/继承/多态"），可单独成卡
3. definition 必须可背诵（一句话）
4. 不要生成模糊的卡片，每张必须有明确答案`;

    const items = await this.aiGenerator.generateSimple<any>(
      systemPrompt,
      userPrompt,
      0.2,
    );

    const cards: RecallCard[] = [];
    for (const item of items) {
      if (!item?.concept || !item?.definition) continue;

      cards.push(this.makeCard({
        conceptName: item.concept,
        definition: item.definition,
        explanation: item.explanation ?? "",
        keyPoints: Array.isArray(item.keyPoints) ? item.keyPoints : [],
        examples: Array.isArray(item.examples) ? item.examples : [],
        relatedConcepts: Array.isArray(item.relatedConcepts) ? item.relatedConcepts : [],
        domain: item.domain ?? "通用",
        sourcePath: path,
      }));
    }

    return cards;
  }

  // ════════════════════════════════════════════════════════════
  // 构造卡片
  // ════════════════════════════════════════════════════════════
  private makeCard(opts: {
    conceptName: string;
    definition: string;
    explanation: string;
    keyPoints: string[];
    examples: string[];
    relatedConcepts: string[];
    domain: string;
    sourcePath?: string;
  }): RecallCard {
    const id = `concept_${generateUID()}`;
    const meta: ConceptCardMetadata = {
      conceptName: opts.conceptName,
      domain: opts.domain,
      relatedConcepts: opts.relatedConcepts,
      sourcePath: opts.sourcePath,
    };

    // 卡片正面：什么是 X？
    const front = `什么是「${opts.conceptName}」？`;

    // 卡片背面：定义 + 解释 + 关联
    let back = `## ${opts.conceptName}\n\n**${opts.definition}**`;

    if (opts.explanation) {
      back += `\n\n${opts.explanation}`;
    }

    if (opts.keyPoints.length > 0) {
      back += `\n\n**关键要点：**\n${opts.keyPoints.map((p) => `- ${p}`).join("\n")}`;
    }

    if (opts.relatedConcepts.length > 0) {
      back += `\n\n**关联概念：** ${opts.relatedConcepts.join("、")}`;
    }

    return {
      id,
      scenario: "concept" as RecallScenario,
      front,
      back,
      hints: opts.keyPoints.slice(0, 2),
      examples: opts.examples,
      metadata: meta,
      sourcePath: opts.sourcePath,
      sourceSection: opts.domain,
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      tags: ["concept", opts.domain].filter(Boolean),
      status: "new",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }
}