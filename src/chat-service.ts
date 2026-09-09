/**
 * Chat 会话服务 —— 从 main.ts 提取
 * 负责会话管理 + RAG 问答
 */
import {
  ChatSession,
  ChatMessage,
  ChatCitation,
} from "./core/types";
import {
  generateUID,
  nowISOString,
} from "./core/utils";

export interface ChatServiceDeps {
  app: any;
  quotaManager: any;
  chatSessionStore: any;
  ragChat: any;
  retrieveStore: any;
  semanticSearch: any;
  getSettings: () => any;
}

let _deps: ChatServiceDeps | null = null;

export function setChatDeps(d: ChatServiceDeps) { _deps = d; }

function d(): ChatServiceDeps { return _deps!; }

// ── Quota ──

export async function refreshQuota(): Promise<void> {
  const state = await d().quotaManager.getCurrentState();
  d().retrieveStore.setQuota(state);
}

// ── Session CRUD ──

export async function loadChatSessions(): Promise<void> {
  const sessions = await d().chatSessionStore.getAll();
  d().retrieveStore.setSessions(sessions);
  if (sessions.length > 0 && !d().retrieveStore.getState().currentSessionId) {
    d().retrieveStore.setCurrentSessionId(sessions[0].id);
  }
}

export async function createNewChatSession(title?: string): Promise<ChatSession> {
  const s = await d().chatSessionStore.create(title);
  d().retrieveStore.upsertSession(s);
  d().retrieveStore.setCurrentSessionId(s.id);
  return s;
}

export async function deleteChatSession(id: string): Promise<void> {
  await d().chatSessionStore.delete(id);
  d().retrieveStore.removeSession(id);
}

export async function renameChatSession(id: string, title: string): Promise<void> {
  await d().chatSessionStore.renameSession(id, title);
  const s = await d().chatSessionStore.getById(id);
  if (s) d().retrieveStore.upsertSession(s);
}

export async function exportChatSession(id: string): Promise<string> {
  return await d().chatSessionStore.exportToNote(id);
}

// ── RAG 问答 ──

export async function askChat(session: ChatSession, userMessage: string): Promise<void> {
  const store = d().retrieveStore;
  console.log("[MindOS] askChat 开始", { sessionId: session.id });
  store.setChatting(true);
  store.clearChatStreamingContent();

  const userMsg: ChatMessage = {
    id: generateUID(),
    role: "user",
    content: userMessage,
    createdAt: nowISOString(),
  };

  try {
    await d().chatSessionStore.appendMessage(session.id, userMsg);
    store.upsertSession(session);
  } catch (e) {
    store.setChatError(`保存用户消息失败：${e}`);
    store.setChatting(false);
    return;
  }

  const aiMsgId = generateUID();
  let citations: ChatCitation[] = [];
  let accumulatedContent = "";
  let aiMsgFinalized = false;

  const finalizeAiMessage = async (content: string, tokens: number, isError = false, errorMsg = "") => {
    if (aiMsgFinalized) return;
    aiMsgFinalized = true;

    const aiMsg: ChatMessage = {
      id: aiMsgId,
      role: "assistant",
      content: isError
        ? (content || "(无回答)") + `\n\n*[错误: ${errorMsg}]*`
        : content || "(空回答)",
      citations,
      createdAt: nowISOString(),
      tokens: tokens || undefined,
    };

    try {
      await d().chatSessionStore.appendMessage(session.id, aiMsg);
      const fresh = await d().chatSessionStore.getById(session.id);
      if (fresh) {
        store.upsertSession({
          ...fresh,
          messages: [...fresh.messages],
        });
      }

      setTimeout(() => {
        store.clearChatStreamingContent();
        store.setChatting(false);
        if (isError) store.setChatError(errorMsg);
      }, 50);

      await refreshQuota();
    } catch (e) {
      store.clearChatStreamingContent();
      store.setChatting(false);
      store.setChatError(`保存 AI 回答失败：${e}`);
    }
  };

  try {
    await d().ragChat.ask(session, userMessage, {
      onStart: () => {},
      onToken: (delta: string) => {
        accumulatedContent += delta;
        store.appendChatStreamingContent(delta);
      },
      onCitations: (cits: ChatCitation[]) => { citations = cits; },
      onDone: async (content: string, tokens: number) => {
        const finalContent = (content || accumulatedContent || "").replace(/\n\n\*（已中止）\*/, "");
        await finalizeAiMessage(finalContent, tokens);
      },
      onError: async (err: string) => {
        await finalizeAiMessage(accumulatedContent, 0, true, err);
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!aiMsgFinalized) {
      await finalizeAiMessage(accumulatedContent, 0, true, msg);
    }
  }
}
