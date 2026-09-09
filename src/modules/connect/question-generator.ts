import { App, TFile } from 'obsidian';
import type MindOSPlugin from '../../../main';
import { MindOSSettings, GeneratedQuestion, SRSData } from '../../core/types';
import { UnifiedDocumentParser } from './unified-parser';
import { isWikiContentFile } from '../../core/utils';

export class QuestionGenerator {
  private plugin: MindOSPlugin;
  private app: App;
  private getSettings: () => MindOSSettings;
  private unifiedParser: UnifiedDocumentParser;
  private cachedQuestions: Map<string, GeneratedQuestion[]> = new Map();

  constructor(plugin: MindOSPlugin, unifiedParser: UnifiedDocumentParser) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.getSettings = () => plugin.settings;
    this.unifiedParser = unifiedParser;
  }

  async initialize() {
    await this.loadQuestions();
  }

  async loadQuestions() {
    try {
      const data = await this.plugin.loadData();
      const questions = data?.generatedQuestions || [];
      this.cachedQuestions = new Map();
      for (const q of questions) {
        if (!this.cachedQuestions.has(q.sourcePath)) {
          this.cachedQuestions.set(q.sourcePath, []);
        }
        this.cachedQuestions.get(q.sourcePath)!.push(q);
      }
    } catch (e) {
      console.error('[MindOS] QuestionGenerator load failed:', e);
      this.cachedQuestions = new Map();
    }
  }

  async generateQuestions(filePath: string): Promise<GeneratedQuestion[]> {
    const result = await this.unifiedParser.parse(filePath, true);
    
    const existing = this.cachedQuestions.get(filePath) || [];
    const existingIds = new Set(existing.map(q => q.id));
    
    const mergedQuestions: GeneratedQuestion[] = [...existing];
    for (const q of result.questions) {
      if (!existingIds.has(q.id)) {
        mergedQuestions.push(q);
      }
    }
    
    this.cachedQuestions.set(filePath, mergedQuestions);
    await this.saveQuestions();
    
    return result.questions;
  }

  async getQuestions(filePath: string): Promise<GeneratedQuestion[]> {
    const cached = this.cachedQuestions.get(filePath);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      const result = await this.unifiedParser.parse(filePath);
      const existing = this.cachedQuestions.get(filePath) || [];
      
      if (existing.length === 0) {
        this.cachedQuestions.set(filePath, result.questions);
        await this.saveQuestions();
        return result.questions;
      }
      
      return existing;
    } catch {
      return [];
    }
  }

  async regenerateQuestions(filePath: string): Promise<GeneratedQuestion[]> {
    return this.generateQuestions(filePath);
  }

  async generateAllQuestions(): Promise<GeneratedQuestion[]> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    
    const files = this.app.vault.getMarkdownFiles().filter(f => 
      isWikiContentFile(f, baseFolder)
    );

    const allQuestions: GeneratedQuestion[] = [];
    for (const file of files) {
      try {
        const questions = await this.generateQuestions(file.path);
        allQuestions.push(...questions);
      } catch (e) {
        console.error(`[MindOS] QuestionGenerator error for ${file.path}:`, e);
      }
    }

    return allQuestions;
  }

  async updateQuestionReview(questionId: string, correct: boolean): Promise<void> {
    for (const questions of this.cachedQuestions.values()) {
      const question = questions.find(q => q.id === questionId);
      if (question) {
        question.reviewedCount++;
        if (correct) {
          question.correctCount++;
        }
        
        if (!question.srsData) {
          question.srsData = this.createInitialSRSData();
        }
        
        await this.saveQuestions();
        return;
      }
    }
  }

  private createInitialSRSData(): SRSData {
    return {
      algorithm: 'sm2',
      interval: 1,
      repetitions: 0,
      easeFactor: 2.5,
      stability: 0,
      difficulty: 0,
      nextReview: new Date().toISOString(),
      lastReview: '',
      lastRating: 0
    };
  }

  private async saveQuestions() {
    const data = await this.plugin.loadData() || {};
    const allQuestions: GeneratedQuestion[] = [];
    for (const questions of this.cachedQuestions.values()) {
      allQuestions.push(...questions);
    }
    data.generatedQuestions = allQuestions;
    await this.plugin.saveData(data);
  }

  async clearAllQuestions() {
    this.cachedQuestions.clear();
    await this.saveQuestions();
  }
}
