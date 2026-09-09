import { App, TFile } from 'obsidian';
import type MindOSPlugin from '../../../main';
import { MindOSSettings, PageSummary } from '../../core/types';
import { UnifiedDocumentParser } from './unified-parser';
import { isWikiContentFile } from '../../core/utils';

export class SummaryGenerator {
  private plugin: MindOSPlugin;
  private app: App;
  private getSettings: () => MindOSSettings;
  private unifiedParser: UnifiedDocumentParser;
  private cachedSummaries: Map<string, PageSummary> = new Map();

  constructor(plugin: MindOSPlugin, unifiedParser: UnifiedDocumentParser) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.getSettings = () => plugin.settings;
    this.unifiedParser = unifiedParser;
  }

  async initialize() {
    await this.loadSummaries();
  }

  async loadSummaries() {
    try {
      const data = await this.plugin.loadData();
      const summaries = data?.pageSummaries || [];
      this.cachedSummaries = new Map(summaries.map((s: PageSummary) => [s.sourcePath, s]));
    } catch (e) {
      console.error('[MindOS] SummaryGenerator load failed:', e);
      this.cachedSummaries = new Map();
    }
  }

  async generateSummary(filePath: string): Promise<PageSummary> {
    const result = await this.unifiedParser.parse(filePath, true);
    this.cachedSummaries.set(filePath, result.summary);
    await this.saveSummaries();
    return result.summary;
  }

  async getSummary(filePath: string): Promise<PageSummary | null> {
    const cached = this.cachedSummaries.get(filePath);
    if (cached) {
      return cached;
    }

    try {
      const result = await this.unifiedParser.parse(filePath);
      this.cachedSummaries.set(filePath, result.summary);
      await this.saveSummaries();
      return result.summary;
    } catch {
      return null;
    }
  }

  async regenerateSummary(filePath: string): Promise<PageSummary | null> {
    return this.generateSummary(filePath);
  }

  async generateAllSummaries(): Promise<PageSummary[]> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    
    const files = this.app.vault.getMarkdownFiles().filter(f => 
      isWikiContentFile(f, baseFolder)
    );

    const summaries: PageSummary[] = [];
    for (const file of files) {
      try {
        const summary = await this.generateSummary(file.path);
        summaries.push(summary);
      } catch (e) {
        console.error(`[MindOS] SummaryGenerator error for ${file.path}:`, e);
      }
    }

    return summaries;
  }

  private async saveSummaries() {
    const data = await this.plugin.loadData() || {};
    data.pageSummaries = Array.from(this.cachedSummaries.values());
    await this.plugin.saveData(data);
  }

  async clearAllSummaries() {
    this.cachedSummaries.clear();
    await this.saveSummaries();
  }
}
