import { requestUrl } from "obsidian";
import {
  MindOSSettings,
  ConversationRound,
  RoundCluster,
  DraftDoc,
  DiffDecision,
  CandidatePage,
} from "../../core/types";
import { sleep, normalizeText } from "../../core/utils";
import { PAGE_TYPE_DIRS } from "../../core/constants";

export class AIClient {
  constructor(
    private getSettings: () => MindOSSettings,
    private getClaudeMd: () => Promise<string>,
    private getIndexMd: () => Promise<string>,
    private logger: (msg: string) => void,
  ) {}

  async clusterRounds(rounds: ConversationRound[]): Promise<RoundCluster[]> {
    if (rounds.length === 0) return [];

    if (rounds.length === 1) {
      return [{
        id: "c1",
        rounds: [rounds[0].round],
        topic: this.shortPreview(rounds[0].user, 30),
        reason: "单回合，无需聚类",
      }];
    }

    const systemPrompt = await this.buildSystemPrompt(false);
    const userPrompt = this.buildClusterPrompt(rounds);
    const raw = await this.callApiWithRetry(systemPrompt, userPrompt);

    return this.parseClusterResponse(raw, rounds);
  }

  private buildClusterPrompt(rounds: ConversationRound[]): string {
    const summaries = rounds.map((r) =>
      `【回合 ${r.round}】\n用户问：${this.shortPreview(r.user, 200)}\nAI答：${this.shortPreview(r.ai, 200)}`
    ).join("\n\n");

    return `请对以下多回合 AI 对话进行【严格聚类】。

聚类原则（严格模式）：
- 只有讨论的是【完全相同的主题/对象】才合并到同一组
- 例如：3 个回合都在问 chmod → 合并；问 chmod 和问 chown → 不合并
- 宁可拆细，不可错合
- 单独的回合自成一组

══════════ 对话回合 ══════════

${summaries}

══════════════════════════════

请输出严格 JSON（不要代码块包裹，不要任何额外文字）：

{
  "clusters": [
    {
      "id": "c1",
      "rounds": [1, 2],
      "topic": "本组核心主题（10字内）",
      "reason": "为何合并（1句）"
    }
  ]
}`;
  }

  private parseClusterResponse(raw: string, rounds: ConversationRound[]): RoundCluster[] {
    const json = this.stripJsonWrap(raw);
    let parsed: any;
    try { parsed = JSON.parse(json); }
    catch { throw new Error("聚类阶段：AI 输出无法解析为 JSON"); }

    const clusters = Array.isArray(parsed?.clusters) ? parsed.clusters : [];
    const result: RoundCluster[] = [];
    const allRoundNums = new Set(rounds.map((r) => r.round));
    const usedRoundNums = new Set<number>();

    for (const c of clusters) {
      const id = String(c?.id ?? `c${result.length + 1}`);
      const roundNums = (Array.isArray(c?.rounds) ? c.rounds : [])
        .map((n: any) => parseInt(n))
        .filter((n: number) => allRoundNums.has(n) && !usedRoundNums.has(n));
      if (roundNums.length === 0) continue;

      roundNums.forEach((n: number) => usedRoundNums.add(n));
      result.push({
        id,
        rounds: roundNums,
        topic: String(c?.topic ?? "未命名"),
        reason: String(c?.reason ?? ""),
      });
    }

    for (const r of rounds) {
      if (!usedRoundNums.has(r.round)) {
        result.push({
          id: `c${result.length + 1}`,
          rounds: [r.round],
          topic: this.shortPreview(r.user, 30),
          reason: "AI 未分组，自动独立",
        });
      }
    }

    return result;
  }

  async draftFromCluster(cluster: RoundCluster, rounds: ConversationRound[]): Promise<DraftDoc> {
    const clusterRounds = rounds.filter((r) => cluster.rounds.includes(r.round));
    if (clusterRounds.length === 0) throw new Error(`聚类 ${cluster.id} 无对应回合`);

    const systemPrompt = await this.buildSystemPrompt(true);
    const userPrompt = this.buildDraftPrompt(cluster, clusterRounds);
    const raw = await this.callApiWithRetry(systemPrompt, userPrompt);

    return this.parseDraftResponse(raw, cluster);
  }

