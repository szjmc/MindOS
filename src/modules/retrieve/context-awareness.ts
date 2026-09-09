import { App, TFile, Notice } from "obsidian";
import { MindOSSettings } from "../../core/types";
import { SemanticSearch } from "../retrieve/semantic-search";
import { isWikiContentFile, isSystemFile } from "../../core/utils";

export interface Recommendation {
  file: TFile;
  score: number;
  matchType: 'semantic' | 'tag' | 'link' | 'history';
  matchReason: string;
  preview: string;
  category: string;
}

export interface RelatedPage {
  file: TFile;
  matchType: 'semantic' | 'tag' | 'link' | 'history';
  matchReason: string;
  preview: string;
}

export interface SuggestionResult {
  orphanPages: TFile[];
  outdatedPages: TFile[];
  relatedReading: RelatedPage[];
}

export interface ContextAnalysis {
  title: string;
  content: string;
  tags: string[];
  links: string[];
  summary: string;
  editTime: number;
}

export class ContextAwarenessService {
  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private semanticSearch: SemanticSearch,
  ) {}

  async analyzeCurrentFile(): Promise<ContextAnalysis | null> {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return null;

    try {
      const content = await this.app.vault.read(activeFile);
      return this.parseFileContent(activeFile, content);
    } catch (error) {
      console.error("分析当前文件失败:", error);
      return null;
    }
  }

  private parseFileContent(file: TFile, content: string): ContextAnalysis {
    const title = file.basename;

    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push(match[1]);
    }

    const tagRegex = /#([a-zA-Z0-9_-]+)/g;
    const tags: string[] = [];
    while ((match = tagRegex.exec(content)) !== null) {
      tags.push(match[1]);
    }

    const cleanContent = content
      .replace(/^---[\s\S]*?---/m, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/#[^\s]*/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .trim();

    const summary = cleanContent.substring(0, 200).replace(/\s+/g, ' ').trim();

    return {
      title,
      content: cleanContent,
      tags,
      links,
      summary,
      editTime: file.stat.mtime,
    };
  }

  async generateRecommendations(maxResults: number = 10): Promise<Recommendation[]> {
    const analysis = await this.analyzeCurrentFile();
    if (!analysis) return [];

    const settings = this.getSettings();

    const recommendations: Recommendation[] = [];
    const seenFiles = new Set<string>();
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      seenFiles.add(activeFile.path);
    }

    // 集中式文件过滤：知识库内容文件，排除系统文件（CLAUDE.md, AGENTS.md, INDEX.md 等）
    const allWikiFiles = this.app.vault.getMarkdownFiles().filter(f => {
      if (seenFiles.has(f.path)) return false;
      return isWikiContentFile(f, settings.baseFolder);
    });

    const tagScoreMap = new Map<string, number>();
    for (const file of allWikiFiles) {
      let score = 0;
      let reasons: string[] = [];
      let matchType: Recommendation['matchType'] = 'semantic';

      try {
        const content = await this.app.vault.read(file);

        for (const tag of analysis.tags) {
          if (content.includes(`#${tag}`)) {
            score += 0.2;
            reasons.push(`共享标签 #${tag}`);
            matchType = 'tag';
          }
        }

        for (const link of analysis.links) {
          if (content.includes(`[[${link}]]`) || file.basename === link) {
            score += 0.3;
            reasons.push(`关联链接 ${link}`);
            matchType = 'link';
          }
        }
      } catch {
        // ignore
      }

      if (score > 0) {
        seenFiles.add(file.path);
        const safeScore = Math.min(Math.max(score, 0), 0.95);
        recommendations.push({
          file,
          score: safeScore,
          matchType,
          matchReason: reasons.join('、'),
          preview: await this.getFilePreview(file),
          category: this.getCategory(file.path),
        });
      }
    }

    if (this.semanticSearch && analysis.summary) {
      try {
        const semanticResults = await this.semanticSearch.search(analysis.summary, { topK: maxResults * 2 });
        for (const result of semanticResults) {
          const file = this.app.vault.getAbstractFileByPath(result.path);
          if (file instanceof TFile && !seenFiles.has(file.path) && !isSystemFile(file)) {
            seenFiles.add(file.path);
            const resultScore = Number.isFinite(result.topScore) ? result.topScore : 0.5;
            recommendations.push({
              file,
              score: Math.min(Math.max(resultScore * 0.8 + 0.1, 0), 0.95),
              matchType: 'semantic',
              matchReason: '语义相似度匹配',
              preview: result.bestPreview,
              category: this.getCategory(file.path),
            });
          }
        }
      } catch (error) {
        console.warn("语义搜索失败:", error);
      }
    }

    recommendations.sort((a, b) => b.score - a.score);
    return recommendations.slice(0, maxResults);
  }

  /**
   * 生成情境感知建议（View 层入口）：
   * 相关阅读 + 孤岛页面 + 久未更新页面
   */
  async generateSuggestions(): Promise<SuggestionResult> {
    const [orphanPages, outdatedPages, recommendations] = await Promise.all([
      this.findOrphanPages(10),
      this.findOutdatedPages(10),
      this.generateRecommendations(6),
    ]);
    return {
      orphanPages,
      outdatedPages,
      relatedReading: recommendations.map((r) => ({
        file: r.file,
        matchType: r.matchType,
        matchReason: r.matchReason,
        preview: r.preview,
      })),
    };
  }

  /** 孤岛页面：没有被任何其他笔记链接的知识库页面 */
  private async findOrphanPages(limit: number): Promise<TFile[]> {
    const settings = this.getSettings();
    const wikiFiles = this.app.vault.getMarkdownFiles()
      .filter((f) => isWikiContentFile(f, settings.baseFolder) && !isSystemFile(f));
    if (wikiFiles.length === 0) return [];

    // 一次性收集所有文件内容用于链接匹配（限制规模，避免大库卡顿）
    const candidates = wikiFiles.slice(0, 500);
    const contents = new Map<string, string>();
    for (const f of candidates) {
      try {
        contents.set(f.path, await this.app.vault.cachedRead(f));
      } catch { /* ignore */ }
    }

    const orphans: TFile[] = [];
    for (const file of candidates) {
      const name = file.basename;
      const linked = candidates.some((other) => {
        if (other.path === file.path) return false;
        const content = contents.get(other.path) || "";
        return content.includes(`[[${name}`) || content.includes(`[[${file.path.replace(/\.md$/, "")}`);
      });
      if (!linked) {
        orphans.push(file);
        if (orphans.length >= limit) break;
      }
    }
    return orphans;
  }

  /** 久未更新：超过 6 个月未修改的知识库页面 */
  private findOutdatedPages(limit: number): TFile[] {
    const settings = this.getSettings();
    const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;
    return this.app.vault.getMarkdownFiles()
      .filter((f) => isWikiContentFile(f, settings.baseFolder)
        && !isSystemFile(f)
        && f.stat.mtime < sixMonthsAgo)
      .sort((a, b) => a.stat.mtime - b.stat.mtime)
      .slice(0, limit);
  }

  private getCategory(path: string): string {
    if (path.includes('/知识库/')) {
      const parts = path.split('/');
      const wikiIndex = parts.indexOf('知识库');
      if (wikiIndex >= 0 && wikiIndex + 1 < parts.length) {
        return parts[wikiIndex + 1];
      }
    }
    if (path.includes('/wiki/')) {
      const parts = path.split('/');
      const wikiIndex = parts.indexOf('wiki');
      if (wikiIndex >= 0 && wikiIndex + 1 < parts.length) {
        return parts[wikiIndex + 1];
      }
    }
    return '知识库';
  }

  private async getFilePreview(file: TFile): Promise<string> {
    try {
      const content = await this.app.vault.read(file);
      const cleanContent = content
        .replace(/^---[\s\S]*?---/m, '')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/#[^\s]*/g, '')
        .trim();

      const lines = cleanContent.split('\n').filter(line => line.trim());
      const previewLines = lines.slice(0, 2);
      return previewLines.join(' ').substring(0, 120).replace(/\s+/g, ' ').trim() + '...';
    } catch {
      return '';
    }
  }
}
