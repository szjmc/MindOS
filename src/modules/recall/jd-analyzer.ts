import { JDAnalysis, SkillRequirement, SkillLevel } from "../../core/types";
import { AICardGenerator } from "./ai-card-generator";
import { InterviewStore } from "./interview-store";

export interface JDAnalyzeOptions {
  rawText: string;
  company?: string;
  position?: string;
}

/**
 * JD（招聘信息）解析器
 *
 * 工作流程：
 *  1. 接收用户粘贴的 JD 原文
 *  2. AI 提取：公司/职位/职责/要求/技能清单/加分项
 *  3. 持久化为 JDAnalysis 对象
 */
export class JDAnalyzer {
  constructor(
    private aiGenerator: AICardGenerator,
    private interviewStore: InterviewStore,
    private logger: (msg: string) => void,
  ) {}

  // ════════════════════════════════════════════════════════════
  // 主入口
  // ════════════════════════════════════════════════════════════
  async analyze(opts: JDAnalyzeOptions): Promise<JDAnalysis> {
    const rawText = opts.rawText.trim();
    if (!rawText) {
      throw new Error("JD 内容为空");
    }
    if (rawText.length < 30) {
      throw new Error("JD 内容太短，请提供完整的职位描述");
    }

    this.logger(`ℹ️ 开始解析 JD（${rawText.length} 字符）`);

    const systemPrompt = `你是资深技术招聘官，擅长从招聘信息（JD）中提取关键信息。

请严格按以下 JSON 格式输出：
{
  "company": "公司名称",
  "position": "职位名称（清晰简洁）",
  "level": "初级/中级/高级/资深/专家",
  "location": "工作地点",
  "salary": "薪资范围",
  "description": "职位概述（一段话，≤100字）",
  "responsibilities": ["职责1", "职责2", "职责3"],
  "requirements": ["要求1", "要求2"],
  "skills": [
    {
      "skill": "技能/知识点名（精简）",
      "category": "编程语言|框架|数据库|工具|云平台|架构|算法|软技能|领域知识|其他",
      "required": true,
      "level": "basic|intermediate|advanced|expert",
      "keywords": ["关键词1", "关键词2"]
    }
  ],
  "niceToHave": ["加分项1", "加分项2"]
}`;

    const userPrompt = `请解析以下 JD：

═══════ JD 原文 ═══════

${rawText}

═══════════════════════

提取规则：
1. **skills 列表非常重要**：要列出所有具体的技术栈、知识点（如 React、Docker、TCP/IP、设计模式等）
2. skill 名称要精简（如 "Kubernetes" 而非 "Kubernetes 容器编排"）
3. **每个 skill 必须有 keywords**：用于匹配候选人的知识库（含中英文别名、缩写）
   - 例如 K8s 的 keywords: ["Kubernetes", "K8s", "容器编排"]
   - 例如 OOP 的 keywords: ["面向对象", "OOP", "Object-Oriented"]
4. required：硬性要求 true，加分项 false（加分项也放 niceToHave）
5. level：根据 JD 中"熟悉/精通/深入理解"等字眼判断
6. 如果信息缺失，相应字段输出空字符串或空数组`;

    let parsed: any;
    try {
      const result = await this.aiGenerator.generateSimple<any>(
        systemPrompt,
        userPrompt,
        0.2,
      );

      // 容错：可能是单对象包装为数组，或直接对象
      parsed = Array.isArray(result) && result.length > 0 ? result[0] : result;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("AI 返回结构无效");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger(`❌ JD 解析失败：${msg}`);
      throw new Error(`AI 解析失败：${msg}`);
    }

    // 数据清洗与规整
    const skills: SkillRequirement[] = (Array.isArray(parsed.skills) ? parsed.skills : [])
      .map((s: any) => this.normalizeSkill(s))
      .filter((s: SkillRequirement) => s.skill);

    const jd = await this.interviewStore.create({
      company: opts.company || parsed.company || "",
      position: opts.position || parsed.position || "未命名职位",
      level: parsed.level || "",
      location: parsed.location || "",
      salary: parsed.salary || "",
      rawText,
      description: parsed.description || "",
      responsibilities: Array.isArray(parsed.responsibilities)
        ? parsed.responsibilities.filter(Boolean)
        : [],
      requirements: Array.isArray(parsed.requirements)
        ? parsed.requirements.filter(Boolean)
        : [],
      skills,
      niceToHave: Array.isArray(parsed.niceToHave)
        ? parsed.niceToHave.filter(Boolean)
        : [],
    });

    this.logger(`✅ JD 解析完成：${jd.position} | ${skills.length} 个技能`);
    return jd;
  }

  /**
   * 规整单个技能数据
   */
  private normalizeSkill(raw: any): SkillRequirement {
    const validLevels: SkillLevel[] = ["basic", "intermediate", "advanced", "expert"];
    const level: SkillLevel = validLevels.includes(raw?.level)
      ? raw.level
      : "intermediate";

    const skill = String(raw?.skill ?? "").trim();

    let keywords: string[] = [];
    if (Array.isArray(raw?.keywords)) {
      keywords = raw.keywords.map((k: any) => String(k).trim()).filter(Boolean);
    }
    // 至少包含技能名本身
    if (skill && !keywords.includes(skill)) {
      keywords.unshift(skill);
    }

    return {
      skill,
      category: String(raw?.category ?? "其他").trim(),
      required: raw?.required !== false,
      level,
      keywords,
    };
  }
}