import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  FILE_INDEX,
  DIR_WIKI,
  DIR_RAW,
  PAGE_TYPE_LABELS,
  PAGE_TYPE_DIRS,
} from "../../core/constants";
import { WikiPageMeta, PageType } from "../../core/types";
import { parseFrontmatter, nowISOString, pinyinSafeSort, normalizeText } from "../../core/utils";

export class IndexManager {
  private operationCount = 0;

  constructor(
    private app: App,
    private getBaseFolder: () => string,
    private getRebuildThreshold: () => number,
    private getBriefMaxLen: () => number,
  ) {}

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  async rebuild(): Promise<{ count: number; missing: number }> {
    const pages = await this.scanAllWikiPages();
    const indexContent = this.renderIndex(pages);
    await this.writeIndex(indexContent);
    this.operationCount = 0;

    const missing = pages.filter((p) => !p.brief).length;
    return { count: pages.length, missing };
  }

  async upsertEntry(meta: WikiPageMeta): Promise<void> {
    this.operationCount++;
    if (this.operationCount >= this.getRebuildThreshold()) {
      await this.rebuild();
      return;
    }
    await this.rebuild();
  }

  async readIndex(): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(this.path(FILE_INDEX));
    if (f instanceof TFile) return await this.app.vault.read(f);
    return "";
  }

  async getStatus(): Promise<{
    total: number;
    byType: Record<string, number>;
    missingBrief: number;
  }> {
    const pages = await this.scanAllWikiPages();
    const byType: Record<string, number> = {};
    let missingBrief = 0;
    for (const p of pages) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
      if (!p.brief) missingBrief++;
    }
    return { total: pages.length, byType, missingBrief };
  }

  async scanAllWikiPages(): Promise<WikiPageMeta[]> {
    const result: WikiPageMeta[] = [];
    const baseFolder = this.path(DIR_WIKI);
    const folder = this.app.vault.getAbstractFileByPath(baseFolder);
    if (!(folder instanceof TFolder)) return result;

    for (const [type, dir] of Object.entries(PAGE_TYPE_DIRS)) {
      const subFolder = this.app.vault.getAbstractFileByPath(this.path(dir));
      if (!(subFolder instanceof TFolder)) continue;

      for (const child of subFolder.children) {
        if (child instanceof TFile && child.extension === "md") {
          const meta = await this.parsePageMeta(child, type as PageType);
          if (meta) result.push(meta);
        }
      }
    }
    return result;
  }

  /**
   * v0.5 新增：扫描所有可被向量化的 Markdown 文件
   * 包含 wiki/ 全部 + 可选的 raw/
   */
  async scanAllIndexableFiles(includeRaw: boolean = true): Promise<TFile[]> {
    const result: TFile[] = [];

    // wiki/ 下所有 md
    const wikiFolder = this.app.vault.getAbstractFileByPath(this.path(DIR_WIKI));
    if (wikiFolder instanceof TFolder) {
      this.collectMdFiles(wikiFolder, result);
    }

    // raw/ 下所有 md（可选）
    if (includeRaw) {
      const rawFolder = this.app.vault.getAbstractFileByPath(this.path(DIR_RAW));
      if (rawFolder instanceof TFolder) {
        this.collectMdFiles(rawFolder, result);
      }
    }

    return result;
  }

  private collectMdFiles(folder: TFolder, out: TFile[]) {
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") {
        // 跳过 INDEX.md 自身
        if (child.path === this.path(FILE_INDEX)) continue;
        out.push(child);
      } else if (child instanceof TFolder) {
        this.collectMdFiles(child, out);
      }
    }
  }

  /**
   * v0.5 新增：判断文件类型（用于切片时分类）
   */
  classifyFile(file: TFile): PageType | "raw" {
    const path = file.path;
    if (path.includes(`/${DIR_RAW}/`)) return "raw";
    for (const [type, dir] of Object.entries(PAGE_TYPE_DIRS)) {
      if (path.includes(`/${dir}/`)) return type as PageType;
    }
    return "raw";
  }

  private async parsePageMeta(file: TFile, type: PageType): Promise<WikiPageMeta | null> {
    const content = await this.app.vault.read(file);
    const { frontmatter } = parseFrontmatter(content);

    const title = String(frontmatter.title ?? file.basename);
    const brief = String(frontmatter.brief ?? "");
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    const status = (frontmatter.status ?? "🌱seedling") as any;

    return {
      path: file.path,
      type,
      title,
      brief,
      tags,
      status,
    };
  }

  private renderIndex(pages: WikiPageMeta[]): string {
    const lines: string[] = [];

    lines.push("# Wiki Index");
    lines.push("");
    lines.push("> 本文件由 MindOS 自动维护，请勿手动编辑。");
    lines.push(`> 最后更新：${nowISOString()} | 总计：${pages.length} 个页面`);
    lines.push("");

    lines.push("## 📊 统计");
    const byType: Record<string, number> = {};
    pages.forEach((p) => { byType[p.type] = (byType[p.type] ?? 0) + 1; });
    for (const [type, label] of Object.entries(PAGE_TYPE_LABELS)) {
      lines.push(`- ${label}：${byType[type] ?? 0}`);
    }
    const missingBrief = pages.filter((p) => !p.brief).length;
    if (missingBrief > 0) {
      lines.push(`- ⚠️ 缺少简介：${missingBrief}`);
    }
    lines.push("");

    for (const [type, label] of Object.entries(PAGE_TYPE_LABELS)) {
      const groupPages = pages.filter((p) => p.type === type);
      if (groupPages.length === 0) continue;

      lines.push(`## ${label}页（${groupPages.length}）`);
      lines.push("");

      const taggedGroups = this.groupByTag(groupPages);

      const untagged = taggedGroups.get("__untagged__") ?? [];
      if (untagged.length > 0) {
        for (const p of untagged.sort((a, b) => pinyinSafeSort(a.title, b.title))) {
          lines.push(this.renderEntry(p));
        }
        lines.push("");
      }

      const tagKeys = Array.from(taggedGroups.keys())
        .filter((k) => k !== "__untagged__")
        .sort(pinyinSafeSort);

      for (const tag of tagKeys) {
        lines.push(`### #${tag}`);
        const tagPages = taggedGroups.get(tag) ?? [];
        for (const p of tagPages.sort((a, b) => pinyinSafeSort(a.title, b.title))) {
          lines.push(this.renderEntry(p));
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  private groupByTag(pages: WikiPageMeta[]): Map<string, WikiPageMeta[]> {
    const map = new Map<string, WikiPageMeta[]>();
    for (const p of pages) {
      const tags = (p.tags ?? []).filter((t) => t && t !== "mindos-collected" && t !== "ai-collected");
      if (tags.length === 0) {
        if (!map.has("__untagged__")) map.set("__untagged__", []);
        map.get("__untagged__")!.push(p);
      } else {
        const primaryTag = tags[0];
        if (!map.has(primaryTag)) map.set(primaryTag, []);
        map.get(primaryTag)!.push(p);
      }
    }
    return map;
  }

  private renderEntry(p: WikiPageMeta): string {
    const link = `[[${p.title}]]`;
    const brief = p.brief ? ` — ${p.brief}` : " — *（待补充）*";
    return `- ${link}${brief}`;
  }

  private async writeIndex(content: string): Promise<void> {
    const path = this.path(FILE_INDEX);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      await this.app.vault.modify(f, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  truncateBrief(text: string): string {
    const maxLen = this.getBriefMaxLen();
    const clean = normalizeText(text).replace(/\s+/g, " ");
    if (clean.length <= maxLen) return clean;
    return clean.substring(0, maxLen - 1) + "…";
  }
}