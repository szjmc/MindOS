import { App, TFile, TFolder } from "obsidian";
import { MindOSSettings, HealthMetrics, HealthReport } from "../../core/types";

const LINK_REGEX = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;

export class HealthReportGenerator {
  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
  ) {}

  async generate(): Promise<HealthReport> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    const wikiFolder = `${baseFolder}/wiki`;

    const folder = this.app.vault.getAbstractFileByPath(wikiFolder);
    if (!folder || !(folder as TFolder).children) {
      return this.emptyReport();
    }

    const files = this.collectMdFiles(folder as TFolder);
    if (files.length === 0) return this.emptyReport();

    const metrics = await this.computeMetrics(files, wikiFolder);
    const score = this.calcScore(metrics);
    const recommendations = this.generateRecommendations(metrics, score);

    return {
      generatedAt: new Date().toISOString(),
      metrics,
      healthScore: score,
      recommendations,
    };
  }

  private collectMdFiles(folder: TFolder): TFile[] {
    const result: TFile[] = [];
    for (const child of (folder as any).children || []) {
      if (child instanceof TFile && child.extension === "md") {
        result.push(child);
      } else if (child instanceof TFolder) {
        result.push(...this.collectMdFiles(child));
      }
    }
    return result;
  }

  private async computeMetrics(files: TFile[], wikiFolder: string): Promise<HealthMetrics> {
    const pageMetaList: { path: string; content: string; wordCount: number; links: string[]; maturity: string }[] = [];
    const incomingCount = new Map<string, number>();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const wordCount = this.wordCount(content);
      const links = this.extractLinks(content, wikiFolder);
      const maturity = this.extractMaturity(content);

      const relativePath = file.path.replace(wikiFolder + "/", "");
      pageMetaList.push({ path: relativePath, content, wordCount, links, maturity });
    }

    // Count incoming links
    for (const page of pageMetaList) {
      for (const target of page.links) {
        incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
      }
    }

    // Compute metrics
    const totalPages = pageMetaList.length;
    const totalWords = pageMetaList.reduce((s, p) => s + p.wordCount, 0);
    const averageWordCount = Math.round(totalWords / totalPages);
    const totalLinks = pageMetaList.reduce((s, p) => s + p.links.length, 0);
    const averageLinksPerPage = +(totalLinks / totalPages).toFixed(1);

    const orphanPages = pageMetaList.filter(
      (p) => !incomingCount.has(p.path.replace(/\.md$/, "")),
    ).length;

    const stubPages = pageMetaList.filter((p) => p.wordCount < 50).length;

    const maturityDistribution: Record<string, number> = {};
    for (const page of pageMetaList) {
      maturityDistribution[page.maturity] = (maturityDistribution[page.maturity] || 0) + 1;
    }

    const freshnessDistribution = this.computeFreshness(files);

    const topLinkedPages = Array.from(incomingCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([path, links]) => ({ path: `${path}.md`, links }));

    return {
      totalPages,
      totalWords,
      orphanPages,
      stubPages,
      averageWordCount,
      averageLinksPerPage,
      maturityDistribution,
      freshnessDistribution,
      topLinkedPages,
    };
  }

  private computeFreshness(
    files: TFile[],
  ): { recent: number; moderate: number; stale: number } {
    const now = Date.now();
    let recent = 0, moderate = 0, stale = 0;

    for (const file of files) {
      const ageDays = (now - file.stat.mtime) / (1000 * 60 * 60 * 24);
      if (ageDays <= 30) recent++;
      else if (ageDays <= 180) moderate++;
      else stale++;
    }

    return { recent, moderate, stale };
  }

  private wordCount(content: string): number {
    const cleaned = content
      .replace(/#+\s/g, " ")
      .replace(/[*`[\]()>_-]/g, " ")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[\[.*?\]\]/g, "")
      .replace(/---[\s\S]*?---/g, ""); // remove frontmatter
    return cleaned.trim().split(/\s+/).filter((w) => w.length > 1).length;
  }

  private extractLinks(content: string, wikiFolder: string): string[] {
    const links: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = LINK_REGEX.exec(content)) !== null) {
      links.push(match[1]);
    }
    return [...new Set(links)];
  }

  private extractMaturity(content: string): string {
    const match = content.match(/maturity:\s*["']?([^"'\n\r]+)/i);
    if (match) return match[1].trim();
    // Detect from frontmatter
    const fm = content.match(/---\n([\s\S]*?)\n---/);
    if (fm) {
      const m = fm[1].match(/maturity:\s*([^\n\r]+)/i);
      if (m) return m[1].trim();
    }
    return "🌱 seedling";
  }

  private calcScore(metrics: HealthMetrics): number {
    let score = 100;

    // Orphan penalty
    if (metrics.totalPages > 0) {
      const orphanRatio = metrics.orphanPages / metrics.totalPages;
      score -= Math.round(orphanRatio * 30);
    }

    // Stub penalty
    if (metrics.totalPages > 0) {
      const stubRatio = metrics.stubPages / metrics.totalPages;
      score -= Math.round(stubRatio * 25);
    }

    // Freshness penalty
    if (metrics.totalPages > 0) {
      const staleRatio = metrics.freshnessDistribution.stale / metrics.totalPages;
      score -= Math.round(staleRatio * 15);
    }

    // Link bonus
    if (metrics.averageLinksPerPage >= 3) score += 5;
    if (metrics.averageLinksPerPage >= 10) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  private generateRecommendations(metrics: HealthMetrics, score: number): string[] {
    const recs: string[] = [];

    if (metrics.totalPages === 0) {
      recs.push("📝 开始创建你的第一个 Wiki 页面吧！");
      return recs;
    }

    if (score >= 80) {
      recs.push("✅ 知识库整体健康，继续保持！");
    } else if (score >= 60) {
      recs.push("🟡 知识库状态尚可，有以下改进空间：");
    } else {
      recs.push("🔴 知识库需要关注，建议优先处理以下问题：");
    }

    if (metrics.orphanPages > 0) {
      const pct = Math.round((metrics.orphanPages / metrics.totalPages) * 100);
      recs.push(`🔗 有 ${metrics.orphanPages} 个孤立页面 (${pct}%)，建议添加内部链接。`);
    }

    if (metrics.stubPages > 0) {
      const pct = Math.round((metrics.stubPages / metrics.totalPages) * 100);
      recs.push(`📄 有 ${metrics.stubPages} 个内容过短的页面 (${pct}%)，建议扩充内容。`);
    }

    if (metrics.freshnessDistribution.stale > 0) {
      recs.push(
        `⏰ 有 ${metrics.freshnessDistribution.stale} 个页面超过 6 个月未更新，建议检查是否需要修订。`,
      );
    }

    if (metrics.averageLinksPerPage < 1) {
      recs.push("🔗 平均链接数过低，知识关联度不足。");
    }

    if (metrics.topLinkedPages.length > 0) {
      recs.push(
        `📌 最热门页面：${metrics.topLinkedPages.slice(0, 3).map((p) => p.path).join("、")}`,
      );
    }

    if (recs.length === 1) {
      recs.push("✨ 知识库状态良好，暂无急需改进的项目。");
    }

    return recs;
  }

  private emptyReport(): HealthReport {
    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        totalPages: 0,
        totalWords: 0,
        orphanPages: 0,
        stubPages: 0,
        averageWordCount: 0,
        averageLinksPerPage: 0,
        maturityDistribution: {},
        freshnessDistribution: { recent: 0, moderate: 0, stale: 0 },
        topLinkedPages: [],
      },
      healthScore: 0,
      recommendations: ["📝 知识库为空，开始创建你的第一个 Wiki 页面吧！"],
    };
  }
}
