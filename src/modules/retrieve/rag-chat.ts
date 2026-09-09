import {
  MindOSSettings,
  ChatMessage,
  ChatSession,
  ChatCitation,
  SearchResult,
} from "../../core/types";
import { SemanticSearch } from "./semantic-search";
import { TokenEstimator } from "./token-estimator";
import { QuotaManager } from "./quota-manager";
import { sleep, nowISOString } from "../../core/utils";

export interface ChatStreamCallbacks {
  onStart?: () => void;
  onToken?: (delta: string) => void;
  onCitations?: (citations: ChatCitation[]) => void;
  onDone?: (fullContent: string, totalTokens: number) => void;
  onError?: (error: string) => void;
}

export class RAGChat {
  private abortController: AbortController | null = null;

  constructor(
    private getSettings: () => MindOSSettings,
    private semanticSearch: SemanticSearch,
    private quotaManager: QuotaManager,
    private logger: (msg: string) => void,
  ) {}

  /**
   * 主入口：基于会话上下文 + RAG 回答
   */
  async ask(
    session: ChatSession,
    userMessage: string,
    callbacks: ChatStreamCallbacks,
  ): Promise<void> {
    const s = this.getSettings();

    if (!s.apiBaseUrl || !s.apiKey || !s.model) {
      callbacks.onError?.("请先在设置中配置 Chat 模型");
      return;
    }

    // 1. 用户消息向量化 + 检索
    let citations: ChatCitation[] = [];
    let contextText = "";

    try {
      callbacks.onStart?.();

      const searchResults = await this.semanticSearch.searchForRAG(
        userMessage,
        s.ragTopK,
        s.searchMinScore,
      );

      citations = this.buildCitations(searchResults);
      contextText = this.buildContextText(searchResults, s.ragMaxContextTokens);
      callbacks.onCitations?.(citations);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onError?.(`检索失败：${msg}`);
      return;
    }

    // 2. 构造完整 messages
    const messages = this.buildMessages(session, userMessage, contextText);

    // 3. 配额检查
    const estimatedTokens = messages.reduce(
      (sum, m) => sum + TokenEstimator.estimate(String(m.content)),
      0,
    );
    const quotaCheck = await this.quotaManager.canConsume(estimatedTokens);
    if (!quotaCheck.allowed) {
      callbacks.onError?.(quotaCheck.reason ?? "配额不足");
      return;
    }

    // 4. 调用 API（流式 / 非流式）
    if (s.ragStreaming) {
      await this.askStreaming(messages, callbacks);
    } else {
      await this.askNonStreaming(messages, callbacks);
    }
  }

  /**
   * 中止当前生成
   */
  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 流式调用（fetch + SSE）
  // ════════════════════════════════════════════════════════════
  private async askStreaming(
    messages: ChatMessage[],
    callbacks: ChatStreamCallbacks,
  ): Promise<void> {
    const s = this.getSettings();
    const endpoint = `${s.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;

    this.abortController = new AbortController();

    let fullContent = "";
    let usageTokens = 0;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.apiKey}`,
        },
        body: JSON.stringify({
          model: s.model,
          temperature: s.ragTemperature,
          stream: true,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 401) throw new Error("API Key 无效（401）");
        if (response.status === 402) throw new Error("API 余额不足（402）");
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
      }

