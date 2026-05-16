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
    const content = `${fm}

# ${fmData.cover} ${action.title}

> [!abstract] 简介
> ${brief}${action.summary && action.summary !== brief ? `\n> \n> ${action.summary}` : ""}

${action.content}${linksSection}
`;

    await this.app.vault.create(action.path, content);
  }

  // ════════════════════════════════════════════════════════════
  // 追加到已有文件 - v0.6.4 同步更新 frontmatter
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
    if (this.app.vault.getAbstractFileByPath(p)) return;
    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}