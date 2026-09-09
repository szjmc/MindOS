import { App, TFile } from 'obsidian';
import { PluginLike } from '../../../core/plugin-like';
import { MindOSSettings, ContradictionReport, ContradictionPair, ContradictionEvidence } from '../../../core/types';
import { isWikiContentFile } from '../../../core/utils';

export class ContradictionDetector {
  private plugin: PluginLike;
  private app: App;
  private getSettings: () => MindOSSettings;
  private scanInterval: ReturnType<typeof setInterval> | null = null;
  private cachedReport: ContradictionReport | null = null;

  constructor(plugin: PluginLike) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.getSettings = () => plugin.settings;
  }

  async initialize() {
    await this.loadReport();
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
    const intervalHours = settings.contradictionScanInterval || 24;
    this.scanInterval = setInterval(async () => {
      await this.detectContradictions();
    }, intervalHours * 60 * 60 * 1000);
  }

  async detectContradictions(): Promise<ContradictionReport> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    
    const files = this.app.vault.getMarkdownFiles().filter(f => 
      isWikiContentFile(f, baseFolder)
    );

    const sentences: Array<{ path: string; sentence: string; confidence: number }> = [];
    
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const fileSentences = this.extractStatements(content);
        for (const sentence of fileSentences) {
          sentences.push({
            path: file.path,
            sentence,
            confidence: this.estimateConfidence(sentence)
          });
        }
      } catch (e) {
        console.error(`[MindOS] ContradictionDetector error scanning ${file.path}:`, e);
      }
    }

    const conflicts = this.findConflicts(sentences);
    const report: ContradictionReport = {
      generatedAt: new Date().toISOString(),
      totalConflicts: conflicts.length,
      conflicts,
      bySeverity: {
        high: conflicts.filter(c => c.severity === 'high').length,
        medium: conflicts.filter(c => c.severity === 'medium').length,
        low: conflicts.filter(c => c.severity === 'low').length,
      }
    };

    await this.saveReport(report);
    return report;
  }

  private extractStatements(content: string): string[] {
    const sentences: string[] = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        continue;
      }
      
      const parts = trimmed.split(/(?<=[。！？])/g);
      for (const part of parts) {
        const sentence = part.trim();
        if (sentence.length >= 10 && sentence.length <= 200) {
          sentences.push(sentence);
        }
      }
    }
    
    return sentences;
  }

  private estimateConfidence(sentence: string): number {
    let confidence = 0.5;
    
    if (sentence.includes('必须') || sentence.includes('一定') || sentence.includes('绝对')) {
      confidence += 0.2;
    }
    
    if (sentence.includes('可能') || sentence.includes('也许') || sentence.includes('大概')) {
      confidence -= 0.2;
    }
    
    if (/[\d零一二三四五六七八九十百千]+/.test(sentence)) {
      confidence += 0.15;
    }
    
    return Math.min(1, Math.max(0.3, confidence));
  }

  private findConflicts(sentences: Array<{ path: string; sentence: string; confidence: number }>): ContradictionPair[] {
    const conflicts: ContradictionPair[] = [];
    const seenPairs = new Set<string>();
    
    for (let i = 0; i < sentences.length; i++) {
      for (let j = i + 1; j < sentences.length; j++) {
        const s1 = sentences[i];
        const s2 = sentences[j];
        
        if (s1.path === s2.path) continue;
        
        const key = [s1.path, s2.path].sort().join('|');
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        
        const conflict = this.compareSentences(s1, s2);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }
    
    return conflicts.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  private compareSentences(s1: { path: string; sentence: string; confidence: number }, s2: { path: string; sentence: string; confidence: number }): ContradictionPair | null {
    const similarity = this.calculateSimilarity(s1.sentence, s2.sentence);
    
    if (similarity < 0.3) return null;
    
    const hasConflict = this.detectSemanticConflict(s1.sentence, s2.sentence);
    if (!hasConflict.conflict) return null;
    
    const averageConfidence = (s1.confidence + s2.confidence) / 2;
    
    let severity: 'high' | 'medium' | 'low' = 'low';
    if (averageConfidence >= 0.8 && hasConflict.direct) {
      severity = 'high';
    } else if (averageConfidence >= 0.6) {
      severity = 'medium';
    }
    
    return {
      id: `${s1.path}-${s2.path}-${Date.now()}`,
      evidence1: {
        sentence: s1.sentence,
        sourcePath: s1.path,
        confidence: s1.confidence
      },
      evidence2: {
        sentence: s2.sentence,
        sourcePath: s2.path,
        confidence: s2.confidence
      },
      conflictType: hasConflict.direct ? 'direct' : hasConflict.implied ? 'implied' : 'ambiguous',
      severity,
      similarityScore: similarity,
      explanation: hasConflict.reason,
      suggestion: this.generateSuggestion(s1, s2)
    };
  }

  private calculateSimilarity(s1: string, s2: string): number {
    const words1 = s1.split(/\s+/).filter(w => w.length >= 2);
    const words2 = s2.split(/\s+/).filter(w => w.length >= 2);
    
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    let intersection = 0;
    for (const word of set1) {
      if (set2.has(word)) intersection++;
    }
    
    const union = set1.size + set2.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private detectSemanticConflict(s1: string, s2: string): { conflict: boolean; direct: boolean; implied: boolean; reason?: string } {
    const negationWords = ['不', '没有', '无', '非', '未', '不是', '不会', '不能', '不要'];
    const contradictionPatterns = [
      { pattern: /(\d+)\s*(分钟|小时|天|周|月|年)/, name: '时间' },
      { pattern: /(\d+)\s*(元|美元|欧元|¥|\$)/, name: '金额' },
      { pattern: /(\d+)\s*(人|个|项|条|种)/, name: '数量' },
      { pattern: /(\d+)\s*(%|百分比)/, name: '百分比' },
      { pattern: /(必须|应该|可以|禁止)/, name: '义务' },
    ];
    
    const s1Negated = negationWords.some(word => s1.includes(word));
    const s2Negated = negationWords.some(word => s2.includes(word));
    
    if (s1Negated !== s2Negated) {
      return { 
        conflict: true, 
        direct: true, 
        implied: false,
        reason: `两句表达的否定状态相反，一句包含否定词，另一句不包含`
      };
    }
    
    for (const { pattern, name } of contradictionPatterns) {
      const match1 = s1.match(pattern);
      const match2 = s2.match(pattern);
      
      if (match1 && match2) {
        const value1 = parseInt(match1[1]);
        const value2 = parseInt(match2[1]);
        
        if (!isNaN(value1) && !isNaN(value2) && value1 !== value2) {
          const diff = Math.abs(value1 - value2);
          const max = Math.max(value1, value2);
          const ratio = diff / max;
          
          if (ratio > 0.3) {
            return { 
              conflict: true, 
              direct: true, 
              implied: false,
              reason: `关于${name}的描述不一致："${match1[0]}" vs "${match2[0]}"`
            };
          }
        }
      }
    }
    
    const oppositeWords = [
      ['增加', '减少'], ['上升', '下降'], ['高', '低'], ['快', '慢'], 
      ['多', '少'], ['好', '坏'], ['正确', '错误'], ['支持', '反对']
    ];
    
    for (const [pos, neg] of oppositeWords) {
      const s1HasPos = s1.includes(pos);
      const s1HasNeg = s1.includes(neg);
      const s2HasPos = s2.includes(pos);
      const s2HasNeg = s2.includes(neg);
      
      if ((s1HasPos && s2HasNeg) || (s1HasNeg && s2HasPos)) {
        return { 
          conflict: true, 
          direct: false, 
          implied: true,
          reason: `使用了含义相反的词语："${pos}" 和 "${neg}"`
        };
      }
    }
    
    return { conflict: false, direct: false, implied: false };
  }

  private generateSuggestion(s1: { path: string; sentence: string }, s2: { path: string; sentence: string }): string {
    const title1 = this.extractTitle(s1.path);
    const title2 = this.extractTitle(s2.path);
    
    return `建议检查「${title1}」和「${title2}」中的相关描述，确认哪一个更准确，或者考虑合并/澄清这两处内容。`;
  }

  private extractTitle(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
  }

  private async saveReport(report: ContradictionReport) {
    this.cachedReport = report;
    const data = await this.plugin.loadData() || {};
    data.contradictionReport = report;
    await this.plugin.saveData(data);
  }

  async loadReport(): Promise<ContradictionReport | null> {
    try {
      const data = await this.plugin.loadData();
      this.cachedReport = data?.contradictionReport || null;
    } catch (e) {
      console.error('[MindOS] ContradictionDetector load failed:', e);
      this.cachedReport = null;
    }
    return this.cachedReport;
  }

  async markResolved(conflictId: string): Promise<void> {
    if (!this.cachedReport) return;
    
    const conflict = this.cachedReport.conflicts.find(c => c.id === conflictId);
    if (conflict) {
      conflict.resolved = true;
      conflict.resolvedAt = Date.now();
      await this.saveReport(this.cachedReport);
    }
  }

  async markAllResolved(): Promise<void> {
    if (!this.cachedReport) return;
    
    for (const conflict of this.cachedReport.conflicts) {
      conflict.resolved = true;
      conflict.resolvedAt = Date.now();
    }
    await this.saveReport(this.cachedReport);
  }
}