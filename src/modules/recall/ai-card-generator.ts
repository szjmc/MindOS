import { requestUrl } from "obsidian";
import { MindOSSettings } from "../../core/types";
import { sleep } from "../../core/utils";
import { TokenEstimator } from "../retrieve/token-estimator";
import { QuotaManager } from "../retrieve/quota-manager";

export interface GenerateRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export interface GenerateResult<T> {
  data: T[];
  rawResponse: string;
  tokens: number;
}

/**
 * 通用 AI 卡片生成器
 *
 * 设计：抽出 Wiki 生成器中的通用 API 调用逻辑，
 * 任何场景（命令、单词、面试题等）只需提供自己的 Prompt 即可复用。
 */
export class AICardGenerator {
  constructor(
    private getSettings: () => MindOSSettings,
    private quotaManager: QuotaManager,
    private logger: (msg: string) => void,
  ) {}

  /**
   * 调用 AI 并解析为 JSON 数组
   *
   * @param request 请求参数
   * @param itemFilter 单条数据的有效性校验函数
   * @returns 解析后的数据数组
   */
  async generate<T = any>(
    request: GenerateRequest,
    itemFilter?: (item: any) => boolean,
  ): Promise<GenerateResult<T>> {
    const s = this.getSettings();
    if (!s.apiBaseUrl || !s.apiKey || !s.model) {
      throw new Error("请先配置 Chat 模型 API");
    }

    // 配额检查
    const estimated =
      TokenEstimator.estimate(request.systemPrompt) +
      TokenEstimator.estimate(request.userPrompt);
    const quotaCheck = await this.quotaManager.canConsume(estimated);
    if (!quotaCheck.allowed) {
      throw new Error(`配额不足：${quotaCheck.reason}`);
    }

    const raw = await this.callAPI(request);
    const items = this.parseResponse<T>(raw);
    const filtered = itemFilter ? items.filter(itemFilter) : items;

    // 估算 tokens（API 不一定返回）
    const tokens =
      TokenEstimator.estimate(request.systemPrompt) +
      TokenEstimator.estimate(request.userPrompt) +
      TokenEstimator.estimate(raw);

    const cost = TokenEstimator.estimateCost(tokens, s.costPerMillionTokensChat);
    await this.quotaManager.consume(tokens, cost);

    return {
      data: filtered,
      rawResponse: raw,
      tokens,
    };
  }

  /**
   * 简化版本：直接传 prompt 拿 JSON
   */
  async generateSimple<T = any>(
    systemPrompt: string,
    userPrompt: string,
    temperature: number = 0.3,
  ): Promise<T[]> {
    const result = await this.generate<T>({
      systemPrompt,
      userPrompt,
      temperature,
    });
    return result.data;
  }

  // ════════════════════════════════════════════════════════════
  // 底层 API 调用
  // ════════════════════════════════════════════════════════════
  private async callAPI(request: GenerateRequest): Promise<string> {
    const s = this.getSettings();
    const endpoint = `${s.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    const maxRetries = Math.max(0, s.maxRetries);
    let lastError: Error = new Error("未知错误");

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(attempt * 2000);
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
            temperature: request.temperature ?? 0.3,
            stream: false,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
          }),
        });

        if (response.status === 401) throw new Error("401 invalid_api_key");
        if (response.status === 402) throw new Error("402 insufficient_quota");
        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = response.json as any;
        const content = data?.choices?.[0]?.message?.content ?? "";
        if (!content) throw new Error("模型返回为空");
        return content;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (
          lastError.message.includes("401") ||
          lastError.message.includes("402")
        ) throw lastError;
      }
    }
    throw lastError;
  }

  // ════════════════════════════════════════════════════════════
  // JSON 解析（容错）
  // ════════════════════════════════════════════════════════════
  private parseResponse<T>(raw: string): T[] {
    let json = raw.trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    if (!json.startsWith("{") && !json.startsWith("[")) {
      const m = json.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) json = m[0];
    }

    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error(`AI 返回无法解析为 JSON：${e instanceof Error ? e.message : String(e)}`);
    }

    // 兼容多种结构：{cards: [...]} / {items: [...]} / [...] / {data: [...]}
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
    if (Array.isArray(parsed?.cards)) return parsed.cards as T[];
    if (Array.isArray(parsed?.items)) return parsed.items as T[];
    if (Array.isArray(parsed?.data))  return parsed.data as T[];
    if (Array.isArray(parsed?.list))  return parsed.list as T[];

    // 单对象作为数组返回
    if (typeof parsed === "object") return [parsed as T];

    return [];
  }
}