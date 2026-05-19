import { App } from 'obsidian';
import type {
  ArticleOutline,
  ArticleDraft,
  ExpressGenerateOptions,
  OutlineSection,
} from '../../core/types';
import {
  EXPRESS_LENGTH_MAP,
  EXPRESS_MAX_CONTEXT_CHUNKS
} from '../../core/constants';
import {
  buildOutlineSystemPrompt,
  getStyleTemplate
} from './style-templates';

// ----------------------------------------------------------------
// 本模块内部类型（避免与 types.ts 中 SearchMode 冲突）
// ----------------------------------------------------------------

export type ExpressSearchMode = 'vector' | 'keyword' | 'none';

export interface WikiContext {
  chunks: string[];
  sourcePages: string[];
  searchMode: ExpressSearchMode;
}

// ----------------------------------------------------------------
// 外部依赖接口
// ----------------------------------------------------------------

export interface AIClientLike {
  chat(
    systemPrompt: string,
    userMessage: string,
    signal?: AbortSignal
  ): Promise<string>;
}

/**
 * 适配真实 SemanticSearch 的接口
 * 真实签名：search(query, options?) => Promise<PageSearchResult[]>
 * 此处用宽松签名 + 适配器模式，在 main.ts 中包装传入
 */
export interface SemanticSearchLike {
  search(
    query: string,
    topK: number
  ): Promise<Array<{ content: string; filePath: string; score: number }>>;
}

// ----------------------------------------------------------------
// OutlineBuilder
// ----------------------------------------------------------------

export class OutlineBuilder {
  private app: App;
  private aiClient: AIClientLike;
  private semanticSearch: SemanticSearchLike | null;
  private vaultRoot: string;

  constructor(
    app: App,
    aiClient: AIClientLike,
    vaultRoot: string,
    semanticSearch: SemanticSearchLike | null = null
  ) {
    this.app            = app;
    this.aiClient       = aiClient;
    this.vaultRoot      = vaultRoot;
    this.semanticSearch = semanticSearch;
  }

  // ---- 公开入口 ------------------------------------------------

  async buildOutline(
    draft: ArticleDraft,
    options: ExpressGenerateOptions,
    signal?: AbortSignal
  ): Promise<ArticleOutline> {

    // Step 1: 获取 Wiki 上下文
    const wikiCtx = options.useWikiContext
      ? await this.fetchWikiContext(options.topic, signal)
      : { chunks: [], sourcePages: [], searchMode: 'none' as ExpressSearchMode };

    // Step 2: 构建 prompt
    const lengthCfg    = EXPRESS_LENGTH_MAP[options.lengthHint];
    const systemPrompt = buildOutlineSystemPrompt(
      options.style,
      lengthCfg.description,
      lengthCfg.sectionsHint
    );
    const userMessage = this.buildOutlineUserMessage(options, wikiCtx, lengthCfg.targetWords);

    // Step 3: 调用 AI
    const rawJson = await this.aiClient.chat(systemPrompt, userMessage, signal);

    // Step 4: 解析 JSON
    const parsed = this.parseOutlineJson(rawJson);

    // Step 5: 组装 ArticleOutline（显式 String/Number 转换，避免 unknown 类型错误）
    const outline: ArticleOutline = {
      title:               typeof parsed.title === 'string'
                             ? parsed.title
                             : String(parsed.title ?? options.topic),
      oneLiner:            typeof parsed.oneLiner === 'string'
                             ? parsed.oneLiner
                             : String(parsed.oneLiner ?? ''),
      style:               options.style,
      targetAudience:      typeof parsed.targetAudience === 'string'
                             ? parsed.targetAudience
                             : String(parsed.targetAudience ?? '通用读者'),
      sections:            this.normalizeSections(
                             Array.isArray(parsed.sections) ? parsed.sections : []
                           ),
      totalEstimatedWords: typeof parsed.totalEstimatedWords === 'number'
                             ? parsed.totalEstimatedWords
                             : Number(parsed.totalEstimatedWords ?? lengthCfg.targetWords),
      sourcePages:         wikiCtx.sourcePages,
      searchMode:          wikiCtx.searchMode,
    };

    return outline;
  }

  // ---- Wiki 上下文检索（三级降级） -----------------------------

  private async fetchWikiContext(
    topic: string,
    signal?: AbortSignal
  ): Promise<WikiContext> {

    // 优先：向量检索
    if (this.semanticSearch) {
      try {
        const results = await this.semanticSearch.search(
          topic,
          EXPRESS_MAX_CONTEXT_CHUNKS
        );
        if (results.length > 0) {
          return {
            chunks:      results.map(r => r.content),
            sourcePages: this.dedupePages(results.map(r => r.filePath)),
            searchMode:  'vector'
          };
        }
      } catch {
        // 降级到关键词
      }
    }

    // 降级：关键词全文检索
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    try {
      const keywordResults = await this.keywordSearch(topic);
      if (keywordResults.length > 0) {
        return {
          chunks:      keywordResults.map(r => r.content),
          sourcePages: this.dedupePages(keywordResults.map(r => r.filePath)),
          searchMode:  'keyword'
        };
      }
    } catch {
      // 最终降级
    }

    return { chunks: [], sourcePages: [], searchMode: 'none' };
  }

