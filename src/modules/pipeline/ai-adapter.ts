/**
 * AI Client 适配器 —— 从 main.ts 提取
 * 将 AIClient 包装为统一 chat / chatStream 接口
 */
import type { Notice } from "obsidian";
import type { AIClient } from "./ai-client";
import type { TTSService } from "../recall/core/tts-service";
import type { MindOSSettings } from "../../core/types";

let _Notice: typeof Notice | null = null;

export function setNotice(n: typeof Notice) { _Notice = n; }

function notice(msg: string) {
  if (_Notice) new (_Notice as any)(msg);
}

// ── AI Client 适配器 ──

export function buildAIClientAdapter(aiClient: AIClient | undefined): {
  chat: (system: string, user: string, signal?: AbortSignal) => Promise<string>;
  chatStream: (system: string, user: string, onToken: (t: string) => void, signal?: AbortSignal) => Promise<string>;
} {
  const ai = aiClient;

  if (!ai) {
    return {
      async chat(): Promise<string> {
        throw new Error("请先在 MindOS 设置中配置 AI Provider（apiKey + model）");
      },
      async chatStream(): Promise<string> {
        throw new Error("请先在 MindOS 设置中配置 AI Provider（apiKey + model）");
      },
    };
  }

  if (typeof (ai as any).chatStream === "function") {
    return {
      chat: (ai as any).chat.bind(ai),
      chatStream: (ai as any).chatStream.bind(ai),
    };
  }

  // 用普通 chat 模拟流式
  return {
    chat: async (systemPrompt: string, userMessage: string, signal?: AbortSignal): Promise<string> => {
      return await (ai as any).chat(systemPrompt, userMessage, signal);
    },
    chatStream: async (
      systemPrompt: string,
      userMessage: string,
      onToken: (token: string) => void,
      signal?: AbortSignal,
    ): Promise<string> => {
      const result: string = await (ai as any).chat(systemPrompt, userMessage, signal);
      const chunkSize = 20;
      for (let i = 0; i < result.length; i += chunkSize) {
        if (signal?.aborted) break;
        onToken(result.slice(i, i + chunkSize));
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return result;
    },
  };
}

// ── TTS 朗读 ──

export async function speakVocab(
  ttsService: TTSService,
  settings: MindOSSettings,
  text: string,
): Promise<void> {
  try {
    await ttsService.speak(text, {
      enabled: settings.recallTTSEnabled ?? true,
      lang: settings.recallTTSLang ?? "en-US",
      rate: settings.recallTTSRate ?? 1.0,
      pitch: settings.recallTTSPitch ?? 1.0,
      volume: settings.recallTTSVolume ?? 1.0,
      preferredVoice: (settings.recallTTSPreferredVoice || undefined) as any,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notice(`TTS 失败：${msg}`);
  }
}
