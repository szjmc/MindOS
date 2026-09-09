import { App, normalizePath, TFile } from "obsidian";
import {
  WikiAction,
  MindOSSettings,
  PromptPayload,
  ConversationRound,
} from "../../core/types";
import { PAGE_TYPE_DIRS } from "../../core/constants";
import {
  parseFrontmatter,
  buildFrontmatter,
  safeFileName,
  nowDateString,
  nowISOString,
  generateUID,
  truncateBrief,
} from "../../core/utils";
import { IndexManager } from "../wiki/index-manager";

// 页面类型对应的封面 emoji
const PAGE_TYPE_COVERS: Record<string, string> = {
  entity: "👤",
  concept: "💡",
  topic: "📚",
  comparison: "⚖️",
  overview: "🗂️",
};

export class ActionExecutor {
  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private getBaseFolder: () => string,
    private indexManager: IndexManager,
    private logger: (msg: string) => void,
  ) {}

  async execute(
    action: WikiAction,
    rounds: ConversationRound[],
    payload: PromptPayload,
  ): Promise<void> {
    const s = this.getSettings();

    if (!action.path) {
      const dir = PAGE_TYPE_DIRS[action.pageType];
      const folder = normalizePath(`${this.getBaseFolder()}/${dir}`);
      await this.ensureFolder(folder);
      action.path = normalizePath(`${folder}/${safeFileName(action.title)}.md`);
    }

    const existing = this.app.vault.getAbstractFileByPath(action.path);
    const briefShort = truncateBrief(action.brief, s.briefMaxLength);

    if (action.op === "create") {
      if (existing instanceof TFile) {
        await this.appendToExisting(existing, action);
      } else {
        await this.createNew(action, briefShort);
      }
    } else if (action.op === "update" || action.op === "append_section") {
      if (existing instanceof TFile) {
        await this.appendToExisting(existing, action);
      } else {
        await this.createNew(action, briefShort);
      }
    } else if (action.op === "link") {
      if (existing instanceof TFile) {
        await this.appendLinks(existing, action);
      }
    }

    await this.indexManager.upsertEntry({
      path: action.path,
      type: action.pageType,
      title: action.title,
      brief: briefShort,
      tags: action.tags,
      status: s.defaultMaturity,
    });
  }

  // ════════════════════════════════════════════════════════════
  // 创建新文件 - v0.6.4 优化版 frontmatter
  // ════════════════════════════════════════════════════════════
  private async createNew(action: WikiAction, brief: string): Promise<void> {
    const s = this.getSettings();
    const uid = generateUID();
    const now = nowISOString();
    const today = nowDateString();

    // ✅ 估算字数
    const wordCount = this.estimateWordCount(action.content);

    // ✅ 构建丰富的 frontmatter
    const fmData: Record<string, any> = {
      uid,
      cover: action.cover || PAGE_TYPE_COVERS[action.pageType] || "📄",
      title: action.title,
    };

    // 别名（如果有）
    if (action.aliases && action.aliases.length > 0) {
      fmData.aliases = action.aliases;
    }

    fmData.type = action.pageType;

    // 分类（如果有）
    if (action.category) {
      fmData.category = action.category;
    }

    fmData.brief = brief;

    // 详细描述（如果与 brief 不同）
    if (action.summary && action.summary !== brief) {
      fmData.summary = action.summary;
    }

    fmData.status = s.defaultMaturity;

    // 标签（去重 + 自动补充）
    const allTags = new Set<string>(["mindos-collected"]);
    for (const t of action.tags) {
      if (t && t.trim()) allTags.add(t.trim());
    }
    fmData.tags = Array.from(allTags);

    // 时间
    fmData.created = today;
    fmData.updated = today;
    fmData.created_at = now;

    // 字数
    fmData.wordcount = wordCount;

    // 来源对话引用
    if (action.sourceDisplayNames && action.sourceDisplayNames.length > 0) {
      fmData.references = action.sourceDisplayNames;
    }

    const fm = buildFrontmatter(fmData);

    // 关联区
    const linksSection = action.links.length > 0
      ? `\n\n## 🔗 关联\n${action.links.map((l) => `- ${l}`).join("\n")}`
      : "";

    // ✅ 优化的内容结构：标题 + 简介引用 + 正文
    const sanitizedContent = this.sanitizeMarkdown(action.content);
    const content = `${fm}

# ${fmData.cover} ${action.title}

> [!abstract] 简介
> ${brief}${action.summary && action.summary !== brief ? `\n> \n> ${action.summary}` : ""}

${sanitizedContent}${linksSection}
`;

    // ✅ 防竞态：adapter.exists 直查文件系统，避免 Vault 索引未就绪时重复创建
    if (await this.app.vault.adapter.exists(action.path)) {
      const existingFile = this.app.vault.getAbstractFileByPath(action.path);
      if (existingFile instanceof TFile) {
        await this.appendToExisting(existingFile, action);
      }
      return;
    }
    try {
      await this.app.vault.create(action.path, content);
    } catch (e: any) {
      if (e?.message?.includes?.("already exists")) {
        // 并发竞态：文件刚刚被其他调用创建，忽略即可
        return;
      }
      throw e;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 追加到已有文件 - v0.6.4 同步更新 frontmatter + 去重
  // ════════════════════════════════════════════════════════════
  private async appendToExisting(file: TFile, action: WikiAction): Promise<void> {
    const original = await this.app.vault.read(file);
    const { frontmatter, body } = parseFrontmatter(original);

    // ✅ 更新时间
    frontmatter.updated = nowDateString();
    frontmatter.updated_at = nowISOString();

    // ✅ 合并标签
    const tags: string[] = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    for (const t of action.tags) {
      if (t && !tags.includes(t)) tags.push(t);
    }
    frontmatter.tags = tags;

    // ✅ 合并别名
    if (action.aliases && action.aliases.length > 0) {
      const aliases: string[] = Array.isArray(frontmatter.aliases) ? frontmatter.aliases : [];
      for (const a of action.aliases) {
        if (a && !aliases.includes(a)) aliases.push(a);
      }
      frontmatter.aliases = aliases;
    }

    // ✅ 合并来源
    if (action.sourceDisplayNames && action.sourceDisplayNames.length > 0) {
      const refs: string[] = Array.isArray(frontmatter.references) ? frontmatter.references : [];
      for (const r of action.sourceDisplayNames) {
        if (r && !refs.includes(r)) refs.push(r);
      }
      frontmatter.references = refs;
    }

    // ✅ 去重检查：计算新内容与已有正文的相似度
    const similarity = this.computeSimilarity(action.content, body);
    if (similarity > 0.7) {
      // 新内容与已有内容高度重复（>70%），跳过追加，仅更新 frontmatter
      this.logger(`⚠️ ${action.title}：内容相似度 ${similarity.toFixed(2)}，跳过重复追加`);
      const newFm = buildFrontmatter(frontmatter);
      await this.app.vault.modify(file, `${newFm}\n${body}`);
      return;
    }

    // ✅ 重新计算字数
    const newBodyEstimate = body + "\n" + action.content;
    frontmatter.wordcount = this.estimateWordCount(newBodyEstimate);

    const newFm = buildFrontmatter(frontmatter);

    let newBody: string;

    if (action.section) {
      const sectionRegex = new RegExp(`(^${this.escapeRegex(action.section)}[ \\t]*\\n)`, "m");
      if (sectionRegex.test(body)) {
        newBody = body.replace(sectionRegex, `$1\n${action.content}\n\n`);
      } else {
        newBody = `${body.trimEnd()}\n\n${action.content}\n`;
      }
    } else {
      newBody = `${body.trimEnd()}\n\n---\n\n## 📝 更新（${nowDateString()}）\n\n${action.content}\n`;
    }

    await this.app.vault.modify(file, `${newFm}\n${newBody}`);
  }

  /**
   * ✅ 清洗 AI 生成的 Markdown 内容，修复常见的 Obsidian 格式错误
   *
   * 修复的问题：
   * - `| ![[type]] title` → `> [!type] title`（AI 混淆了表格/引用/callout 语法）
   * - 裸露的空 blockquote 行（`>` 单独成行无内容）→ 移除
   * - 连续多个空行 → 压缩为单个空行
   */
  private sanitizeMarkdown(content: string): string {
    if (!content) return content;

    let result = content;

    // 1. 修复畸形 callout：`| ![[type]] title` → `> [!type] title`
    // AI 有时会混淆 Obsidian callout 语法，用 | (表格列) 和 [[...]] (wiki链接) 组合
    result = result.replace(
      /^\| \!\[\[([a-z]+)\]\]\s*(.*)$/gm,
      "> [!$1] $2"
    );

    // 2. 修复另一种畸形：`> ![[type]] title` → `> [!type] title`
    result = result.replace(
      /^>\s*\!\[\[([a-z]+)\]\]\s*(.*)$/gm,
      "> [!$1] $2"
    );

    // 3. 移除裸露的空 blockquote 行（只有 `>` 或 `> ` 无实际内容）
    // 但保留 callout 内部的空行分隔（即上下文有 > [!] 开头的行时保留）
    result = result.replace(/^(>)\s*$/gm, (_match, prefix) => {
      // 如果前一行是 callout 标题或内容行，保留作为 callout 空行
      return prefix; // 保留原样（Obsidian 需要它来维持 callout 结构）
    });

    // 4. 压缩 3+ 个连续空行为 2 个
    result = result.replace(/\n{4,}/g, "\n\n\n");

    // 5. 移除行首尾空白（保持每行干净）
    result = result.split("\n").map(line => line.trimEnd()).join("\n");

    return result;
  }

  /**
   * ✅ 计算两段文本的相似度（基于关键词重叠率）
   * 返回 0~1 的浮点数，1 表示完全相同
   */
  private computeSimilarity(newContent: string, existingBody: string): number {
    if (!newContent || !existingBody) return 0;

    // 提取关键词集合：中文词（连续汉字段）+ 英文词 + 代码/数字片段
    const extractKeywords = (text: string): Set<string> => {
      const cleaned = text
        .replace(/```[\s\S]*?```/g, "")   // 代码块整体移除（代码相似度另算）
        .replace(/---[\s\S]*?---/g, "")    // frontmatter 移除
        .replace(/[#>*\-_=`~!]/g, "")      // markdown 符号
        .replace(/\[\[[^\]]*\]\]/g, "")    // wiki 链接
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // 普通链接保留文字

      const keywords = new Set<string>();
      // 中文连续段（2字以上算关键词）
      const chineseMatches = cleaned.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
      for (const m of chineseMatches) keywords.add(m);
      // 英文单词（3字母以上）
      const englishMatches = cleaned.match(/[a-zA-Z]{3,}/g) ?? [];
      for (const m of englishMatches) keywords.add(m.toLowerCase());
      return keywords;
    };

    const newKw = extractKeywords(newContent);
    const existKw = extractKeywords(existingBody);

    if (newKw.size === 0) return 0;
    if (existKw.size === 0) return 0;

    // 计算重叠率：新内容的关键词有多少在已有内容中存在
    let overlap = 0;
    for (const kw of newKw) {
      if (existKw.has(kw)) overlap++;
    }

    return overlap / newKw.size;
  }

  private async appendLinks(file: TFile, action: WikiAction): Promise<void> {
    const original = await this.app.vault.read(file);
    const { frontmatter, body } = parseFrontmatter(original);
    frontmatter.updated = nowDateString();
    const newFm = buildFrontmatter(frontmatter);

    const linkBlock = `\n\n## 🔗 关联（${nowDateString()}）\n${action.links.map((l) => `- ${l}`).join("\n")}\n`;
    await this.app.vault.modify(file, `${newFm}\n${body.trimEnd()}${linkBlock}`);
  }

  /**
   * ✅ 字数估算（中英文混合）
   */
  private estimateWordCount(text: string): number {
    if (!text) return 0;
    // 移除 frontmatter、代码块、链接语法等不计入字数的部分
    const cleaned = text
      .replace(/```[\s\S]*?```/g, "")    // 代码块
      .replace(/`[^`]*`/g, "")            // 行内代码
      .replace(/\[\[[^\]]*\]\]/g, "")     // wiki 链接
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 普通链接保留文字
      .replace(/[#>*\-_=`~]/g, "")       // markdown 符号
      .trim();

    const chineseChars = (cleaned.match(/[\u4e00-\u9fff]/g) || []).length;
    const englishWords = (cleaned.match(/[a-zA-Z]+/g) || []).length;

    return chineseChars + englishWords;
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async ensureFolder(p: string) {
    if (await this.app.vault.adapter.exists(p)) return;
    const parts = p.split("/").filter(Boolean);
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