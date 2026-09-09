import { App, TFile } from 'obsidian';
import type MindOSPlugin from '../../../../main';
import { MindOSSettings, AutoLinkSuggestion } from '../../../core/types';
import { isWikiContentFile } from '../../../core/utils';

export class AutoLinkMiner {
  private plugin: MindOSPlugin;
  private app: App;
  private getSettings: () => MindOSSettings;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private cachedSuggestions: AutoLinkSuggestion[] = [];

  constructor(plugin: MindOSPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.getSettings = () => plugin.settings;
  }

  async initialize() {
    await this.loadMinedLinks();
    this.startAutoScan();
  }

  destroy() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
  }

  private startAutoScan() {
    const settings = this.getSettings();
    const intervalMinutes = settings.autoLinkScanInterval || 60;
    this.scanInterval = setInterval(async () => {
      await this.scanAllPagesForPotentialLinks();
    }, intervalMinutes * 60 * 1000);
  }

  async scanAllPagesForPotentialLinks(): Promise<AutoLinkSuggestion[]> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    
    const files = this.app.vault.getMarkdownFiles().filter(f => 
      isWikiContentFile(f, baseFolder)
    );

    const suggestions: AutoLinkSuggestion[] = [];
    const pageTitles = new Set<string>();
    
    for (const file of files) {
      pageTitles.add(this.extractTitle(file.path));
    }

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const potentialLinks = this.extractPotentialLinks(content, pageTitles, file.path);
        for (const potential of potentialLinks) {
          suggestions.push({
            sourcePath: file.path,
            targetTitle: potential,
            confidence: this.calculateConfidence(content, potential),
            context: this.extractContext(content, potential),
            createdAt: Date.now(),
          });
        }
      } catch (e) {
        console.error(`[MindOS] AutoLinkMiner error scanning ${file.path}:`, e);
      }
    }

    await this.saveSuggestions(suggestions);
    return suggestions;
  }

  private extractTitle(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
  }

  private extractPotentialLinks(content: string, existingTitles: Set<string>, currentPath: string): string[] {
    const foundLinks: string[] = [];
    const currentTitle = this.extractTitle(currentPath);
    
    const wikiLinkRegex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
    const existingLinks = new Set<string>();
    let match;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      existingLinks.add(match[1].toLowerCase());
    }

    const wordRegex = /[\u4e00-\u9fa5]{2,}|[A-Z][a-zA-Z0-9_]+|[a-zA-Z0-9_]{3,}/g;
    const words = new Set<string>();
    while ((match = wordRegex.exec(content)) !== null) {
      const word = match[0];
      if (word.length >= 2 && !existingLinks.has(word.toLowerCase())) {
        words.add(word);
      }
    }

    for (const word of words) {
      if (existingTitles.has(word) && word !== currentTitle) {
        foundLinks.push(word);
      }
    }

    return [...new Set(foundLinks)];
  }

  private calculateConfidence(content: string, term: string): number {
    const regex = new RegExp(term, 'gi');
    const matches = content.match(regex);
    const count = matches ? matches.length : 0;
    
    if (count >= 5) return 0.9;
    if (count >= 3) return 0.7;
    if (count >= 2) return 0.5;
    return 0.3;
  }

  private extractContext(content: string, term: string): string {
    const index = content.indexOf(term);
    if (index === -1) return '';
    
    const contextLength = 100;
    const start = Math.max(0, index - contextLength);
    const end = Math.min(content.length, index + term.length + contextLength);
    let context = content.slice(start, end);
    
    if (start > 0) context = '…' + context;
    if (end < content.length) context = context + '…';
    
    return context.replace(/\s+/g, ' ').trim();
  }

  private async saveSuggestions(suggestions: AutoLinkSuggestion[]) {
    const existing = this.cachedSuggestions;
    const merged = this.mergeSuggestions(existing, suggestions);
    this.cachedSuggestions = merged;
    
    const data = await this.plugin.loadData() || {};
    data.autoLinkSuggestions = merged;
    await this.plugin.saveData(data);
  }

  private mergeSuggestions(existing: AutoLinkSuggestion[], newSuggestions: AutoLinkSuggestion[]): AutoLinkSuggestion[] {
    const keyMap = new Map<string, AutoLinkSuggestion>();
    
    for (const s of existing) {
      const key = `${s.sourcePath}|${s.targetTitle}`;
      keyMap.set(key, s);
    }
    
    for (const s of newSuggestions) {
      const key = `${s.sourcePath}|${s.targetTitle}`;
      const existing = keyMap.get(key);
      if (existing) {
        existing.confidence = Math.max(existing.confidence, s.confidence);
        existing.context = s.context;
        existing.updatedAt = Date.now();
      } else {
        keyMap.set(key, { ...s, updatedAt: Date.now() });
      }
    }
    
    return [...keyMap.values()].sort((a, b) => b.confidence - a.confidence);
  }

  async loadMinedLinks(): Promise<AutoLinkSuggestion[]> {
    try {
      const data = await this.plugin.loadData();
      this.cachedSuggestions = data?.autoLinkSuggestions || [];
    } catch (e) {
      console.error('[MindOS] AutoLinkMiner load failed:', e);
      this.cachedSuggestions = [];
    }
    return this.cachedSuggestions;
  }

  async getSuggestionsBySource(sourcePath: string): Promise<AutoLinkSuggestion[]> {
    return this.cachedSuggestions.filter(s => s.sourcePath === sourcePath);
  }

  async applySuggestion(sourcePath: string, targetTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const link = `[[${targetTitle}]]`;
    
    if (!content.includes(link)) {
      const lastTwoLines = content.trim().split('\n').slice(-2);
      const shouldAddNewline = lastTwoLines.some(line => line.trim() === '' || line.startsWith('## ') || line.startsWith('### '));
      
      let newContent = content;
      if (shouldAddNewline) {
        newContent = content.trim() + '\n\n' + link + '\n';
      } else {
        const lastParagraphStart = content.lastIndexOf('\n\n');
        if (lastParagraphStart !== -1) {
          newContent = content.slice(0, lastParagraphStart + 2) + link + '\n\n' + content.slice(lastParagraphStart + 2);
        } else {
          newContent = content + '\n\n' + link + '\n';
        }
      }
      
      await this.app.vault.modify(file, newContent);
      
      this.cachedSuggestions = this.cachedSuggestions.filter(s => !(s.sourcePath === sourcePath && s.targetTitle === targetTitle));
      
      const data = await this.plugin.loadData() || {};
      data.autoLinkSuggestions = this.cachedSuggestions;
      await this.plugin.saveData(data);
    }
  }

  async applyAllSuggestions(sourcePath: string): Promise<number> {
    const suggestions = this.cachedSuggestions.filter(s => s.sourcePath === sourcePath);
    let count = 0;
    
    for (const suggestion of suggestions) {
      await this.applySuggestion(sourcePath, suggestion.targetTitle);
      count++;
    }
    
    return count;
  }
}