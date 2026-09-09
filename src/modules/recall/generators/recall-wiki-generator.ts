import { App, TFile } from "obsidian";
import {
  RecallCard,
  RecallScenario,
  WikiCardMeta,
  PageType,
} from "../../../core/types";
import { MindOSSettings } from "../../../core/types";
import { IndexManager } from "../../wiki/index-manager";
import { parseFrontmatter, generateUID, nowISOString } from "../../../core/utils";
import { SRSEngine } from "../core/srs-engine";
import { RecallCardStore } from "../core/recall-card-store";
import { requestUrl } from "obsidian";
import { sleep } from "../../../core/utils";

export interface GenerateWikiCardsOptions {
  maxCardsPerPage?: number;   // 每页最多生成几张卡片（默认 3）
  onlyNewPages?: boolean;     // 只处理还没有卡片的页面
  targetPaths?: string[];     // 指定处理哪些页面（空=全部）
  pageTypes?: PageType[];     // 指定处理哪些页面类型
}

export interface GenerateProgress {
  total: number;
  done: number;
  currentFile: string;
  newCards: number;
  errors: string[];
}

export class RecallWikiGenerator {
  private srsEngine: SRSEngine;

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private indexManager: IndexManager,
    private cardStore: RecallCardStore,
    private logger: (msg: string) => void,
  ) {
    this.srsEngine = new SRSEngine("sm2");
  }

  // ════════════════════════════════════════════════════════════
  // 批量生成 Wiki 卡片
  // ════════════════════════════════════════════════════════════

  async generateFromWiki(
    opts: GenerateWikiCardsOptions = {},
    onProgress?: (p: GenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    const {
      maxCardsPerPage = 3,
      onlyNewPages = false,
      targetPaths = [],
      pageTypes,
    } = opts;

    const s = this.getSettings();
    if (!s.apiBaseUrl || !s.apiKey || !s.model) {
      throw new Error("请先配置 Chat 模型 API");
    }

    // 扫描 Wiki 页面
    let pages = await this.indexManager.scanAllWikiPages();

    if (pageTypes && pageTypes.length > 0) {
      pages = pages.filter((p) => pageTypes.includes(p.type));
    }

    if (targetPaths.length > 0) {
      const set = new Set(targetPaths);
      pages = pages.filter((p) => set.has(p.path));
    }

    if (onlyNewPages) {
      const existingCards = await this.cardStore.getAllCards("wiki");
      const coveredPaths = new Set(
        existingCards
          .map((c) => (c.metadata as WikiCardMeta)?.wikiPath)
          .filter(Boolean),
      );
      pages = pages.filter((p) => !coveredPaths.has(p.path));
    }

    const progress: GenerateProgress = {
      total: pages.length,
      done: 0,
      currentFile: "",
      newCards: 0,
      errors: [],
    };

    onProgress?.(progress);
    this.logger(`ℹ️ 开始生成 Wiki 卡片，共 ${pages.length} 个页面`);

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

        const cards = await this.generateCardsForPage(
          page.path,
          page.title,
          page.type,
          body,
          maxCardsPerPage,
        );

        await this.cardStore.saveCards(cards);
        progress.newCards += cards.length;
        this.logger(`✅ ${page.title}：生成 ${cards.length} 张卡片`);

        // 避免 API 限流
        await sleep(500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        progress.errors.push(`${page.path}: ${msg}`);
        this.logger(`❌ ${page.path}: ${msg}`);
      }

      progress.done++;
      onProgress?.(progress);
    }

    this.cardStore.invalidateCache("wiki");
    this.logger(`✅ Wiki 卡片生成完成：${progress.newCards} 张新卡片`);

    return { newCards: progress.newCards, errors: progress.errors };
  }

  // ════════════════════════════════════════════════════════════
  // 单页生成
  // ════════════════════════════════════════════════════════════

  async generateCardsForPage(
    path: string,
    title: string,
    pageType: PageType,
    body: string,
    maxCards: number = 3,
  ): Promise<RecallCard[]> {
    const s = this.getSettings();
    const srsAlg = (s as any).recallSRSAlgorithm ?? "sm2";
    this.srsEngine.setAlgorithm(srsAlg);

    const prompt = this.buildPrompt(title, pageType, body, maxCards);
    const raw = await this.callAPI(prompt);
    const parsed = this.parseResponse(raw);

    return parsed.map((item) => {
      const id = `wiki_${generateUID()}`;
      const meta: WikiCardMeta = {
        pageType,
        wikiPath: path,
        section: item.section ?? title,
      };

      return {
        id,
        scenario: "wiki" as RecallScenario,
        front: item.front,
        back: item.back,
        hints: item.hints ?? [],
        examples: item.examples ?? [],
        metadata: meta,
        sourcePath: path,
        sourceSection: item.section ?? title,
        srs: this.srsEngine.createInitialSRS(srsAlg),
        stats: {
          totalReviews: 0,
          correctCount: 0,
          wrongCount: 0,
          avgResponseTimeMs: 0,
          streak: 0,
        },
        tags: ["wiki", pageType],
        status: "new" as const,
        createdAt: nowISOString(),
        updatedAt: nowISOString(),
      };
    });
  }

  // ════════════════════════════════════════════════════════════
  // Prompt 构建
  // ════════════════════════════════════════════════════════════

  private buildPrompt(
    title: string,
    pageType: PageType,
    body: string,
    maxCards: number,
  ): string {
    const typeHint: Record<string, string> = {
      entity: "这是一个实体（人物/工具/产品），重点考察其定义、特性、用途",
      concept: "这是一个概念，重点考察其定义、原理、使用场景",
      topic: "这是一个主题，重点考察核心知识点和实战经验",
      comparison: "这是对比内容，重点考察两者的关键区别",
      overview: "这是概述，重点考察领域全景和核心分类",
    };

    return `你是一个记忆卡片生成专家。请基于以下 Wiki 笔记，生成 ${maxCards} 张高质量的复习卡片。

页面标题：${title}
页面类型：${pageType}（${typeHint[pageType] ?? "通用知识"}）

━━━━ 笔记内容 ━━━━

${body.substring(0, 3000)}

━━━━━━━━━━━━━━━━━━

生成规则：
1. 每张卡片考察一个独立知识点
2. front（正面）：简洁的问题，15字以内
3. back（背面）：完整准确的答案，可以用 Markdown 格式（代码块/列表/表格都OK）
4. hints：1-2个提示，帮助回忆（可选）
5. examples：1个具体示例（可选）
6. section：来自笔记哪个章节

请输出严格 JSON（不要代码块包裹）：

{
  "cards": [
    {
      "front": "问题",
      "back": "答案（Markdown 格式）",
      "hints": ["提示1"],
      "examples": ["示例1"],
      "section": "来源章节标题"
    }
  ]
}

注意：
- 问题要有明确答案，不要出模糊题
- 答案要准确，直接来自笔记内容，不要臆造
- 不同卡片考察不同知识点，不要重复`;
  }

  // ════════════════════════════════════════════════════════════
  // API 调用
  // ════════════════════════════════════════════════════════════

  private async callAPI(prompt: string): Promise<string> {
    const s = this.getSettings();
    const endpoint = `${s.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    const maxRetries = Math.max(0, s.maxRetries);
    let lastError: Error = new Error("未知错误");

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(attempt * 2000);
      }

      try {
        const response = await requestUrl({
          url: endpoint,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.apiKey}`,
          },
          body: JSON.stringify({
            model: s.model,
            temperature: 0.3,
            stream: false,
            messages: [
              {
                role: "system",
                content: "你是记忆卡片生成专家，专门从笔记中提取核心知识点生成复习卡片。输出严格 JSON。",
              },
              { role: "user", content: prompt },
            ],
          }),
        });

        if (response.status === 401) throw new Error("401 invalid_api_key");
        if (response.status === 402) throw new Error("402 insufficient_quota");
        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = response.json as any;
        const content = data?.choices?.[0]?.message?.content ?? "";
        if (!content) throw new Error("模型返回为空");
        return content;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (
          lastError.message.includes("401") ||
          lastError.message.includes("402")
        ) throw lastError;
      }
    }
    throw lastError;
  }

  private parseResponse(raw: string): Array<{
    front: string;
    back: string;
    hints?: string[];
    examples?: string[];
    section?: string;
  }> {
    let json = raw.trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!json.startsWith("{")) {
      const m = json.match(/\{[\s\S]*\}/);
      if (m) json = m[0];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error("AI 返回无法解析为 JSON");
    }

    const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
    return cards
      .filter((c: any) => c?.front && c?.back)
      .map((c: any) => ({
        front: String(c.front).trim(),
        back: String(c.back).trim(),
        hints: Array.isArray(c.hints) ? c.hints.map(String) : [],
        examples: Array.isArray(c.examples) ? c.examples.map(String) : [],
        section: c.section ? String(c.section).trim() : undefined,
      }));
  }
}