  private buildDraftPrompt(cluster: RoundCluster, clusterRounds: ConversationRound[]): string {
    const blocks = clusterRounds.map((r) =>
      `【回合 ${r.round}】\n## 用户\n${r.user || "(空)"}\n\n## AI\n${r.ai || "(空)"}`
    ).join("\n\n──────────\n\n");

    return `请基于以下相关回合，整理成结构化知识草稿。

聚类主题：${cluster.topic}
回合范围：${cluster.rounds.join(", ")}

════════ 对话内容 ════════

${blocks}

══════════════════════════

请输出严格 JSON（不要代码块包裹）：

{
  "title": "页面标题（精简、可检索）",
  "brief": "一句话简介（≤30字）",
  "pageType": "entity" | "concept" | "topic" | "comparison" | "overview",
  "tags": ["标签1", "标签2"],
  "blocks": [
    {
      "heading": "## 章节标题",
      "content": "该章节的 Markdown 正文（不含标题行）",
      "sourceRounds": [1, 2]
    }
  ]
}

要求：
- blocks 按内容章节拆分，每块对应一个二级标题（## ）
- 每块标注 sourceRounds（来自哪些回合）
- 不重复、不臆测、只整理对话原文中的干货
- 表格、代码、命令必须原样保留`;
  }

  private parseDraftResponse(raw: string, cluster: RoundCluster): DraftDoc {
    const json = this.stripJsonWrap(raw);
    let parsed: any;
    try { parsed = JSON.parse(json); }
    catch { throw new Error("草稿阶段：AI 输出无法解析为 JSON"); }

    const pageType = String(parsed?.pageType ?? "concept");
    const validType = PAGE_TYPE_DIRS[pageType] ? pageType : "concept";

    const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : [];
    const draftBlocks = blocks.map((b: any) => ({
      heading: String(b?.heading ?? "## 内容").trim(),
      content: normalizeText(String(b?.content ?? "")),
      sourceRounds: Array.isArray(b?.sourceRounds)
        ? b.sourceRounds.map((n: any) => parseInt(n)).filter((n: number) => !isNaN(n))
        : cluster.rounds,
    })).filter((b: any) => b.content);

    return {
      clusterId: cluster.id,
      title: String(parsed?.title ?? cluster.topic).trim() || "未命名",
      brief: String(parsed?.brief ?? "").trim(),
      pageType: validType as any,
      tags: Array.isArray(parsed?.tags) ? parsed.tags.map((t: any) => String(t)) : [],
      blocks: draftBlocks,
      sourceRounds: cluster.rounds,
    };
  }

  async diffWithCandidates(
    draft: DraftDoc,
    candidates: Array<{ candidate: CandidatePage; content: string }>,
  ): Promise<DiffDecision> {
    if (candidates.length === 0) {
      return { type: "create", reason: "现有 Wiki 无相关页面", draft };
    }

    const systemPrompt = await this.buildSystemPrompt(false);
    const userPrompt = this.buildDiffPrompt(draft, candidates);
    const raw = await this.callApiWithRetry(systemPrompt, userPrompt);

    return this.parseDiffResponse(raw, draft);
  }

  private buildDiffPrompt(
    draft: DraftDoc,
    candidates: Array<{ candidate: CandidatePage; content: string }>,
  ): string {
    const draftStr = JSON.stringify({
      title: draft.title,
      brief: draft.brief,
      pageType: draft.pageType,
      tags: draft.tags,
      blocks: draft.blocks.map((b) => ({ heading: b.heading, content: b.content })),
    }, null, 2);

    const candStr = candidates.map((c, i) =>
      `【候选 ${i + 1}】路径：${c.candidate.meta.path}\n标题：${c.candidate.meta.title}\n相似度：${c.candidate.score}（${c.candidate.reason}）\n──── 完整内容 ────\n${c.content.substring(0, 3000)}`
    ).join("\n\n══════════\n\n");

    return `请判断【新草稿】与【现有候选页面】的关系。

══════ 新草稿 ══════
${draftStr}

══════ 候选已有页面 ══════
${candStr}

══════════════════════════

请输出严格 JSON：

{
  "type": "merge" | "create" | "discard",
  "targetPath": "merge 时填候选页面 path",
  "newBlocks": [
    {
      "heading": "## 章节标题",
      "content": "仅【新增的、目标页面没有的】内容",
      "sourceRounds": [1, 2]
    }
  ],
  "reason": "决策理由（1-2 句）"
}

判断规则：
- merge：同主题，且【有新增内容】 → 仅追加新增点
- create：候选不是同主题（标题相似但实质不同） → 新建
- discard：候选已完整覆盖新草稿 → 丢弃

注意：
- merge 时 newBlocks 仅包含【真正新增】的内容
- 严格、不臆测`;
  }

