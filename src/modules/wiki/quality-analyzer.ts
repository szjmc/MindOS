import { App, TFile, TFolder, LinkCache, CachedMetadata } from "obsidian";
import { MindOSSettings } from "../../core/types";
import type { NoteMetrics, QualityDimension, QualityReport, QualitySuggestion } from "../../core/types";
import { DIR_WIKI } from "../../core/constants";

const WIKI_LINK_REGEX = /\[\[([^\]|#]+)(?:[|#][^\]]+)?\]\]/g;
const IMAGE_LINK_REGEX = /!\[.*?\]\(.*?\)/g;
const CODE_BLOCK_REGEX = /```[\s\S]*?```|`[^`]+`/g;
const LIST_REGEX = /^[\s]*[-*+]\s|^[\s]*\d+\.\s/gm;
const QUOTE_REGEX = /^>\s/gm;
const TABLE_REGEX = /^\|.+\|$/gm;

export class QualityAnalyzer {
  private app: App;
  private getSettings: () => MindOSSettings;
  private _cachedReport: QualityReport | null = null;
  private _cacheTs: number = 0;
  private static CACHE_TTL_MS = 60_000; // 1 分钟内复用缓存

  constructor(app: App, getSettings: () => MindOSSettings) {
    this.app = app;
    this.getSettings = getSettings;
  }

  /** 强制清除缓存（修复后调用） */
  invalidateCache() {
    this._cachedReport = null;
    this._cacheTs = 0;
  }

  async analyze(forceRefresh = false): Promise<QualityReport> {
    const now = Date.now();
    if (!forceRefresh && this._cachedReport && now - this._cacheTs < QualityAnalyzer.CACHE_TTL_MS) {
      return this._cachedReport;
    }
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;

    // 优先使用中文路径（知识库），回退英文路径（wiki）
    const wikiFolder = this.resolveWikiFolder(baseFolder);
    if (!wikiFolder) {
      return this.emptyReport();
    }

    const folder = this.app.vault.getAbstractFileByPath(wikiFolder);
    if (!folder || !(folder as TFolder).children) {
      return this.emptyReport();
    }

    const files = this.collectMdFiles(folder as TFolder);
    if (files.length === 0) return this.emptyReport();

    const noteMetrics = await this.analyzeNotes(files, wikiFolder);
    const metrics = this.computeMetrics(noteMetrics);
    const suggestions = this.generateSuggestions(noteMetrics, metrics);
    const totalScore = this.calculateTotalScore(metrics);

    const report: QualityReport = {
      generatedAt: new Date().toISOString(),
      totalScore,
      level: this.getLevelLabel(totalScore),
      metrics,
      suggestions,
      analyzedNotes: noteMetrics.length,
      analyzedWords: noteMetrics.reduce((sum, m) => sum + m.wordCount, 0)
    };
    this._cachedReport = report;
    this._cacheTs = Date.now();
    return report;
  }

  async executeFix(suggestionId: string): Promise<{ success: boolean; message: string; fixedCount: number }> {
    // 优先使用缓存报告，避免重复全量扫描
    const report = await this.analyze();
    const suggestion = report.suggestions.find(s => s.id === suggestionId);
    
    if (!suggestion) {
      return { success: false, message: "找不到对应的优化建议", fixedCount: 0 };
    }

    if (!suggestion.actionable) {
      return { success: false, message: "该建议不可自动执行", fixedCount: 0 };
    }

    switch (suggestionId) {
      case "1":
        return await this.fixOrphanPages(suggestion.targetPaths);
      case "4":
        return await this.fixStructure(suggestion.targetPaths);
      default:
        return { success: false, message: "暂不支持该类型的自动修复", fixedCount: 0 };
    }
  }

  private async fixOrphanPages(targetPaths: string[]): Promise<{ success: boolean; message: string; fixedCount: number }> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    const wikiFolder = this.resolveWikiFolder(baseFolder) ?? `${baseFolder}/${DIR_WIKI}`;
    
    let fixedCount = 0;
    const folder = this.app.vault.getAbstractFileByPath(wikiFolder);
    if (!folder || !(folder as TFolder).children) {
      return { success: false, message: "无法访问 Wiki 文件夹", fixedCount: 0 };
    }

    const allFiles = this.collectMdFiles(folder as TFolder);
    const nonOrphanFiles = allFiles.filter(f => {
      const relativePath = f.path.replace(wikiFolder + "/", "");
      return !targetPaths.includes(relativePath);
    });

    if (nonOrphanFiles.length === 0) {
      return { success: false, message: "没有其他页面可添加链接", fixedCount: 0 };
    }

    for (const targetPath of targetPaths) {
      try {
        const fullPath = `${wikiFolder}/${targetPath}`;
        const file = this.app.vault.getAbstractFileByPath(fullPath);
        
        if (file instanceof TFile) {
          const linkName = targetPath.replace(/\.md$/, "");
          
          let added = false;
          for (const srcFile of nonOrphanFiles.slice(0, 3)) {
            try {
              const srcContent = await this.app.vault.read(srcFile);
              if (!srcContent.includes(`[[${linkName}`)) {
                const linkToAdd = `\n\n---\n## 相关页面\n- [[${linkName}]]\n`;
                const newContent = srcContent + linkToAdd;
                await this.app.vault.modify(srcFile, newContent);
                fixedCount++;
                added = true;
                break;
              }
            } catch (e) {
              continue;
            }
          }
          
          if (!added && nonOrphanFiles.length > 0) {
            const srcContent = await this.app.vault.read(nonOrphanFiles[0]);
            const linkToAdd = `\n\n---\n## 相关页面\n- [[${linkName}]]\n`;
            const newContent = srcContent + linkToAdd;
            await this.app.vault.modify(nonOrphanFiles[0], newContent);
            fixedCount++;
          }
        }
      } catch (error) {
        console.error(`修复页面 ${targetPath} 失败:`, error);
      }
    }

    if (fixedCount > 0) this.invalidateCache();
    return { 
      success: fixedCount > 0, 
      message: `成功为 ${fixedCount} 个页面添加了反向链接`, 
      fixedCount 
    };
  }

  private async fixStructure(targetPaths: string[]): Promise<{ success: boolean; message: string; fixedCount: number }> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    const wikiFolder = this.resolveWikiFolder(baseFolder) ?? `${baseFolder}/${DIR_WIKI}`;
    
    let fixedCount = 0;

    for (const targetPath of targetPaths) {
      try {
        const fullPath = `${wikiFolder}/${targetPath}`;
        const file = this.app.vault.getAbstractFileByPath(fullPath);
        
        if (file instanceof TFile) {
          const content = await this.app.vault.read(file);
          const lines = content.split("\n");
          
          const hasHeading = lines.some(line => line.startsWith("#"));
          
          if (!hasHeading && lines.length > 0) {
            const title = targetPath.replace(/\.md$/, "").replace(/-/g, " ").replace(/_/g, " ");
            
            let newContent = `# ${title}\n\n${content}`;
            
            await this.app.vault.modify(file, newContent);
            fixedCount++;
          }
        }
      } catch (error) {
        console.error(`修复结构 ${targetPath} 失败:`, error);
      }
    }

    if (fixedCount > 0) this.invalidateCache();
    return { 
      success: fixedCount > 0, 
      message: `成功为 ${fixedCount} 个页面添加了标题结构`, 
      fixedCount 
    };
  }

  /**
   * 解析知识库文件夹路径：
   * 优先中文路径（知识库），回退英文路径（wiki），再回退 baseFolder 本身
   */
  private resolveWikiFolder(baseFolder: string): string | null {
    const candidates = [
      `${baseFolder}/${DIR_WIKI}`,  // "AI Prompts/知识库"
      `${baseFolder}/wiki`,          // 旧版英文路径
      baseFolder,                    // 最终回退
    ];
    for (const candidate of candidates) {
      const f = this.app.vault.getAbstractFileByPath(candidate);
      if (f instanceof TFolder && (f as TFolder).children.length > 0) {
        return candidate;
      }
    }
    return null;
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

  private async analyzeNotes(files: TFile[], wikiFolder: string): Promise<NoteMetrics[]> {
    const metricsList: NoteMetrics[] = [];
    const incomingLinksMap = new Map<string, number>();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const relativePath = file.path.replace(wikiFolder + "/", "");
      const links = this.extractLinks(content);
      const headings = this.extractHeadings(file);
      const mediaCount = (content.match(IMAGE_LINK_REGEX) || []).length;
      const codeBlockCount = (content.match(CODE_BLOCK_REGEX) || []).length;
      const listCount = (content.match(LIST_REGEX) || []).length;
      const quoteCount = (content.match(QUOTE_REGEX) || []).length;
      const tableCount = (content.match(TABLE_REGEX) || []).length;

      metricsList.push({
        path: relativePath,
        title: file.basename,
        wordCount: this.wordCount(content),
        lastModified: new Date(file.stat.mtime),
        headings,
        outgoingLinks: links.length,
        incomingLinks: 0,
        mediaCount,
        codeBlockCount,
        listCount,
        quoteCount,
        tableCount
      });

      for (const link of links) {
        const count = incomingLinksMap.get(link) || 0;
        incomingLinksMap.set(link, count + 1);
      }
    }

    for (const metric of metricsList) {
      const key = metric.path.replace(/\.md$/, "");
      metric.incomingLinks = incomingLinksMap.get(key) || 0;
    }

    return metricsList;
  }

  private extractLinks(content: string): string[] {
    const links: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK_REGEX.exec(content)) !== null) {
      links.push(match[1]);
    }
    return [...new Set(links)];
  }

  private extractHeadings(file: TFile): { level: number; text: string }[] {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache?.headings) return [];
    
    return cache.headings.map(h => ({
      level: h.level,
      text: h.heading
    }));
  }

  private wordCount(content: string): number {
    const cleaned = content
      .replace(/#+\s/g, " ")
      .replace(/[*`[\]()>_-]/g, " ")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[\[.*?\]\]/g, "")
      .replace(/---[\s\S]*?---/g, "");
    return cleaned.trim().split(/\s+/).filter((w) => w.length > 1).length;
  }

  private computeMetrics(notes: NoteMetrics[]): QualityDimension[] {
    if (notes.length === 0) {
      return [
        this.createDimension("结构完整性", 0, 100, "待补充"),
        this.createDimension("关联度", 0, 100, "待补充"),
        this.createDimension("更新活跃度", 0, 100, "待补充"),
        this.createDimension("信息密度", 0, 100, "待补充")
      ];
    }

    const structureScore = this.calculateStructureScore(notes);
    const linkScore = this.calculateLinkScore(notes);
    const freshnessScore = this.calculateFreshnessScore(notes);
    const densityScore = this.calculateDensityScore(notes);

    return [
      {
        name: "结构完整性",
        value: structureScore.value,
        maxValue: 100,
        score: structureScore.score,
        label: structureScore.label,
        level: structureScore.level
      },
      {
        name: "关联度",
        value: linkScore.value,
        maxValue: 100,
        score: linkScore.score,
        label: linkScore.label,
        level: linkScore.level
      },
      {
        name: "更新活跃度",
        value: freshnessScore.value,
        maxValue: 100,
        score: freshnessScore.score,
        label: freshnessScore.label,
        level: freshnessScore.level
      },
      {
        name: "信息密度",
        value: densityScore.value,
        maxValue: 100,
        score: densityScore.score,
        label: densityScore.label,
        level: densityScore.level
      }
    ];
  }

  private calculateStructureScore(notes: NoteMetrics[]): { value: number; score: number; label: string; level: QualityDimension['level'] } {
    let totalScore = 0;
    for (const note of notes) {
      let score = 0;
      if (note.headings.length >= 2) score += 25;
      if (note.listCount > 0) score += 20;
      if (note.codeBlockCount > 0) score += 20;
      if (note.mediaCount > 0) score += 15;
      if (note.tableCount > 0) score += 10;
      if (note.quoteCount > 0) score += 10;
      totalScore += score;
    }
    const avgScore = Math.round(totalScore / notes.length);
    return {
      value: avgScore,
      score: avgScore,
      label: this.getScoreLabel(avgScore),
      level: this.getScoreLevel(avgScore)
    };
  }

  private calculateLinkScore(notes: NoteMetrics[]): { value: number; score: number; label: string; level: QualityDimension['level'] } {
    const orphanNotes = notes.filter(n => n.incomingLinks === 0 && n.outgoingLinks === 0).length;
    const orphanRatio = orphanNotes / notes.length;
    
    let totalLinkScore = 0;
    for (const note of notes) {
      let score = 0;
      if (note.incomingLinks >= 6) score += 80;
      else if (note.incomingLinks >= 3) score += 60;
      else if (note.incomingLinks >= 1) score += 30;
      
      if (note.outgoingLinks >= 5) score += 20;
      else if (note.outgoingLinks >= 2) score += 10;
      
      score -= orphanRatio * 30;
      totalLinkScore += Math.max(0, Math.min(100, score));
    }
    
    const avgScore = Math.round(totalLinkScore / notes.length);
    return {
      value: avgScore,
      score: avgScore,
      label: this.getScoreLabel(avgScore),
      level: this.getScoreLevel(avgScore)
    };
  }

  private calculateFreshnessScore(notes: NoteMetrics[]): { value: number; score: number; label: string; level: QualityDimension['level'] } {
    const now = Date.now();
    let totalScore = 0;
    
    for (const note of notes) {
      const ageDays = (now - note.lastModified.getTime()) / (1000 * 60 * 60 * 24);
      let score = 0;
      
      if (ageDays <= 7) score = 100;
      else if (ageDays <= 30) score = 80;
      else if (ageDays <= 90) score = 60;
      else if (ageDays <= 180) score = 40;
      else if (ageDays <= 365) score = 20;
      else score = 0;
      
      totalScore += score;
    }
    
    const avgScore = Math.round(totalScore / notes.length);
    return {
      value: avgScore,
      score: avgScore,
      label: this.getScoreLabel(avgScore),
      level: this.getScoreLevel(avgScore)
    };
  }

  private calculateDensityScore(notes: NoteMetrics[]): { value: number; score: number; label: string; level: QualityDimension['level'] } {
    let totalScore = 0;
    
    for (const note of notes) {
      let score = 0;
      const wc = note.wordCount;
      
      if (wc >= 3000 && wc <= 8000) score = 100;
      else if (wc >= 1000 && wc < 3000) score = 80;
      else if (wc > 8000) score = 90;
      else if (wc >= 500 && wc < 1000) score = 50;
      else if (wc > 0) score = 30;
      else score = 0;
      
      totalScore += score;
    }
    
    const avgScore = Math.round(totalScore / notes.length);
    return {
      value: avgScore,
      score: avgScore,
      label: this.getScoreLabel(avgScore),
      level: this.getScoreLevel(avgScore)
    };
  }

  private getScoreLabel(score: number): string {
    if (score >= 80) return "优秀";
    if (score >= 60) return "良好";
    if (score >= 40) return "需优化";
    return "待补充";
  }

  private getScoreLevel(score: number): QualityDimension['level'] {
    if (score >= 80) return "excellent";
    if (score >= 60) return "good";
    if (score >= 40) return "needs-improvement";
    return "to-add";
  }

  private getLevelLabel(score: number): string {
    if (score >= 80) return "优秀";
    if (score >= 60) return "良好";
    if (score >= 40) return "需优化";
    return "待补充";
  }

  private calculateTotalScore(metrics: QualityDimension[]): number {
    if (metrics.length === 0) return 0;
    const sum = metrics.reduce((acc, m) => acc + m.score, 0);
    return Math.round(sum / metrics.length);
  }

  private generateSuggestions(notes: NoteMetrics[], metrics: QualityDimension[]): QualitySuggestion[] {
    const suggestions: QualitySuggestion[] = [];

    const orphanNotes = notes.filter(n => n.incomingLinks === 0 && n.outgoingLinks === 0);
    if (orphanNotes.length > 0) {
      suggestions.push({
        id: "1",
        priority: "high",
        title: "补充反向链接",
        description: `发现有 ${orphanNotes.length} 个孤立页面，建议添加内部链接以提升关联度`,
        actionable: true,
        targetPaths: orphanNotes.map(n => n.path),
        estimatedImpact: "预计提升关联度评分 10-20 分"
      });
    }

    const staleNotes = notes.filter(n => {
      const ageDays = (Date.now() - n.lastModified.getTime()) / (1000 * 60 * 60 * 24);
      return ageDays > 180;
    });
    if (staleNotes.length > 0) {
      suggestions.push({
        id: "2",
        priority: "medium",
        title: "更新过时内容",
        description: `有 ${staleNotes.length} 个页面超过 6 个月未更新，建议检查并更新内容`,
        actionable: false,
        targetPaths: staleNotes.map(n => n.path),
        estimatedImpact: "预计提升更新活跃度评分 15-25 分"
      });
    }

    const shortNotes = notes.filter(n => n.wordCount < 500);
    if (shortNotes.length > 0) {
      suggestions.push({
        id: "3",
        priority: "medium",
        title: "扩充内容过少的页面",
        description: `有 ${shortNotes.length} 个页面内容过少（少于500字），建议补充详细内容`,
        actionable: false,
        targetPaths: shortNotes.map(n => n.path),
        estimatedImpact: "预计提升信息密度评分 10-15 分"
      });
    }

    const noStructureNotes = notes.filter(n => n.headings.length === 0);
    if (noStructureNotes.length > 0) {
      suggestions.push({
        id: "4",
        priority: "low",
        title: "完善页面结构",
        description: `有 ${noStructureNotes.length} 个页面缺少标题层级，建议添加多级标题以提升结构完整性`,
        actionable: true,
        targetPaths: noStructureNotes.map(n => n.path),
        estimatedImpact: "预计提升结构完整性评分 8-12 分"
      });
    }

    const noCodeNotes = notes.filter(n => n.codeBlockCount === 0);
    if (noCodeNotes.length > notes.length * 0.7) {
      suggestions.push({
        id: "5",
        priority: "low",
        title: "添加代码示例",
        description: `大部分页面缺少代码块，建议为技术内容添加代码示例以提升可读性`,
        actionable: false,
        targetPaths: [],
        estimatedImpact: "预计提升结构完整性评分 5-10 分"
      });
    }

    return suggestions;
  }

  private createDimension(name: string, value: number, maxValue: number, label: string): QualityDimension {
    return {
      name,
      value,
      maxValue,
      score: value,
      label,
      level: this.getScoreLevel(value)
    };
  }

  private emptyReport(): QualityReport {
    return {
      generatedAt: new Date().toISOString(),
      totalScore: 0,
      level: "待补充",
      metrics: [
        this.createDimension("结构完整性", 0, 100, "待补充"),
        this.createDimension("关联度", 0, 100, "待补充"),
        this.createDimension("更新活跃度", 0, 100, "待补充"),
        this.createDimension("信息密度", 0, 100, "待补充")
      ],
      suggestions: [
        {
          id: "0",
          priority: "high",
          title: "开始创建笔记",
          description: "知识库为空，开始创建你的第一个 Wiki 页面吧！",
          actionable: false,
          targetPaths: [],
          estimatedImpact: "创建页面后系统将自动分析知识质量"
        }
      ],
      analyzedNotes: 0,
      analyzedWords: 0
    };
  }
}
