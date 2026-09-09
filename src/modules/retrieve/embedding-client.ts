import { requestUrl } from "obsidian";
import { MindOSSettings } from "../../core/types";
import { sleep } from "../../core/utils";

export interface EmbeddingResult {
  vectors: number[][];
  totalTokens: number;
}

export class EmbeddingClient {
  constructor(
    private getSettings: () => MindOSSettings,
    private logger: (msg: string) => void,
  ) {}

  /**
   * 批量获取 embedding
   */
  async embed(texts: string[]): Promise<EmbeddingResult> {
    const s = this.getSettings();
    if (!s.embeddingApiBaseUrl || !s.embeddingApiKey || !s.embeddingModel) {
      throw new Error("Embedding API 未配置（请在设置中填写 Base URL / API Key / Model）");
    }
    if (texts.length === 0) {
      return { vectors: [], totalTokens: 0 };
    }

    const endpoint = `${s.embeddingApiBaseUrl.replace(/\/+$/, "")}/embeddings`;
    const maxRetries = Math.max(0, s.maxRetries);
    let lastError: Error = new Error("未知错误");

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = attempt * 2000;
        this.logger(`ℹ️ Embedding 第 ${attempt} 次重试（${delay / 1000}s 后）`);
        await sleep(delay);
      }

      try {
        const body: any = {
          model: s.embeddingModel,
          input: texts,
        };
        // 如果设置了维度且模型支持（OpenAI text-embedding-3 支持）
        if (s.embeddingDim > 0) {
          body.dimensions = s.embeddingDim;
        }

        const response = await requestUrl({
          url: endpoint,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${s.embeddingApiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (response.status === 401) throw new Error("401 invalid_api_key");
        if (response.status === 402) throw new Error("402 insufficient_quota");
        if (response.status >= 400) {
          throw new Error(`HTTP ${response.status}: ${JSON.stringify(response.json).slice(0, 300)}`);
        }

        return this.parseResponse(response.json, texts.length);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (
          lastError.message.includes("401") ||
          lastError.message.includes("402") ||
          lastError.message.includes("invalid_api_key") ||
          lastError.message.includes("insufficient_quota")
        ) {
          throw lastError;
        }
      }
    }
    throw lastError;
  }

  private parseResponse(data: any, expectedCount: number): EmbeddingResult {
    if (!data?.data || !Array.isArray(data.data)) {
      throw new Error("Embedding 响应格式错误：缺少 data 字段");
    }
    const sorted = [...data.data].sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = sorted.map((item: any) => {
      if (!Array.isArray(item.embedding)) {
        throw new Error("Embedding 响应格式错误：embedding 不是数组");
      }
      return item.embedding as number[];
    });

    if (vectors.length !== expectedCount) {
      throw new Error(`Embedding 返回数量不匹配：期望 ${expectedCount}，实际 ${vectors.length}`);
    }

    const totalTokens = data.usage?.total_tokens ?? data.usage?.prompt_tokens ?? 0;

    return { vectors, totalTokens };
  }

  /**
   * 测试连接（仅嵌入一个短文本）
   */
  async test(): Promise<{ success: boolean; message: string; dim?: number }> {
    try {
      const r = await this.embed(["测试文本"]);
      if (r.vectors.length > 0 && r.vectors[0].length > 0) {
        return {
          success: true,
          message: `✅ 连接成功，向量维度：${r.vectors[0].length}`,
          dim: r.vectors[0].length,
        };
      }
      return { success: false, message: "返回为空" };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}