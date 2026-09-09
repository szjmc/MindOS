import {
  JDAnalysis,
  SkillRequirement,
  SkillStatus,
  SearchResult,
} from "../../core/types";
import { SemanticSearch } from "../retrieve/semantic-search";
import { InterviewStore } from "./interview-store";
import { sleep } from "../../core/utils";

export interface GapAnalysisProgress {
  total: number;
  done: number;
  currentSkill: string;
  phase?: string;  // ✅ 新增：当前阶段（用于 AI 增强模式）
}

/**
 * 知识盘点分析器
 *
 * 两种模式：
 *  1. analyze()           本地盘点（对照 Wiki）
 *  2. aiEnhancedAnalyze() AI 增强盘点（缺失项让 AI 生成内容并保存到 Wiki）
 */
export class GapAnalyzer {
  private MASTERED_THRESHOLD = 0.7;
  private PARTIAL_THRESHOLD = 0.5;

  constructor(
    private semanticSearch: SemanticSearch,
    private interviewStore: InterviewStore,
    private logger: (msg: string) => void,
  ) {}

  // ════════════════════════════════════════════════════════════
  // 本地盘点（原有功能）
  // ════════════════════════════════════════════════════════════
  async analyze(
    jd: JDAnalysis,
    onProgress?: (p: GapAnalysisProgress) => void,
  ): Promise<JDAnalysis> {
    if (!jd.skills || jd.skills.length === 0) {
      throw new Error("该 JD 没有提取出任何技能");
    }

    this.logger(`ℹ️ 开始知识盘点：${jd.position} | ${jd.skills.length} 个技能`);

    const progress: GapAnalysisProgress = {
      total: jd.skills.length,
      done: 0,
      currentSkill: "",
      phase: "本地盘点",
    };
    onProgress?.(progress);

    for (let i = 0; i < jd.skills.length; i++) {
      const skill = jd.skills[i];
      progress.currentSkill = skill.skill;
      onProgress?.(progress);

      try {
        await this.analyzeSkill(skill);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger(`⚠️ ${skill.skill} 分析失败: ${msg}`);
        skill.status = "missing";
        skill.coverage = 0;
        skill.matchedPages = [];
      }

      progress.done++;
      onProgress?.(progress);
    }

    const mastered = jd.skills.filter((s) => s.status === "mastered").length;
    const partial = jd.skills.filter((s) => s.status === "partial").length;
    const missing = jd.skills.filter((s) => s.status === "missing").length;

    const requiredSkills = jd.skills.filter((s) => s.required);
    const requiredMastered = requiredSkills.filter((s) => s.status === "mastered").length;
    const requiredPartial = requiredSkills.filter((s) => s.status === "partial").length;

    const requiredScore = requiredSkills.length > 0
      ? (requiredMastered + requiredPartial * 0.5) / requiredSkills.length
      : 1;
    const niceScore = jd.skills.length - requiredSkills.length > 0
      ? jd.skills
          .filter((s) => !s.required)
          .reduce((sum, s) =>
            sum + (s.status === "mastered" ? 1 : s.status === "partial" ? 0.5 : 0), 0
          ) / (jd.skills.length - requiredSkills.length)
      : 1;

    const overallReadiness = Math.round((requiredScore * 0.7 + niceScore * 0.3) * 100) / 100;

    const summary = this.buildSummary({
      position: jd.position,
      total: jd.skills.length,
      mastered,
      partial,
      missing,
      requiredTotal: requiredSkills.length,
      requiredMissingNames: requiredSkills.filter((s) => s.status === "missing").map((s) => s.skill),
      overallReadiness,
    });

    jd.gapAnalysis = {
      masteredCount: mastered,
      partialCount: partial,
      missingCount: missing,
      overallReadiness,
      summary,
    };

    await this.interviewStore.save(jd);
    this.logger(`✅ 知识盘点完成：准备度 ${(overallReadiness * 100).toFixed(0)}%`);

    return jd;
  }

