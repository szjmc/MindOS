import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  DIR_SYSTEM_CHAT_SESSIONS,
  DIR_WIKI_TOPICS,
  PAGE_TYPE_DIRS,
} from "../../core/constants";
import {
  ChatSession,
  ChatMessage,
  ChatCitation,
  MindOSSettings,
} from "../../core/types";
import {
  nowISOString,
  nowDateString,
  safeFileName,
  generateUID,
  buildFrontmatter,
} from "../../core/utils";

export class ChatSessionStore {
  private sessions: ChatSession[] = [];
  private loaded = false;

  constructor(
    private app: App,
    private getBaseFolder: () => string,
    private getSettings: () => MindOSSettings,
  ) {}

  private path(rel: string): string {
    return normalizePath(`${this.getBaseFolder()}/${rel}`);
  }

  // ════════════════════════════════════════════════════════════
  // 加载所有会话
  // ════════════════════════════════════════════════════════════
  async loadAll(): Promise<ChatSession[]> {
    if (this.loaded) return [...this.sessions];

    const folderPath = this.path(DIR_SYSTEM_CHAT_SESSIONS);
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    if (!(folder instanceof TFolder)) {
      this.sessions = [];
      this.loaded = true;
      return [];
    }

    const sessions: ChatSession[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "json") {
        try {
          const content = await this.app.vault.read(child);
          const s = JSON.parse(content) as ChatSession;
          if (s.id && s.messages) {
            sessions.push(s);
          }
        } catch {
          // 跳过损坏文件
        }
      }
    }

    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.sessions = sessions;
    this.loaded = true;
    return [...sessions];
  }

  async getAll(): Promise<ChatSession[]> {
    if (!this.loaded) await this.loadAll();
    return [...this.sessions];
  }

  async getById(id: string): Promise<ChatSession | null> {
    if (!this.loaded) await this.loadAll();
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  // ════════════════════════════════════════════════════════════
  // CRUD
  // ════════════════════════════════════════════════════════════
  async create(title: string = "新对话"): Promise<ChatSession> {
    const session: ChatSession = {
      id: this.generateSessionId(),
      title,
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
      messages: [],
    };

    if (!this.loaded) await this.loadAll();
    this.sessions.unshift(session);
    await this.persistOne(session);
    return session;
  }

  async update(session: ChatSession): Promise<void> {
    session.updatedAt = nowISOString();
    if (!this.loaded) await this.loadAll();
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.sessions[idx] = session;
    } else {
      this.sessions.unshift(session);
    }
    await this.persistOne(session);
  }

  async delete(id: string): Promise<void> {
    if (!this.loaded) await this.loadAll();
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;

    this.sessions = this.sessions.filter((s) => s.id !== id);
    const path = this.path(`${DIR_SYSTEM_CHAT_SESSIONS}/${id}.json`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      await this.app.vault.delete(f);
    }
  }

  async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const session = await this.getById(sessionId);
    if (!session) return;
    session.messages.push(message);
    session.updatedAt = nowISOString();

    // 首条用户消息时，用其内容作为标题
    if (session.title === "新对话" && message.role === "user") {
      session.title = message.content.substring(0, 30).trim() || "新对话";
    }

    await this.update(session);
  }

  async renameSession(sessionId: string, newTitle: string): Promise<void> {
    const session = await this.getById(sessionId);
    if (!session) return;
    session.title = newTitle.trim() || "新对话";
    await this.update(session);
  }

  // ════════════════════════════════════════════════════════════
  // 持久化（单会话）
  // ════════════════════════════════════════════════════════════
  private async persistOne(session: ChatSession): Promise<void> {
    await this.ensureFolder(this.path(DIR_SYSTEM_CHAT_SESSIONS));
    const path = this.path(`${DIR_SYSTEM_CHAT_SESSIONS}/${session.id}.json`);
    const content = JSON.stringify(session, null, 2);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
      await this.app.vault.modify(f, content);
    } else {
      await this.app.vault.create(path, content);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 导出为 Markdown 笔记
  // ════════════════════════════════════════════════════════════
  async exportToNote(sessionId: string): Promise<string> {
    const session = await this.getById(sessionId);
    if (!session) throw new Error("会话不存在");
    if (session.messages.length === 0) throw new Error("会话为空，无法导出");

    const s = this.getSettings();
    const customPath = (s.chatExportCustomPath ?? "").trim();
    const folder = customPath
      ? customPath
      : `${s.chatExportFolder || DIR_WIKI_TOPICS}`;
    const fullFolder = this.path(folder);
    await this.ensureFolder(fullFolder);

    const fileName = safeFileName(`对话-${session.title}-${nowDateString()}`);
    let filePath = normalizePath(`${fullFolder}/${fileName}.md`);

    // 去重命名
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(filePath)) {
      filePath = normalizePath(`${fullFolder}/${fileName}-${i}.md`);
      i++;
    }

    // 收集所有引用，去重
    const allCitations = new Map<string, ChatCitation>();
    for (const m of session.messages) {
      if (m.citations) {
        for (const c of m.citations) {
          const key = c.path;
          if (!allCitations.has(key)) {
            allCitations.set(key, c);
          }
        }
      }
    }

    const tags = ["mindos-chat", "conversation"];
    const fm = buildFrontmatter({
      uid: generateUID(),
      title: `对话：${session.title}`,
      type: "topic",
      brief: `MindOS 对话整理：${session.title}`,
      status: "🌱seedling",
      tags,
      created: nowDateString(),
      updated: nowDateString(),
      session_id: session.id,
      session_created: session.createdAt,
    });

    const lines: string[] = [];
    lines.push(fm);
    lines.push("");
    lines.push(`# 对话：${session.title}`);
    lines.push("");
    lines.push(`> 📅 创建：${session.createdAt}`);
    lines.push(`> 💬 共 ${session.messages.length} 条消息`);
    lines.push("");
    lines.push("---");
    lines.push("");

    let qIdx = 0;
    for (const m of session.messages) {
      if (m.role === "user") {
        qIdx++;
        lines.push(`## Q${qIdx}: ${this.shortTitle(m.content)}`);
        lines.push("");
        lines.push("> 🙋 提问");
        lines.push("");
        lines.push(m.content);
        lines.push("");
      } else if (m.role === "assistant") {
        lines.push("> 🤖 回答");
        lines.push("");
        lines.push(m.content);
        lines.push("");

        if (m.citations && m.citations.length > 0) {
          lines.push("**📎 引用：**");
          for (const c of m.citations) {
            lines.push(`- [[${c.fileTitle}]] · ${c.section} · ${(c.score * 100).toFixed(0)}%`);
          }
          lines.push("");
        }

        lines.push("---");
        lines.push("");
      }
    }

    // 末尾汇总所有引用
    if (allCitations.size > 0) {
      lines.push("");
      lines.push("## 📚 涉及知识");
      lines.push("");
      for (const c of allCitations.values()) {
        lines.push(`- [[${c.fileTitle}]] — ${c.preview.substring(0, 60)}…`);
      }
      lines.push("");
    }

    const content = lines.join("\n");
    await this.app.vault.create(filePath, content);
    return filePath;
  }

  // ════════════════════════════════════════════════════════════
  // 辅助
  // ════════════════════════════════════════════════════════════
  private generateSessionId(): string {
    const ts = new Date().toISOString().replace(/[-:T.]/g, "").substring(0, 17);
    const rand = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
    return `session_${ts}_${rand}`;
  }

  private shortTitle(text: string, maxLen: number = 40): string {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return clean.substring(0, maxLen) + "…";
  }

  private async ensureFolder(p: string) {
    const path = normalizePath(p);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const parts = path.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}