      if (!response.body) throw new Error("响应无 body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 按 SSE 行解析
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;
          if (!line.startsWith("data:")) continue;

          const data = line.substring(5).trim();
          if (data === "[DONE]") continue;

          try {
            const obj = JSON.parse(data);
            const delta = obj?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              fullContent += delta;
              callbacks.onToken?.(delta);
            }
            // 一些 API 会在最后一条带 usage
            if (obj?.usage?.total_tokens) {
              usageTokens = obj.usage.total_tokens;
            }
          } catch {
            // 跳过损坏的行
          }
        }
      }

      // 兜底：估算 token
      if (usageTokens === 0) {
        usageTokens =
          messages.reduce((sum, m) => sum + TokenEstimator.estimate(String(m.content)), 0) +
          TokenEstimator.estimate(fullContent);
      }

      const s2 = this.getSettings();
      const cost = TokenEstimator.estimateCost(usageTokens, s2.costPerMillionTokensChat);
      await this.quotaManager.consume(usageTokens, cost);

      callbacks.onDone?.(fullContent, usageTokens);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("aborted") || msg.includes("AbortError")) {
        // 用户中止，已生成的内容仍计入
        if (fullContent) {
          const usage =
            messages.reduce((sum, m) => sum + TokenEstimator.estimate(String(m.content)), 0) +
            TokenEstimator.estimate(fullContent);
          const cost = TokenEstimator.estimateCost(usage, s.costPerMillionTokensChat);
          await this.quotaManager.consume(usage, cost);
          callbacks.onDone?.(fullContent + "\n\n*（已中止）*", usage);
        } else {
          callbacks.onError?.("已中止");
        }
      } else {
        callbacks.onError?.(msg);
      }
    } finally {
      this.abortController = null;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 非流式调用（fetch，便于错误处理统一）
  // ════════════════════════════════════════════════════════════
  private async askNonStreaming(
    messages: ChatMessage[],
    callbacks: ChatStreamCallbacks,
  ): Promise<void> {
    const s = this.getSettings();
    const endpoint = `${s.apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;

    this.abortController = new AbortController();

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${s.apiKey}`,
        },
        body: JSON.stringify({
          model: s.model,
          temperature: s.ragTemperature,
          stream: false,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        if (response.status === 401) throw new Error("API Key 无效（401）");
        if (response.status === 402) throw new Error("API 余额不足（402）");
        throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
      }

      const data = await response.json();
      const content = String(data?.choices?.[0]?.message?.content ?? "");
      const totalTokens =
        data?.usage?.total_tokens ??
        TokenEstimator.estimate(content) +
          messages.reduce((sum, m) => sum + TokenEstimator.estimate(String(m.content)), 0);

      // 一次性吐出
      callbacks.onToken?.(content);

      const cost = TokenEstimator.estimateCost(totalTokens, s.costPerMillionTokensChat);
      await this.quotaManager.consume(totalTokens, cost);

      callbacks.onDone?.(content, totalTokens);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onError?.(msg);
    } finally {
      this.abortController = null;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 构造 messages
  // ════════════════════════════════════════════════════════════
  private buildMessages(
    session: ChatSession,
    userMessage: string,
    contextText: string,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // 系统消息
    messages.push({
      id: "sys",
      role: "system",
      content: this.buildSystemPrompt(contextText),
      createdAt: nowISOString(),
    });

    // 历史对话（最多保留最近 10 轮）
    const history = session.messages.slice(-20);
    for (const m of history) {
      if (m.role === "user" || m.role === "assistant") {
        messages.push({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        });
      }
    }

    // 当前用户问题
    messages.push({
      id: "current",
      role: "user",
      content: userMessage,
      createdAt: nowISOString(),
    });

    return messages;
  }

  private buildSystemPrompt(contextText: string): string {
    const hasContext = contextText.trim().length > 0;

    if (!hasContext) {
      return `你是 MindOS 知识助手，遵循以下规则：

1. 用户的 Wiki 中没有找到相关知识。
2. 你可以基于通用知识回答，但必须明确标注「⚠️ 此回答基于通用知识，未在 Wiki 中找到相关条目」
3. 鼓励用户后续把这次对话整理成笔记
4. 回答简洁、准确、Markdown 格式`;
    }

    return `你是 MindOS 知识助手。请基于用户的 Wiki 知识库回答问题。

【规则】
1. 优先基于以下提供的 Wiki 上下文回答
2. 如果上下文足够，直接回答；不要说"根据上下文..."这种废话
3. 如果上下文不完整，先回答能回答的部分，再补充说"以上来自你的 Wiki，其余部分基于通用知识：..."
4. 回答用 Markdown 格式，简洁、准确
5. 如果用户问的问题在 Wiki 中没有相关内容，明确说"你的 Wiki 中暂无 XX 相关内容"
6. 不要在回答末尾重复列引用（系统会自动显示）

【Wiki 上下文】
${contextText}`;
  }

  // ════════════════════════════════════════════════════════════
  // 构造引用
  // ════════════════════════════════════════════════════════════
  private buildCitations(results: SearchResult[]): ChatCitation[] {
    const seen = new Set<string>();
    const citations: ChatCitation[] = [];

    for (const r of results) {
      const key = `${r.chunk.path}#${r.chunk.section}`;
      if (seen.has(key)) continue;
      seen.add(key);

      citations.push({
        path: r.chunk.path,
        fileTitle: r.chunk.fileTitle,
        section: r.chunk.section,
        preview: this.makePreview(r.chunk.text),
        score: r.score,
      });
    }

    return citations;
  }

  /**
   * 构造上下文文本（按 maxTokens 截断）
   */
  private buildContextText(results: SearchResult[], maxTokens: number): string {
    if (results.length === 0) return "";

    const parts: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const block = `【片段 ${i + 1}】来源：${r.chunk.fileTitle} > ${r.chunk.section}\n${r.chunk.text}`;
      const blockTokens = TokenEstimator.estimate(block);

      if (totalTokens + blockTokens > maxTokens) {
        if (parts.length === 0) {
          // 第一块就超了，强行截断
          const allowed = maxTokens;
          const ratio = allowed / blockTokens;
          const truncatedLen = Math.floor(block.length * ratio);
          parts.push(block.substring(0, truncatedLen) + "…");
        }
        break;
      }

      parts.push(block);
      totalTokens += blockTokens;
    }

    return parts.join("\n\n──────────\n\n");
  }

  private makePreview(text: string, maxLen: number = 100): string {
    const lines = text.split("\n");
    if (lines[0] && /^#{1,6}\s+/.test(lines[0])) {
      lines.shift();
    }
    const body = lines.join(" ").replace(/\s+/g, " ").trim();
    if (body.length <= maxLen) return body;
    return body.substring(0, maxLen) + "…";
  }
}