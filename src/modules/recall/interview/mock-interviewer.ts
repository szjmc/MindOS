import {
  JDAnalysis,
  SkillRequirement,
  InterviewQuestion,
  AnswerEvaluation,
  MindOSSettings,
} from "../../../core/types";
import { generateUID, sleep } from "../../../core/utils";
import { AICardGenerator } from "../core/ai-card-generator";
import { InterviewStore } from "./interview-store";
import { SemanticSearch } from "../../retrieve/semantic-search";

export interface GenerateQuestionsOptions {
  jdId: string;
  totalCount: number;               // 总题数
  focusOnWeakness?: boolean;         // 是否重点出薄弱项
  categories?: string[];             // 限定题型
  difficulty?: "easy" | "medium" | "hard" | "mixed";
}

export interface GenerateQuestionsProgress {
  total: number;
  done: number;
  currentBatch: string;
}

/**
 * 模拟面试核心引擎
 *
 * 职责：
 *  1. 基于 JD + 用户知识库，生成针对性面试题
 *  2. 评估用户答案：对比参考答案 + Wiki 内容，给出点评
 */
export class MockInterviewer {
  constructor(
    private getSettings: () => MindOSSettings,
    private aiGenerator: AICardGenerator,
    private interviewStore: InterviewStore,
    private semanticSearch: SemanticSearch,
    private logger: (msg: string) => void,
  ) {}

  // ════════════════════════════════════════════════════════════
  // 生成模拟题
  // ════════════════════════════════════════════════════════════
  async generateQuestions(
    opts: GenerateQuestionsOptions,
    onProgress?: (p: GenerateQuestionsProgress) => void,
  ): Promise<InterviewQuestion[]> {
    const jd = await this.interviewStore.getById(opts.jdId);
    if (!jd) throw new Error(`JD 不存在：${opts.jdId}`);

    if (jd.skills.length === 0) {
      throw new Error("该 JD 没有提取出任何技能，无法生成题目");
    }

    this.logger(`ℹ️ 开始生成模拟题：${jd.position}（目标 ${opts.totalCount} 题）`);

    // 决定每个技能出几道题
    const taskList = this.distributeQuestions(jd, opts);

    const progress: GenerateQuestionsProgress = {
      total: taskList.length,
      done: 0,
      currentBatch: "",
    };
    onProgress?.(progress);

    const allQuestions: InterviewQuestion[] = [];

    for (const task of taskList) {
      progress.currentBatch = task.skill?.skill ?? task.category;
      onProgress?.(progress);

      try {
        const questions = await this.generateForTask(jd, task);
        allQuestions.push(...questions);
        await sleep(500);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger(`❌ 题目生成失败 [${progress.currentBatch}]: ${msg}`);
      }

      progress.done++;
      onProgress?.(progress);
    }

    // 截断到目标数量（AI 可能生成略多）
    const finalQuestions = allQuestions.slice(0, opts.totalCount);

    // 持久化到 JD
    jd.questions = finalQuestions;
    await this.interviewStore.save(jd);

    this.logger(`✅ 模拟题生成完成：共 ${finalQuestions.length} 题`);
    return finalQuestions;
  }

  // ════════════════════════════════════════════════════════════
  // 任务分配：决定每个技能/类型出多少题
  // ════════════════════════════════════════════════════════════
  private distributeQuestions(
    jd: JDAnalysis,
    opts: GenerateQuestionsOptions,
  ): Array<{ skill?: SkillRequirement; category: string; count: number; difficulty: string }> {
    const tasks: Array<{ skill?: SkillRequirement; category: string; count: number; difficulty: string }> = [];

    // 30% 行为面试题 + 70% 技术题（如果有技术技能）
    const techCount = Math.max(1, Math.floor(opts.totalCount * 0.7));
    const behaviorCount = opts.totalCount - techCount;

    // 行为面试题（独立任务）
    if (behaviorCount > 0) {
      tasks.push({
        category: "行为面试",
        count: behaviorCount,
        difficulty: "medium",
      });
    }

    // 技术题：按技能权重分配
    let candidateSkills = [...jd.skills];

    // 重点关注薄弱项
    if (opts.focusOnWeakness) {
      const missing = candidateSkills.filter((s) => s.status === "missing");
      const partial = candidateSkills.filter((s) => s.status === "partial");
      const mastered = candidateSkills.filter((s) => s.status === "mastered");

      // 薄弱项权重高：missing > partial > mastered
      // 重新排序，前面的优先出题
      candidateSkills = [...missing, ...partial, ...mastered];
    } else {
      // 必需技能优先
      candidateSkills.sort((a, b) => {
        if (a.required !== b.required) return a.required ? -1 : 1;
        return 0;
      });
    }

    // 取出前 N 个技能（每技能 1-3 题）
    const skillsToUse = candidateSkills.slice(0, Math.min(techCount, candidateSkills.length));
    const questionsPerSkill = Math.max(1, Math.ceil(techCount / skillsToUse.length));
    let remaining = techCount;

    for (const skill of skillsToUse) {
      const count = Math.min(questionsPerSkill, remaining);
      if (count <= 0) break;

      tasks.push({
        skill,
        category: this.deriveQuestionCategory(skill),
        count,
        difficulty: this.deriveDifficulty(skill, opts.difficulty ?? "mixed"),
      });

      remaining -= count;
    }

    return tasks;
  }

