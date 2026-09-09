import { App, TFile } from "obsidian";
import { MindOSSettings } from "../../core/types";
import { AIClient } from "../pipeline/ai-client";

export interface KnowledgeGap {
  id: string;
  title: string;
  reason: string;
  confidence: number;
  suggestedBy: string;
  relatedPages: string[];
  pageType: "entity" | "concept" | "topic" | "comparison" | "overview";
}

export interface GapAnalysisResult {
  gaps: KnowledgeGap[];
  totalPages: number;
  analyzedPages: number;
  suggestions: string;
}

export class KnowledgeGapAnalyzer {
  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private aiClient: AIClient,
  ) {}

  async analyzeKnowledgeGaps(): Promise<GapAnalysisResult> {
    const settings = this.getSettings();
    const baseFolder = settings.baseFolder;
    
    // 尝试查找多个可能的知识文件夹路径
    let wikiFolder = this.app.vault.getAbstractFileByPath(`${baseFolder}/知识库`);
    if (!wikiFolder) {
      wikiFolder = this.app.vault.getAbstractFileByPath(`${baseFolder}/wiki`);
    }
    if (!wikiFolder) {
      wikiFolder = this.app.vault.getAbstractFileByPath(`${baseFolder}`);
    }
    
    if (!wikiFolder) {
      return { gaps: [], totalPages: 0, analyzedPages: 0, suggestions: "" };
    }

    const allPages = this.collectAllWikiPages(wikiFolder);
    const existingTitles = new Set(allPages.map(p => p.basename.replace(/\.md$/, "").toLowerCase()));
    
    const gaps: KnowledgeGap[] = [];
    let analyzedCount = 0;

    // 分析所有页面，不限制数量
    for (const file of allPages) {
      // 只跳过 _ 开头的系统文件，不跳过INDEX！
      const basename = file.basename.toLowerCase();
      if (basename.startsWith("_")) {
        continue;
      }
      
      try {
        const content = await this.app.vault.read(file);
        const pageGaps = await this.analyzePageGaps(file, content, existingTitles);
        gaps.push(...pageGaps);
        analyzedCount++;
      } catch (e) {
        console.warn(`Failed to analyze ${file.path}:`, e);
      }
    }

    const uniqueGaps = this.deduplicateGaps(gaps);
    const sortedGaps = uniqueGaps.sort((a, b) => b.confidence - a.confidence).slice(0, 20);
    
    const suggestions = await this.generateSummarySuggestion(sortedGaps);

    return {
      gaps: sortedGaps,
      totalPages: allPages.length,
      analyzedPages: analyzedCount,
      suggestions,
    };
  }

  private collectAllWikiPages(folder: any): TFile[] {
    const files: TFile[] = [];
    const stack = [folder];
    
    while (stack.length > 0) {
      const item = stack.pop();
      if (item instanceof TFile && item.extension === "md") {
        files.push(item);
      } else if (item && item.children) {
        stack.push(...item.children);
      }
    }
    
    return files;
  }

  private async analyzePageGaps(
    file: TFile,
    content: string,
    existingTitles: Set<string>,
  ): Promise<KnowledgeGap[]> {
    const gaps: KnowledgeGap[] = [];
    
    const mentionedConcepts = this.extractConcepts(content);
    
    for (const concept of mentionedConcepts) {
      const conceptLower = concept.toLowerCase();
      
      if (!existingTitles.has(conceptLower)) {
        gaps.push({
          id: `${file.basename}-${concept}`,
          title: concept,
          reason: `页面 [[${file.basename}]] 提到了 "${concept}"，但没有对应的 Wiki 页面`,
          confidence: this.calculateConfidence(concept, content),
          suggestedBy: file.basename,
          relatedPages: [file.path],
          pageType: this.inferPageType(concept),
        });
      }
    }
    
    const inferredGaps = await this.inferMissingPages(content, file.basename, existingTitles);
    gaps.push(...inferredGaps);
    
    return gaps;
  }

  private extractConcepts(content: string): string[] {
    const concepts: string[] = [];
    
    const linkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
      concepts.push(match[1].trim());
    }
    
    const codePattern = /`([^`]+)`/g;
    while ((match = codePattern.exec(content)) !== null) {
      const word = match[1].trim();
      if (word.length > 2 && !word.includes(" ")) {
        concepts.push(word);
      }
    }
    
    const uppercasePattern = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b/g;
    while ((match = uppercasePattern.exec(content)) !== null) {
      const word = match[1];
      if (word.length >= 3 && word.length <= 30) {
        concepts.push(word);
      }
    }
    
    const techTerms = [
      "Linux", "Docker", "Kubernetes", "K8s", "Python", "JavaScript", "TypeScript",
      "React", "Vue", "Node", "API", "REST", "GraphQL", "SQL", "MongoDB", "Redis",
      "Git", "CI", "CD", "DevOps", "AWS", "Azure", "GCP", "SSL", "HTTPS", "OAuth",
      "JWT", "HTTP", "WebSocket", "JSON", "XML", "YAML", "Markdown", "HTML", "CSS",
      "npm", "yarn", "Webpack", "Vite", "ESLint", "Prettier", "Jest", "Cypress",
      "chmod", "chown", "chgrp", "sudo", "bash", "shell", "terminal", "command",
      "algorithm", "data structure", "design pattern", "architecture", "microservices",
      "container", "orchestration", "serverless", "database", "cache", "queue",
      "message broker", "load balancer", "reverse proxy", "CDN", "DNS", "TCP", "UDP",
      "WebSocket", "gRPC", "Protocol Buffers", "GraphQL", "RESTful", "microservice",
      "monolith", "scalability", "availability", "reliability", "performance",
      "security", "encryption", "authentication", "authorization", "middleware",
      "framework", "library", "SDK", "CLI", "IDE", "debugging", "testing",
      "unit test", "integration test", "e2e test", "TDD", "BDD", "refactoring",
      "code review", "version control", "branching", "deployment", "rollback",
      "monitoring", "logging", "tracing", "alerting", "metrics", "observability",
      "distributed system", "consistency", "availability", "partition tolerance",
      "CAP theorem", "ACID", "BASE", "transaction", "locking", "deadlock",
      "concurrency", "parallelism", "thread", "process", "async", "promise",
      "callback", "reactive", "stream", "buffer", "memory", "CPU", "network",
      "latency", "throughput", "bandwidth", "compression", "serialization",
      "deserialization", "parsing", "validation", "sanitization", "encoding",
      "decoding", "encryption", "decryption", "hashing", "signing", "verification",
    ];
    
    for (const term of techTerms) {
      const regex = new RegExp(`\\b${term}\\b`, "gi");
      if (regex.test(content)) {
        concepts.push(term);
      }
    }
    
    return [...new Set(concepts)];
  }

  private calculateConfidence(concept: string, content: string): number {
    const mentions = (content.match(new RegExp(`\\b${concept}\\b`, "gi")) || []).length;
    const linkMentions = (content.match(new RegExp(`\\[\\[${concept}[^\\]]*\\]\\]`, "gi")) || []).length;
    
    let confidence = 0.3;
    
    if (mentions >= 3) confidence += 0.3;
    else if (mentions >= 2) confidence += 0.2;
    else if (mentions >= 1) confidence += 0.1;
    
    if (linkMentions > 0) confidence += 0.3;
    
    const isUpperCase = concept[0] === concept[0].toUpperCase();
    if (isUpperCase) confidence += 0.1;
    
    const hasSpecialChars = /[`'""]/.test(content.match(new RegExp(`[^\\w]${concept}[^\\w]`))?.[0] || "");
    if (hasSpecialChars) confidence += 0.1;
    
    return Math.min(1, confidence);
  }

  private inferPageType(concept: string): "entity" | "concept" | "topic" | "comparison" | "overview" {
    const conceptLower = concept.toLowerCase();
    
    if (conceptLower.includes(" vs ") || conceptLower.includes(" comparison")) {
      return "comparison";
    }
    if (conceptLower.includes(" guide") || conceptLower.includes(" tutorial") || conceptLower.includes(" how to")) {
      return "topic";
    }
    if (conceptLower.includes(" overview") || conceptLower.includes(" introduction") || conceptLower.includes(" basics")) {
      return "overview";
    }
    
    const entityPatterns = [
      /^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/,
      /^[a-z]+(?:-[a-z]+)+$/,
    ];
    
    if (entityPatterns.some(p => p.test(concept))) {
      return "entity";
    }
    
    return "concept";
  }

  private async inferMissingPages(
    content: string,
    sourcePage: string,
    existingTitles: Set<string>,
  ): Promise<KnowledgeGap[]> {
    const gaps: KnowledgeGap[] = [];
    
    const topicKeywords = [
      { keyword: "Pod", related: ["Service", "Deployment", "ReplicaSet", "StatefulSet"] },
      { keyword: "Service", related: ["Ingress", "LoadBalancer", "NodePort", "ClusterIP"] },
      { keyword: "Docker", related: ["Dockerfile", "docker-compose", "Container", "Image"] },
      { keyword: "Linux", related: ["Ubuntu", "CentOS", "Debian", "Kernel"] },
      { keyword: "Git", related: ["GitHub", "GitLab", "Branch", "Merge"] },
      { keyword: "API", related: ["REST", "GraphQL", "gRPC", "SOAP"] },
      { keyword: "Database", related: ["PostgreSQL", "MySQL", "MongoDB", "Redis"] },
      { keyword: "CI/CD", related: ["Jenkins", "GitLab CI", "GitHub Actions", "Docker"] },
      { keyword: "React", related: ["Vue", "Angular", "Svelte", "Next.js"] },
      { keyword: "TypeScript", related: ["JavaScript", "ES6", "Node.js", "Deno"] },
    ];
    
    for (const { keyword, related } of topicKeywords) {
      if (content.includes(keyword)) {
        for (const relatedTerm of related) {
          const termLower = relatedTerm.toLowerCase();
          if (!existingTitles.has(termLower)) {
            gaps.push({
              id: `${sourcePage}-related-${relatedTerm}`,
              title: relatedTerm,
              reason: `页面 [[${sourcePage}]] 提到了 "${keyword}"，通常也会涉及 "${relatedTerm}"`,
              confidence: 0.6,
              suggestedBy: sourcePage,
              relatedPages: [sourcePage],
              pageType: this.inferPageType(relatedTerm),
            });
          }
        }
      }
    }
    
    return gaps;
  }

  private deduplicateGaps(gaps: KnowledgeGap[]): KnowledgeGap[] {
    const seen = new Map<string, KnowledgeGap>();
    
    for (const gap of gaps) {
      const key = gap.title.toLowerCase();
      if (!seen.has(key) || seen.get(key)!.confidence < gap.confidence) {
        seen.set(key, gap);
      }
    }
    
    return Array.from(seen.values());
  }

  private async generateSummarySuggestion(gaps: KnowledgeGap[]): Promise<string> {
    if (gaps.length === 0) {
      return "🎉 你的知识库很完整！暂时没有发现明显的知识空白。";
    }
    
    const topGaps = gaps.slice(0, 5);
    const gapList = topGaps.map((g, i) => `${i + 1}. [[${g.title}]] - ${g.reason}`).join("\n");
    
    return `发现 ${gaps.length} 个潜在的知识空白。建议优先创建：\n\n${gapList}`;
  }

  async createGapPage(gap: KnowledgeGap): Promise<string | null> {
    const settings = this.getSettings();
    
    // 先找到第一个存在的文件夹作为基础
    let baseKnowledgePath = `${settings.baseFolder}/知识库`;
    if (!await this.app.vault.adapter.exists(baseKnowledgePath)) {
      baseKnowledgePath = `${settings.baseFolder}/wiki`;
    }
    if (!await this.app.vault.adapter.exists(baseKnowledgePath)) {
      baseKnowledgePath = settings.baseFolder;
    }
    
    const folder = gap.pageType;
    const folderPath = `${baseKnowledgePath}/${folder}`;
    const path = `${folderPath}/${gap.title}.md`;
    
    if (await this.app.vault.adapter.exists(path)) {
      return null;
    }
    
    try {
      await this.app.vault.createFolder(folderPath);
    } catch (e) {
      // 文件夹已存在或创建失败，继续
    }
    
    const frontmatter = {
      title: gap.title,
      type: gap.pageType,
      created: new Date().toISOString(),
      maturity: "seedling",
      tags: ["mindos-collected", `auto-suggested`],
      suggestedBy: gap.suggestedBy,
    };
    
    const content = `---
${Object.entries(frontmatter).map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : v}`).join("\n")}
---

# ${gap.title}

${gap.reason}

## 📋 待完善内容

- [ ] 核心概念定义
- [ ] 关键特性
- [ ] 应用场景
- [ ] 相关链接

---

> 💡 此页面由 MindOS 知识空白雷达自动创建
`;
    
    try {
      await this.app.vault.create(path, content);
    } catch (e: any) {
      if (e?.message?.includes?.("already exists")) {
        return null;
      }
      throw e;
    }
    return path;
  }
}