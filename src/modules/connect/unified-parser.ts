import { App, TFile } from 'obsidian';
import { PluginLike } from '../../core/plugin-like';
import { MindOSSettings, PageSummary, GeneratedQuestion } from '../../core/types';

export interface UnifiedParseResult {
  sourcePath: string;
  contentHash: string;
  parsedAt: string;
  
  summary: PageSummary;
  questions: GeneratedQuestion[];
  
  keyConcepts: string[];
  tags: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  oneLiner: string;
}

export class UnifiedDocumentParser {
  private plugin: PluginLike;
  private app: App;
  private getSettings: () => MindOSSettings;
  private cache: Map<string, UnifiedParseResult> = new Map();

  constructor(plugin: PluginLike) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.getSettings = () => plugin.settings;
  }

  async initialize() {
    await this.loadCache();
  }

  /** 插件卸载时释放内存缓存 */
  destroy(): void {
    this.cache.clear();
  }

  async loadCache() {
    try {
      const data = await this.plugin.loadData();
      const cached = data?.unifiedParseCache || [];
      this.cache = new Map(cached.map((item: UnifiedParseResult) => [item.sourcePath, item]));
    } catch (e) {
      console.error('[MindOS] UnifiedParser cache load failed:', e);
      this.cache = new Map();
    }
  }

  private async saveCache() {
    const data = await this.plugin.loadData() || {};
    data.unifiedParseCache = Array.from(this.cache.values());
    await this.plugin.saveData(data);
  }

  private getContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  async parse(filePath: string, forceRefresh: boolean = false): Promise<UnifiedParseResult> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error('File not found');
    }

    const content = await this.app.vault.read(file);
    const contentHash = this.getContentHash(content);

    const cached = this.cache.get(filePath);
    if (!forceRefresh && cached && cached.contentHash === contentHash) {
      return cached;
    }

    const result = await this.parseWithAI(content, filePath, contentHash);
    this.cache.set(filePath, result);
    await this.saveCache();
    
    return result;
  }

  private async parseWithAI(content: string, filePath: string, contentHash: string): Promise<UnifiedParseResult> {
    const settings = this.getSettings();
    const maxQuestions = settings.maxQuestionsPerPage || 5;

    const systemPrompt = `你是一个专业的知识管理助手。请对给定的文档进行全面解析，一次性提取所有需要的信息。

【输出要求】
请输出JSON格式，不要任何额外文字：
{
  "oneLiner": "一句话总结（不超过20字）",
  "summary": {
    "level1": "一句话总结（不超过20字）",
    "level2": "简短摘要（3-5句话，不超过200字）",
    "level3": "详细摘要，按主题分块，使用Markdown格式"
  },
  "questions": [
    {
      "question": "问题内容",
      "answer": "答案内容",
      "difficulty": "easy|medium|hard",
      "qualityScore": 0.9
    }
  ],
  "keyConcepts": ["关键概念1", "关键概念2", ...],
  "tags": ["标签1", "标签2", ...],
  "difficulty": "easy|medium|hard"
}

【注意事项】
- questions数组包含${maxQuestions}个问题
- 问题类型多样化：概念理解、操作步骤、命令用法、原理分析
- keyConcepts提取3-8个核心概念
- tags提取3-6个相关标签
`.trim();

    const userPrompt = `请解析以下文档内容：

${content.substring(0, 10000)}
`.trim();

    const response = await this.plugin.aiClient.chat(systemPrompt, userPrompt);
    
    let parsed: any;
    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) ||
                      response.match(/```\s*([\s\S]*?)```/) ||
                      response.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[MindOS] UnifiedParser parse failed:', e);
      return this.fallbackParse(content, filePath, contentHash);
    }

    return {
      sourcePath: filePath,
      contentHash,
      parsedAt: new Date().toISOString(),
      
      summary: {
        sourcePath: filePath,
        level1: parsed.summary?.level1 || parsed.oneLiner || this.extractLevel1(content),
        level2: parsed.summary?.level2 || this.extractLevel2(content),
        level3: parsed.summary?.level3 || this.extractLevel3(content),
        wordCount: content.length,
        generatedAt: new Date().toISOString()
      },
      
      questions: (parsed.questions || []).map((q: any, i: number) => ({
        id: `${filePath}-ai-${Date.now()}-${i}`,
        sourcePath: filePath,
        question: q.question || '',
        answer: q.answer || '暂无答案',
        difficulty: q.difficulty || 'medium',
        qualityScore: typeof q.qualityScore === 'number' ? q.qualityScore : 0.8,
        createdAt: new Date().toISOString(),
        reviewedCount: 0,
        correctCount: 0
      })).filter((q: GeneratedQuestion) => q.question.length > 5).slice(0, maxQuestions),
      
      keyConcepts: parsed.keyConcepts || this.extractKeyConcepts(content),
      tags: parsed.tags || [],
      difficulty: parsed.difficulty || 'medium',
      oneLiner: parsed.oneLiner || this.extractLevel1(content)
    };
  }

  private fallbackParse(content: string, filePath: string, contentHash: string): UnifiedParseResult {
    return {
      sourcePath: filePath,
      contentHash,
      parsedAt: new Date().toISOString(),
      
      summary: {
        sourcePath: filePath,
        level1: this.extractLevel1(content),
        level2: this.extractLevel2(content),
        level3: this.extractLevel3(content),
        wordCount: content.length,
        generatedAt: new Date().toISOString()
      },
      
      questions: this.generateFallbackQuestions(content, filePath),
      keyConcepts: this.extractKeyConcepts(content),
      tags: [],
      difficulty: 'medium',
      oneLiner: this.extractLevel1(content)
    };
  }

  private extractLevel1(content: string): string {
    const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    if (lines.length === 0) return '暂无内容';
    
    const firstParagraph = lines.find(line => line.length > 20) || lines[0];
    const sentenceEnd = firstParagraph.indexOf('。');
    if (sentenceEnd !== -1) {
      const result = firstParagraph.substring(0, sentenceEnd + 1);
      return result.length > 10 ? result : firstParagraph.substring(0, 50) + '…';
    }
    return firstParagraph.substring(0, 50) + '…';
  }

  private extractLevel2(content: string): string {
    const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    if (lines.length === 0) return '暂无内容';

    const sentences: string[] = [];
    let current = '';
    for (const line of lines) {
      current += line;
      const parts = current.split(/(?<=[。！？])/g);
      for (let i = 0; i < parts.length - 1; i++) {
        sentences.push(parts[i].trim());
      }
      current = parts[parts.length - 1];
    }
    if (current.trim()) sentences.push(current.trim());

    const selected = sentences.slice(0, 3);
    const result = selected.join(' ') || '暂无内容';
    return result.length > 200 ? result.substring(0, 200) + '…' : result;
  }

  private extractLevel3(content: string): string {
    const sections: string[] = [];
    const lines = content.split('\n');
    let currentSection: string[] = [];
    let currentSectionTitle = '';

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentSectionTitle && currentSection.length > 0) {
          sections.push(`### ${currentSectionTitle}\n${currentSection.filter(s => s.length > 5).join(' ').substring(0, 500)}`);
        }
        currentSectionTitle = line.substring(3).trim();
        currentSection = [];
      } else if (!line.startsWith('#') && !line.startsWith('- ') && !line.startsWith('* ') && !line.startsWith('>')) {
        currentSection.push(line.trim());
      }
    }

    if (currentSectionTitle && currentSection.length > 0) {
      sections.push(`### ${currentSectionTitle}\n${currentSection.filter(s => s.length > 5).join(' ').substring(0, 500)}`);
    }

    if (sections.length === 0) {
      return this.extractLevel2(content);
    }

    return sections.join('\n\n');
  }

  private extractKeyConcepts(content: string): string[] {
    const codeBlocks = content.match(/`([^`]+)`/g) || [];
    const headers = content.match(/^##+\s+(.*)$/gm) || [];
    const concepts = [...codeBlocks.map(c => c.replace(/`/g, '')), ...headers.map(h => h.replace(/^#+\s*/, ''))];
    return [...new Set(concepts.filter(c => c.length > 1 && c.length < 30))].slice(0, 8);
  }

  private generateFallbackQuestions(content: string, filePath: string): GeneratedQuestion[] {
    const questions: GeneratedQuestion[] = [];
    const lines = content.split('\n');
    let currentSection = '';
    let sectionContent = '';

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentSection && sectionContent.trim()) {
          const cleanContent = sectionContent.replace(/\s+/g, ' ').trim();
          questions.push({
            id: `${filePath}-fallback-${Date.now()}-${questions.length}`,
            sourcePath: filePath,
            question: `什么是${currentSection}？`,
            answer: this.extractDefinitionAnswer(cleanContent, currentSection),
            difficulty: 'medium',
            qualityScore: 0.7,
            createdAt: new Date().toISOString(),
            reviewedCount: 0,
            correctCount: 0
          });
        }
        currentSection = line.substring(3).trim();
        sectionContent = '';
      } else if (!line.startsWith('#')) {
        sectionContent += line + ' ';
      }
    }

    if (questions.length === 0) {
      questions.push({
        id: `${filePath}-fallback-default-${Date.now()}`,
        sourcePath: filePath,
        question: '请简述本文档的主要内容？',
        answer: '根据文档内容进行总结回答',
        difficulty: 'medium',
        qualityScore: 0.6,
        createdAt: new Date().toISOString(),
        reviewedCount: 0,
        correctCount: 0
      });
    }

    return questions.slice(0, 5);
  }

  private extractDefinitionAnswer(content: string, topic: string): string {
    const sentences = content.split(/(?<=[。！？])/g);
    for (const sentence of sentences) {
      if (sentence.includes(topic) && sentence.length > 15) {
        return sentence.trim();
      }
    }
    const firstFew = sentences.slice(0, 2).join(' ');
    return firstFew.length > 10 ? firstFew.trim() : '暂无详细信息';
  }

  async getParseResult(filePath: string): Promise<UnifiedParseResult | null> {
    const cached = this.cache.get(filePath);
    if (cached) return cached;

    try {
      return await this.parse(filePath);
    } catch {
      return null;
    }
  }

  async clearCacheForFile(filePath: string) {
    this.cache.delete(filePath);
    await this.saveCache();
  }

  async clearAllCache() {
    this.cache.clear();
    await this.saveCache();
  }
}