  private async keywordSearch(
    topic: string
  ): Promise<Array<{ content: string; filePath: string }>> {
    const adapter  = this.app.vault.adapter;
    const wikiPath = `${this.vaultRoot}/wiki`;
    const keywords = topic
      .split(/[\s，,、]+/)
      .filter(k => k.length > 1)
      .slice(0, 5);

    if (keywords.length === 0) return [];

    const results: Array<{ content: string; filePath: string; score: number }> = [];
    const allFiles = await this.listMarkdownFiles(wikiPath);

    for (const filePath of allFiles) {
      try {
        const content  = await adapter.read(filePath);
        const hitCount = keywords.filter(k =>
          content.toLowerCase().includes(k.toLowerCase())
        ).length;
        if (hitCount > 0) {
          const snippet = this.extractSnippet(content, keywords, 500);
          results.push({ content: snippet, filePath, score: hitCount });
        }
      } catch {
        // 忽略
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, EXPRESS_MAX_CONTEXT_CHUNKS);
  }

  private async listMarkdownFiles(dir: string): Promise<string[]> {
    const adapter = this.app.vault.adapter;
    const files: string[] = [];
    try {
      const listed = await adapter.list(dir);
      for (const file of listed.files) {
        if (file.endsWith('.md')) files.push(file);
      }
      for (const subDir of listed.folders) {
        const subFiles = await this.listMarkdownFiles(subDir);
        files.push(...subFiles);
      }
    } catch {
      // 目录不存在跳过
    }
    return files;
  }

  private extractSnippet(
    content: string,
    keywords: string[],
    maxLen: number
  ): string {
    const body = content.replace(/^---[\s\S]*?---\n/, '');
    let pos = 0;
    for (const kw of keywords) {
      const idx = body.toLowerCase().indexOf(kw.toLowerCase());
      if (idx !== -1) { pos = Math.max(0, idx - 100); break; }
    }
    return body.slice(pos, pos + maxLen).trim();
  }

  private dedupePages(paths: string[]): string[] {
    const seen = new Set<string>();
    return paths
      .map(p => p.replace(`${this.vaultRoot}/`, '').replace(/\.md$/, ''))
      .filter(p => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
      });
  }

  // ---- Prompt 构建 --------------------------------------------

  private buildOutlineUserMessage(
    options: ExpressGenerateOptions,
    ctx: WikiContext,
    targetWords: number
  ): string {
    const parts: string[] = [];

    parts.push(`## 文章主题`);
    parts.push(options.topic);
    parts.push('');
    parts.push(`## 目标字数`);
    parts.push(`约 ${targetWords} 字（${EXPRESS_LENGTH_MAP[options.lengthHint].description}）`);

    if (options.extraInstruction) {
      parts.push('');
      parts.push(`## 补充要求`);
      parts.push(options.extraInstruction);
    }

    if (ctx.chunks.length > 0) {
      parts.push('');
      parts.push(`## 参考知识库内容`);
      parts.push(`> 检索方式：${
        ctx.searchMode === 'vector'  ? '语义向量检索' :
        ctx.searchMode === 'keyword' ? '关键词全文检索' : '无'
      }`);
      parts.push('');
      ctx.chunks.forEach((chunk, i) => {
        parts.push(`### 知识片段 ${i + 1}`);
        parts.push(chunk.slice(0, 600));
        parts.push('');
      });
    } else if (options.useWikiContext) {
      parts.push('');
      parts.push(`> ⚠️ Wiki 中未找到「${options.topic}」的相关内容，请基于通用知识生成大纲。`);
    }

    parts.push('');
    parts.push('请根据以上信息生成文章大纲（严格按照 JSON 格式输出）：');
    return parts.join('\n');
  }

  // ---- JSON 解析 -----------------------------------------------

  private parseOutlineJson(raw: string): Record<string, unknown> {
    const jsonMatch =
      raw.match(/```json\s*([\s\S]*?)```/) ||
      raw.match(/```\s*([\s\S]*?)```/)     ||
      raw.match(/(\{[\s\S]*\})/);

    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw.trim();

    try {
      return JSON.parse(jsonStr) as Record<string, unknown>;
    } catch {
      const fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":');
      try {
        return JSON.parse(fixed) as Record<string, unknown>;
      } catch {
        throw new Error(`大纲 JSON 解析失败，AI 原始输出：\n${raw.slice(0, 300)}`);
      }
    }
  }

  private normalizeSections(raw: unknown[]): OutlineSection[] {
    return raw
      .filter(s => s && typeof s === 'object')
      .map((s, i) => {
        const sec = s as Record<string, unknown>;
        return {
          id:             String(sec.id             ?? `s${i + 1}`),
          level:          Number(sec.level          ?? 1),
          title:          String(sec.title          ?? `章节 ${i + 1}`),
          keyPoints:      Array.isArray(sec.keyPoints)
                            ? (sec.keyPoints as unknown[]).map(String)
                            : [],
          estimatedWords: Number(sec.estimatedWords ?? 300)
        } as OutlineSection;
      });
  }
}