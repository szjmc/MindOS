import { App, normalizePath, TFile } from "obsidian";
import {
  WikiAction,
  AIPromptCollectorSettings,
  PromptPayload,
  ConversationRound,
} from "./types";
import { PAGE_TYPE_DIRS } from "./constants";
import {
  parseFrontmatter,
  buildFrontmatter,
  safeFileName,
  nowDateString,
  generateUID,
  truncateBrief,
} from "./utils";
import { IndexManager } from "./index-manager";

export class ActionExecutor {
  constructor(
    private app: App,
    private getSettings: () => AIPromptCollectorSettings,
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

  private async createNew(action: WikiAction, brief: string): Promise<void> {
    const s = this.getSettings();
    const uid = generateUID();

    const fm = buildFrontmatter({
      uid,
      title: action.title,
      type: action.pageType,
      brief,
      status: s.defaultMaturity,
      tags: ["ai-collected", ...action.tags.filter((t) => t)],
      created: nowDateString(),
      updated: nowDateString(),
    });

    const linksSection = action.links.length > 0
      ? `\n\n## 🔗 关联\n${action.links.map((l) => `- ${l}`).join("\n")}`
      : "";

    const content = `${fm}\n\n# ${action.title}\n\n> ${brief}\n\n${action.content}${linksSection}\n`;
    await this.app.vault.create(action.path, content);
  }

  private async appendToExisting(file: TFile, action: WikiAction): Promise<void> {
    const original = await this.app.vault.read(file);
    const { frontmatter, body } = parseFrontmatter(original);

    frontmatter.updated = nowDateString();
    const tags: string[] = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    for (const t of action.tags) {
      if (t && !tags.includes(t)) tags.push(t);
    }
    frontmatter.tags = tags;

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