  private parseDiffResponse(raw: string, draft: DraftDoc): DiffDecision {
    const json = this.stripJsonWrap(raw);
    let parsed: any;
    try { parsed = JSON.parse(json); }
    catch { throw new Error("差异阶段：AI 输出无法解析为 JSON"); }

    const type = String(parsed?.type ?? "create") as any;
    if (!["merge", "create", "discard"].includes(type)) {
      return { type: "create", reason: "AI 返回 type 无效，默认 create", draft };
    }

    const newBlocks = Array.isArray(parsed?.newBlocks)
      ? parsed.newBlocks.map((b: any) => ({
          heading: String(b?.heading ?? "## 追加").trim(),
          content: normalizeText(String(b?.content ?? "")),
          sourceRounds: Array.isArray(b?.sourceRounds)
            ? b.sourceRounds.map((n: any) => parseInt(n)).filter((n: number) => !isNaN(n))
            : draft.sourceRounds,
        })).filter((b: any) => b.content)
      : [];

    return {
      type,
      targetPath: parsed?.targetPath ? String(parsed.targetPath) : undefined,
      newBlocks: type === "merge" ? newBlocks : undefined,
      reason: String(parsed?.reason ?? ""),
      draft,
    };
  }

  async generateBrief(title: string, body: string, maxLen: number): Promise<string> {
    const systemPrompt = `你是 Wiki 维护助手。请为给定页面生成一句话简介（严格 ≤ ${maxLen} 字），只输出简介本身，无任何前缀后缀。`;
    const userPrompt = `标题：${title}\n\n正文：\n${body.substring(0, 2000)}\n\n请直接输出一句话简介（严格 ≤ ${maxLen} 字）：`;
    const raw = await this.callApiWithRetry(systemPrompt, userPrompt);
    return raw.trim().split("\n")[0].slice(0, maxLen);
  }

  private async buildSystemPrompt(includeIndex: boolean): Promise<string> {
    const s = this.getSettings();
    const parts: string[] = [BASE_SYSTEM_PROMPT];

    if (s.injectClaudeMd) {
      const claude = await this.getClaudeMd();
      if (claude) {
        parts.push("\n══════════════ schema/CLAUDE.md ══════════════\n");
        parts.push(claude);
      }
    }

    if (includeIndex && s.injectIndexMd) {
      const index = await this.getIndexMd();
      if (index) {
        parts.push("\n══════════════ wiki/INDEX.md ══════════════\n");
        parts.push(index);
      }
    }

    return parts.join("\n");
  }

  private async callApiWithRetry(systemPrompt: string, userPrompt: string): Promise<string> {
    const s = this.getSettings();
    if (!s.apiBaseUrl || !s.apiKey || !s.model) {
      throw new Error("请先在 MindOS 设置中填写 API Base URL / API Key / Model");
    }

    const endpoint = `${s.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    const maxRetries = Math.max(0, s.maxRetries);
    let lastError: Error = new Error("未知错误");

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 2000;
        this.logger(`ℹ️ 第 ${attempt} 次重试（${delay / 1000}s 后）`);
        await sleep(delay);
      }

      try {
        const response = await requestUrl({
          url: endpoint,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.apiKey}`,
          },
          body: JSON.stringify({
            model: s.model,
            temperature: s.temperature,
            stream: false,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
          }),
        });

        if (response.status === 401) throw new Error("401 invalid_api_key");
        if (response.status === 402) throw new Error("402 insufficient_quota");
        if (response.status >= 400) throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.json).slice(0, 200)}`);

        const data = response.json as Record<string, unknown>;
        const content = this.extractContent(data);
        if (!content) throw new Error("模型返回为空");
        return content;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (
          lastError.message.includes("401") ||
          lastError.message.includes("402") ||
          lastError.message.includes("invalid_api_key") ||
          lastError.message.includes("insufficient_quota")
        ) throw lastError;
      }
    }
    throw lastError;
  }

  private extractContent(data: Record<string, unknown>): string {
    const choices = data?.choices as Array<Record<string, unknown>> | undefined;
    const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
    const c = msg?.content;
    if (typeof c === "string") return c.trim();
    if (Array.isArray(c)) {
      return c.map((it: any) => (typeof it === "string" ? it : it?.text ?? "")).join("").trim();
    }
    return "";
  }

  private stripJsonWrap(raw: string): string {
    let s = raw.trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    if (!s.startsWith("{")) {
      const m = s.match(/\{[\s\S]*\}/);
      if (m) s = m[0];
    }
    return s;
  }

  private shortPreview(text: string, maxLen = 100): string {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return clean.substring(0, maxLen) + "…";
  }
}

const BASE_SYSTEM_PROMPT = `你是 MindOS 的知识维护者，遵循 Karpathy 的 LLM Wiki 三层架构：
- raw/ 是事实基准，只读不写
- wiki/ 是你全权维护的知识层
- schema/ 是人类的规则，必须严格遵守

你的工作分为四阶段：
1. 聚类：判断哪些回合在讨论同一主题
2. 整理：把同主题回合整理成草稿（按章节拆 blocks）
3. 比对：对比草稿与现有页面，决定 merge/create/discard
4. 执行：插件根据决策自动执行

每次调用只完成被要求的那一步，输出严格 JSON。`;