  // ════════════════════════════════════════════════════════════
  // ✅ AI 增强盘点（新增）
  // ════════════════════════════════════════════════════════════
  async aiEnhancedAnalyze(
    jd: JDAnalysis,
    plugin: any,
    onProgress?: (p: GapAnalysisProgress) => void,
  ): Promise<{ jd: JDAnalysis; addedKnowledge: number; errors: string[] }> {
    if (!jd.skills || jd.skills.length === 0) {
      throw new Error("该 JD 没有提取出任何技能");
    }

    // 先做本地盘点（如果还没做过）
    if (!jd.gapAnalysis) {
      this.logger("ℹ️ 先执行本地知识盘点");
      await this.analyze(jd, (p) => {
        onProgress?.({
          ...p,
          phase: "📊 本地盘点中",
        });
      });
    }

    const weakSkills = jd.skills.filter((s) => s.status === "missing" || s.status === "partial");

    if (weakSkills.length === 0) {
      this.logger("✅ 所有技能均已掌握，无需 AI 增强");
      return { jd, addedKnowledge: 0, errors: [] };
    }

    this.logger(`ℹ️ AI 增强模式：${weakSkills.length} 个薄弱技能`);

    const errors: string[] = [];
    let addedKnowledge = 0;
    const total = weakSkills.length + 2;  // +2 是向量化和重新盘点

    let processed = 0;

    for (const skill of weakSkills) {
      processed++;
      onProgress?.({
        total,
        done: processed,
        currentSkill: skill.skill,
        phase: "🤖 AI 生成知识",
      });

      try {
        // 1. AI 生成该技能的完整知识内容
        const knowledge = await this.fetchKnowledgeFromAI(skill, jd, plugin);
        if (!knowledge) {
          throw new Error("AI 未返回有效内容");
        }

        // 2. 通过采集流水线保存到 Wiki
        await this.saveAsWikiViaWorkflow(plugin, skill, knowledge);
        addedKnowledge++;

        // 避免 API 限流
        await sleep(800);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${skill.skill}: ${msg}`);
        this.logger(`❌ ${skill.skill} 失败: ${msg}`);
      }
    }

    // 3. 触发增量向量化以索引新文件
    onProgress?.({
      total,
      done: weakSkills.length + 1,
      currentSkill: "",
      phase: "🔍 更新向量索引",
    });
    try {
      await plugin.embeddingManager.syncIncremental();
    } catch (e) {
      this.logger(`⚠️ 向量化失败：${e}`);
    }

    // 4. 重新盘点
    onProgress?.({
      total,
      done: weakSkills.length + 2,
      currentSkill: "",
      phase: "📊 重新盘点",
    });
    const updated = await this.analyze(jd);

    this.logger(`✅ AI 增强盘点完成：新增 ${addedKnowledge} 项知识`);
    return { jd: updated, addedKnowledge, errors };
  }

  /**
   * 调用 AI 获取技能的完整知识内容
   */
  private async fetchKnowledgeFromAI(
    skill: SkillRequirement,
    jd: JDAnalysis,
    plugin: any,
  ): Promise<string> {
    const systemPrompt = `你是技术专家，需要为面试候选人讲解某个技能/知识点。
请输出详细、专业、可背诵的内容（用 Markdown）。

要求：
1. 包含核心概念定义
2. 主要使用场景
3. 关键技术细节（原理/参数/语法等）
4. 与相关技术的对比（如果适用）
5. 常见面试问题和答案
6. 实战示例（代码/命令/案例）

不要 JSON 格式，直接输出 Markdown 文章。`;

    const userPrompt = `请详细讲解技能：「${skill.skill}」

背景信息：
- 应聘职位：${jd.position}${jd.company ? ` @ ${jd.company}` : ""}
- 技能分类：${skill.category}
- 期望水平：${skill.level}
- 是否必需：${skill.required ? "是" : "否"}

请生成至少 800 字的详细内容，让候选人通过这份内容能够应对面试。`;

    // 通过 plugin 的 aiCardGenerator 底层 API 调用
    // 注：aiCardGenerator.generate 默认要求 JSON，所以我们直接调用底层
    const result = await plugin.aiCardGenerator.generate({
      systemPrompt: systemPrompt + `\n\n注意：本次输出不需要 JSON，请直接输出 Markdown 文章内容。`,
      userPrompt,
      temperature: 0.3,
    }, () => true);

    // 取第一项的原文内容
    const raw = result.rawResponse || "";
    if (!raw || raw.trim().length < 100) {
      throw new Error("AI 返回内容太短");
    }

    return raw.trim();
  }

  /**
   * 通过采集流水线把 AI 知识保存到 Wiki
   */
  private async saveAsWikiViaWorkflow(
    plugin: any,
    skill: SkillRequirement,
    knowledge: string,
  ): Promise<void> {
    // 把 AI 知识包装成对话格式 → 走 processConversation 流水线
    const fakeContent = `## 用户\n请详细讲解 ${skill.skill}（${skill.category}）的核心知识点和面试要点。\n\n## AI\n${knowledge}`;

    // 静默处理（不打开任务中心，不弹通知）
    await this.silentProcessConversation(plugin, {
      source: "AI增强盘点",
      title: skill.skill,
      pageTitle: `${skill.skill}`,
      url: "",
      content: fakeContent,
    });
  }

  /**
   * 静默版本的 processConversation
   * 不打开任务中心、不切换 Tab、不弹大通知
   */
  private async silentProcessConversation(plugin: any, payload: any): Promise<void> {
    plugin.taskStore.reset();

    try {
      await plugin.initializeStructure();

      const rounds = plugin.parseRounds(payload.content);
      if (rounds.length === 0) return;

      const rawPath = await this.callPrivate(plugin, "saveRawConversationMerged", rounds, payload);
      for (const r of rounds) {
        r.rawPath = rawPath;
        r.anchor = `round-${r.round}`;
      }

      const actions = await plugin.workflowEngine.runPipeline(rounds, payload);

      // 直接执行所有 actions（不走审核模式）
      for (const a of actions) {
        try {
          await plugin.executor.execute(a, rounds, payload);
        } catch (e) {
          this.logger(`⚠️ ${a.title} 执行失败：${e}`);
        }
      }
    } catch (e) {
      this.logger(`❌ AI 知识保存失败：${e}`);
      throw e;
    }
  }

  /**
   * 调用 plugin 的私有方法的辅助函数
   */
  private callPrivate(obj: any, methodName: string, ...args: any[]): any {
    const method = obj[methodName];
    if (typeof method === "function") {
      return method.call(obj, ...args);
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════
  // 单技能本地分析（原有方法）
  // ════════════════════════════════════════════════════════════
  private async analyzeSkill(skill: SkillRequirement): Promise<void> {
    const queries = skill.keywords.length > 0 ? skill.keywords : [skill.skill];

    let bestScore = 0;
    let allMatchedPaths = new Set<string>();

    for (const query of queries) {
      try {
        const results = await this.semanticSearch.searchForRAG(query, 5, 0.4);
        if (results.length === 0) continue;

        const queryTopScore = results[0].score;
        if (queryTopScore > bestScore) {
          bestScore = queryTopScore;
        }

        for (const r of results.slice(0, 3)) {
          allMatchedPaths.add(r.chunk.path);
        }
      } catch (e) {
        continue;
      }
    }

    let status: SkillStatus;
    if (bestScore >= this.MASTERED_THRESHOLD) {
      status = "mastered";
    } else if (bestScore >= this.PARTIAL_THRESHOLD) {
      status = "partial";
    } else {
      status = "missing";
    }

    skill.status = status;
    skill.coverage = Math.round(bestScore * 100) / 100;
    skill.matchedPages = Array.from(allMatchedPaths).slice(0, 5);
  }

  // ════════════════════════════════════════════════════════════
  // 总结文字生成
  // ════════════════════════════════════════════════════════════
  private buildSummary(data: {
    position: string;
    total: number;
    mastered: number;
    partial: number;
    missing: number;
    requiredTotal: number;
    requiredMissingNames: string[];
    overallReadiness: number;
  }): string {
    const pct = (data.overallReadiness * 100).toFixed(0);

    let summary = `针对「${data.position}」的整体准备度约 ${pct}%。\n\n`;

    summary += `📊 **技能盘点（共 ${data.total} 项）**：\n`;
    summary += `- ✅ 已掌握：${data.mastered} 项\n`;
    summary += `- 🟡 部分掌握：${data.partial} 项\n`;
    summary += `- ❌ 缺失：${data.missing} 项\n\n`;

    if (data.requiredMissingNames.length > 0) {
      summary += `⚠️ **硬性要求中的缺失项**（建议优先补齐）：\n`;
      summary += data.requiredMissingNames.map((s) => `- ${s}`).join("\n");
      summary += "\n\n";
    }

    if (data.overallReadiness >= 0.8) {
      summary += `💪 **结论**：整体准备充分，可以投递。建议巩固薄弱项即可。`;
    } else if (data.overallReadiness >= 0.6) {
      summary += `📚 **结论**：基础不错，但仍有补强空间。建议针对缺失项突击 1-2 周。`;
    } else if (data.overallReadiness >= 0.4) {
      summary += `⏳ **结论**：核心技能有一定差距，建议系统学习 3-4 周后再投递。`;
    } else {
      summary += `🔧 **结论**：与目标差距较大，建议先完成系统性学习再考虑该方向。`;
    }

    return summary;
  }
}