  private deriveQuestionCategory(skill: SkillRequirement): string {
    const cat = skill.category.toLowerCase();
    if (cat.includes("算法")) return "算法题";
    if (cat.includes("架构") || cat.includes("设计")) return "系统设计";
    if (cat.includes("软技能")) return "行为面试";
    return "技术深度";
  }

  private deriveDifficulty(
    skill: SkillRequirement,
    requested: string,
  ): "easy" | "medium" | "hard" {
    if (requested !== "mixed") return requested as any;

    if (skill.level === "expert") return "hard";
    if (skill.level === "advanced") return "hard";
    if (skill.level === "basic") return "easy";
    return "medium";
  }

  // ════════════════════════════════════════════════════════════
  // 单批次生成
  // ════════════════════════════════════════════════════════════
  private async generateForTask(
    jd: JDAnalysis,
    task: { skill?: SkillRequirement; category: string; count: number; difficulty: string },
  ): Promise<InterviewQuestion[]> {
    const isBehavior = task.category === "行为面试";

    let systemPrompt: string;
    let userPrompt: string;

    if (isBehavior) {
      systemPrompt = `你是资深技术面试官。请生成行为面试题（不涉及具体技术）。

输出严格 JSON：
{
  "questions": [
    {
      "category": "行为面试",
      "difficulty": "easy|medium|hard",
      "question": "完整问题",
      "hints": ["提示1"],
      "referenceAnswer": "参考答案的核心思路（≤200字）",
      "followUps": ["可能的追问1", "可能的追问2"]
    }
  ]
}`;

      userPrompt = `请为「${jd.position}${jd.company ? " @ " + jd.company : ""}」职位生成 ${task.count} 道行为面试题。

要求：
1. 涵盖：项目经验、团队协作、冲突处理、学习能力、抗压能力等维度
2. 题目必须能引导出 STAR 格式回答（情境-任务-行动-结果）
3. 参考答案给出回答的核心思路框架，而不是具体例子`;
    } else {
      const skill = task.skill!;

      // 检索 Wiki 中相关内容，提供给 AI 作为出题参考
      let wikiContext = "";
      try {
        const results = await this.semanticSearch.searchForRAG(skill.skill, 3, 0.4);
        if (results.length > 0) {
          wikiContext = "\n\n候选人 Wiki 中相关内容（出题参考）：\n";
          for (const r of results.slice(0, 3)) {
            wikiContext += `\n- ${r.chunk.fileTitle} > ${r.chunk.section}：${r.chunk.text.substring(0, 200)}...`;
          }
        }
      } catch {
        // 检索失败不影响出题
      }

      systemPrompt = `你是资深技术面试官，专精于 ${skill.category} 方向。

输出严格 JSON：
{
  "questions": [
    {
      "category": "${task.category}",
      "skill": "${skill.skill}",
      "difficulty": "easy|medium|hard",
      "question": "完整问题（清晰、明确）",
      "hints": ["回答时的关键提示"],
      "referenceAnswer": "完整的参考答案（用 Markdown，可包含代码、列表）",
      "followUps": ["可能的追问1", "可能的追问2"]
    }
  ]
}`;

      const statusHint = skill.status === "missing"
        ? "（候选人 Wiki 中无该技能的笔记，建议出基础题让其暴露问题）"
        : skill.status === "partial"
        ? "（候选人有部分相关知识，建议出中等深度题）"
        : "（候选人有相关笔记，可以出有挑战的题）";

      userPrompt = `请生成 ${task.count} 道关于「${skill.skill}」的面试题。

技能信息：
- 技能：${skill.skill}
- 分类：${skill.category}
- 期望水平：${skill.level}
- 是否必需：${skill.required ? "是" : "否（加分项）"}
- 难度：${task.difficulty}
${statusHint}
${wikiContext}

要求：
1. 题目必须考察真实理解，避免死记硬背
2. 参考答案要详细完整，可作为复习材料
3. 包含 1-2 个追问，模拟面试官深挖`;
    }

    try {
      const items = await this.aiGenerator.generateSimple<any>(
        systemPrompt,
        userPrompt,
        0.4,
      );

      return items
        .filter((it: any) => it?.question && it?.referenceAnswer)
        .map((it: any) => this.normalizeQuestion(it, task));
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e));
    }
  }

  private normalizeQuestion(
    raw: any,
    task: { skill?: SkillRequirement; category: string; count: number; difficulty: string },
  ): InterviewQuestion {
    return {
      id: `q_${generateUID()}`,
      category: String(raw.category ?? task.category),
      skill: raw.skill ?? task.skill?.skill,
      difficulty: ["easy", "medium", "hard"].includes(raw.difficulty)
        ? raw.difficulty
        : "medium",
      question: String(raw.question).trim(),
      hints: Array.isArray(raw.hints) ? raw.hints.map(String) : [],
      referenceAnswer: String(raw.referenceAnswer).trim(),
      followUps: Array.isArray(raw.followUps) ? raw.followUps.map(String) : [],
    };
  }

  // ════════════════════════════════════════════════════════════
  // 评估答案
  // ════════════════════════════════════════════════════════════
  async evaluateAnswer(
    question: InterviewQuestion,
    userAnswer: string,
  ): Promise<AnswerEvaluation> {
    const cleanAnswer = userAnswer.trim();
    if (!cleanAnswer) {
      throw new Error("答案为空");
    }

    this.logger(`ℹ️ 评估答案：${question.question.substring(0, 30)}...`);

    const systemPrompt = `你是资深技术面试官，正在评估候选人的回答。

输出严格 JSON：
{
  "score": 0-100,
  "strengths": ["答得好的点1", "答得好的点2"],
  "weaknesses": ["不足之处1", "不足之处2"],
  "improvements": ["具体改进建议1", "具体改进建议2"],
  "modelAnswer": "如果回答得很差(<60分)，给出一个完整的模范答案；否则留空字符串",
  "followUpHints": ["建议候选人主动展开的追问方向"]
}

评分标准：
- 90-100：完美回答，超出预期
- 80-89：优秀，基本完整正确
- 70-79：良好，主要点都答到了
- 60-69：及格，有正确理解但不够深入
- 40-59：不足，有明显遗漏或错误
- 0-39：差，基本没答到点子上`;

    const userPrompt = `请评估以下回答：

═══ 题目 ═══
分类：${question.category}${question.skill ? " · " + question.skill : ""}
难度：${question.difficulty}

${question.question}

═══ 参考答案 ═══

${question.referenceAnswer}

═══ 候选人回答 ═══

${cleanAnswer}

═══════════════

请客观、专业地评估。重点看：
1. 是否抓住了核心要点
2. 表述是否清晰准确
3. 是否有错误的理解
4. 深度是否符合题目难度

输出严格的 JSON。`;

    try {
      const result = await this.aiGenerator.generateSimple<any>(
        systemPrompt,
        userPrompt,
        0.2,
      );

      const data = Array.isArray(result) ? result[0] : result;
      if (!data) throw new Error("AI 未返回评估结果");

      return {
        score: this.clampScore(data.score),
        strengths: Array.isArray(data.strengths) ? data.strengths.map(String) : [],
        weaknesses: Array.isArray(data.weaknesses) ? data.weaknesses.map(String) : [],
        improvements: Array.isArray(data.improvements) ? data.improvements.map(String) : [],
        modelAnswer: data.modelAnswer ? String(data.modelAnswer).trim() : undefined,
        followUpHints: Array.isArray(data.followUpHints) ? data.followUpHints.map(String) : [],
      };
    } catch (e) {
      throw new Error(`评估失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private clampScore(raw: any): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  }
}