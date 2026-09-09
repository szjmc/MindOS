import { App, TFile } from 'obsidian';
import { MindOSSettings, ExplicitBacklink, ImplicitBacklink } from '../../../core/types';
import { DEFAULT_BACKLINK_IMPLICIT_THRESHOLD, BACKLINK_CONTEXT_LENGTH } from '../constants';
import { isWikiContentFile, isSystemFile } from '../../../core/utils';

const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;

export class BacklinkAnalyzer {
  private app: App;
  private getSettings: () => MindOSSettings;

  constructor(app: App, getSettings: () => MindOSSettings) {
    this.app = app;
    this.getSettings = getSettings;
  }

  async scanExplicitBacklinks(targetPath: string): Promise<ExplicitBacklink[]> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    
    // 集中式过滤：Wiki 内容文件，排除系统文件
    const files = this.app.vault.getMarkdownFiles().filter(f => 
      f.path !== targetPath && isWikiContentFile(f, baseFolder)
    );

    const backlinks: ExplicitBacklink[] = [];
    const targetTitle = this.extractPageTitle(targetPath);

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        let match: RegExpExecArray | null;
        while ((match = WIKILINK_REGEX.exec(content)) !== null) {
          const linkTarget = match[1];
          if (this.isMatchingPage(linkTarget, targetPath, targetTitle)) {
            const context = this.extractContext(content, match.index, match[0].length);
            backlinks.push({
              sourcePath: file.path,
              targetPath: targetPath,
              context,
              anchorPosition: match.index,
            });
          }
        }
      } catch (e) {
        console.error(`[MindOS] Error scanning ${file.path}:`, e);
      }
    }

    return backlinks.sort((a, b) => {
      const aFile = this.app.vault.getAbstractFileByPath(a.sourcePath);
      const bFile = this.app.vault.getAbstractFileByPath(b.sourcePath);
      if (!aFile) return 1;
      if (!bFile) return -1;
      return (bFile as TFile).stat.mtime - (aFile as TFile).stat.mtime;
    });
  }

  async scanImplicitBacklinks(targetPath: string, vectorStore: any): Promise<ImplicitBacklink[]> {
    const settings = this.getSettings();
    const threshold = settings.backlinkImplicitThreshold ?? DEFAULT_BACKLINK_IMPLICIT_THRESHOLD;
    const baseFolder = settings.baseFolder;

    const targetChunks = await vectorStore.getChunksByPath(targetPath);
    if (targetChunks.length === 0) return [];

    const targetVector = targetChunks[0].vector;
    const results = await vectorStore.search(targetVector, 20, threshold);

    const seenPaths = new Set<string>();
    const implicitBacklinks: ImplicitBacklink[] = [];

    for (const result of results) {
      const sourcePath = result.chunk.path;
      if (sourcePath === targetPath) continue;
      // 集中式过滤：排除系统文件和非 Wiki 内容
      const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile) || isSystemFile(sourceFile)) continue;
      if (!(sourcePath.includes('知识库') || sourcePath.includes('wiki') || sourcePath.startsWith(baseFolder))) continue;
      if (seenPaths.has(sourcePath)) continue;

      seenPaths.add(sourcePath);
      const reason = this.generateImplicitReason(result.score);
      implicitBacklinks.push({
        sourcePath,
        targetPath,
        similarityScore: result.score,
        reason,
        isIgnored: false,
      });
    }

    return implicitBacklinks;
  }

  private extractPageTitle(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
  }

  private isMatchingPage(linkTarget: string, targetPath: string, targetTitle: string): boolean {
    const normalizedLink = linkTarget.toLowerCase();
    const normalizedTitle = targetTitle.toLowerCase();
    const normalizedTargetPath = targetPath.toLowerCase();

    if (normalizedLink === normalizedTitle) return true;
    if (normalizedTargetPath.includes(normalizedLink + '.md')) return true;
    if (normalizedLink.includes('/')) {
      const parts = normalizedLink.split('/');
      if (normalizedTargetPath.endsWith(parts[parts.length - 1] + '.md')) return true;
    }
    return false;
  }

  private extractContext(content: string, startIndex: number, length: number): string {
    const contextStart = Math.max(0, startIndex - BACKLINK_CONTEXT_LENGTH);
    const contextEnd = Math.min(content.length, startIndex + length + BACKLINK_CONTEXT_LENGTH);
    const context = content.slice(contextStart, contextEnd);
    return context.replace(/\s+/g, ' ').trim();
  }

  private generateImplicitReason(score: number): string {
    if (score >= 0.9) return '内容高度相关';
    if (score >= 0.75) return '语义相似度较高';
    return '主题相似';
  }
}
