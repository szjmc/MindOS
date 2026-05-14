import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  FILE_INDEX,
  DIR_WIKI,
  PAGE_TYPE_LABELS,
  PAGE_TYPE_DIRS,
} from "./constants";
import { WikiPageMeta, PageType } from "./types";
import { parseFrontmatter, nowISOString, pinyinSafeSort, normalizeText } from "./utils";

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

  /** 完整重建 INDEX.md */
  async rebuild(): Promise<{ count: number; missing: number }> {
    const pages = await this.scanAllWikiPages();
    const indexContent = this.renderIndex(pages);
    await this.writeIndex(indexContent);
    this.operationCount = 0;

    const missing = pages.filter((p) => !p.brief).length;
    return { count: pages.length, missing };
  }

  /** 增量更新单个条目 */
  async upsertEntry(meta: WikiPageMeta): Promise<void> {
    this.operationCount++;
    if (this.operationCount >= this.getRebuildThreshold()) {
      await this.rebuild();
      return;
    }
    // 简化实现：增量也走重建（保证一致性）
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

  /** 扫描 wiki/ 下所有页面 */
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

  /** 渲染 INDEX.md（D 方案：类型分组 + 标签二级分组） */
  private renderIndex(pages: WikiPageMeta[]): string {
    const lines: string[] = [];

    // 头部
    lines.push("# Wiki Index");
    lines.push("");
    lines.push("> 本文件由插件自动维护，请勿手动编辑。");
    lines.push(`> 最后更新：${nowISOString()} | 总计：${pages.length} 个页面`);
    lines.push("");

    // 统计
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

    // 按类型分组
    for (const [type, label] of Object.entries(PAGE_TYPE_LABELS)) {
      const groupPages = pages.filter((p) => p.type === type);
      if (groupPages.length === 0) continue;

      lines.push(`## ${label}页（${groupPages.length}）`);
      lines.push("");

      // 二级：按标签分组
      const taggedGroups = this.groupByTag(groupPages);

      // 先输出无标签的（可能是 #其他）
      const untagged = taggedGroups.get("__untagged__") ?? [];
      if (untagged.length > 0) {
        for (const p of untagged.sort((a, b) => pinyinSafeSort(a.title, b.title))) {
          lines.push(this.renderEntry(p));
        }
        lines.push("");
      }

      // 输出有标签的
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
      const tags = (p.tags ?? []).filter((t) => t && t !== "ai-collected");
      if (tags.length === 0) {
        if (!map.has("__untagged__")) map.set("__untagged__", []);
        map.get("__untagged__")!.push(p);
      } else {
        // 同一页面可能出现在多个标签组下；我们只用第一个有效标签
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

  /** 截断 brief 到指定长度 */
  truncateBrief(text: string): string {
    const maxLen = this.getBriefMaxLen();
    const clean = normalizeText(text).replace(/\s+/g, " ");
    if (clean.length <= maxLen) return clean;
    return clean.substring(0, maxLen - 1) + "…";
  }
}