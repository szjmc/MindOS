import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  DIR_RAW_CONVERSATIONS,
  DIR_WIKI_CONCEPTS,
  DIR_WIKI_TOPICS,
  DIR_RAW,
  DIR_WIKI,
  DIR_WIKI_ENTITIES,
  DIR_WIKI_COMPARISONS,
  DIR_WIKI_OVERVIEWS,
  DIR_SCHEMA,
  DIR_SCHEMA_TEMPLATES,
  DIR_SCHEMA_WORKFLOWS,
  DIR_SYSTEM,
  DIR_SYSTEM_CHAT_SESSIONS,
  DIR_RECALL,
  DIR_RECALL_CARDS,
  DIR_RECALL_SESSIONS,
  DIR_RECALL_STATS,
  DIR_RECALL_WORDLISTS,
  DIR_RECALL_INTERVIEW,
  EXPRESS_STORAGE_DIR,
  EXPRESS_DRAFTS_DIR,
} from "../../core/constants";

export class Migrator {
  constructor(private app: App, private getBaseFolder: () => string) {}

  async migrate(): Promise<{ moved: number; errors: string[] }> {
    const base = this.getBaseFolder();
    const errors: string[] = [];
    let moved = 0;

    const tasks: Array<{ from: string; to: string; label: string }> = [
      { from: `${base}/00-Inbox`, to: `${base}/${DIR_RAW_CONVERSATIONS}`, label: "Inbox → raw/conversations" },
      { from: `${base}/40-Atlas`, to: `${base}/${DIR_WIKI_CONCEPTS}`, label: "Atlas → wiki/concepts" },
      { from: `${base}/50-Sources`, to: `${base}/${DIR_WIKI_TOPICS}`, label: "Sources → wiki/topics" },
    ];

    for (const t of tasks) {
      try {
        const c = await this.moveFolder(t.from, t.to);
        moved += c;
      } catch (e) {
        errors.push(`${t.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { moved, errors };
  }

  async migrateToChinesePaths(): Promise<{ moved: number; errors: string[] }> {
    const base = this.getBaseFolder();
    const errors: string[] = [];
    let moved = 0;

    // 检查是否需要迁移（如果旧文件夹还存在）
    const needsMigration = await this.checkOldFoldersExist(base);
    if (!needsMigration) {
      return { moved: 0, errors: [] };
    }

    // 定义迁移任务
    const tasks: Array<{ from: string; to: string; label: string }> = [
      // Raw 素材
      { from: `${base}/raw`, to: `${base}/${DIR_RAW}`, label: "raw → 原始素材" },
      { from: `${base}/raw/conversations`, to: `${base}/${DIR_RAW_CONVERSATIONS}`, label: "raw/conversations → 原始素材/对话存档" },
      
      // Wiki 知识
      { from: `${base}/wiki`, to: `${base}/${DIR_WIKI}`, label: "wiki → 知识库" },
      { from: `${base}/wiki/entities`, to: `${base}/${DIR_WIKI_ENTITIES}`, label: "wiki/entities → 知识库/实体" },
      { from: `${base}/wiki/concepts`, to: `${base}/${DIR_WIKI_CONCEPTS}`, label: "wiki/concepts → 知识库/概念" },
      { from: `${base}/wiki/topics`, to: `${base}/${DIR_WIKI_TOPICS}`, label: "wiki/topics → 知识库/主题" },
      { from: `${base}/wiki/comparisons`, to: `${base}/${DIR_WIKI_COMPARISONS}`, label: "wiki/comparisons → 知识库/对比" },
      { from: `${base}/wiki/overviews`, to: `${base}/${DIR_WIKI_OVERVIEWS}`, label: "wiki/overviews → 知识库/概述" },
      
      // Schema 规则
      { from: `${base}/schema`, to: `${base}/${DIR_SCHEMA}`, label: "schema → 规则" },
      { from: `${base}/schema/page-templates`, to: `${base}/${DIR_SCHEMA_TEMPLATES}`, label: "schema/page-templates → 规则/页面模板" },
      { from: `${base}/schema/workflows`, to: `${base}/${DIR_SCHEMA_WORKFLOWS}`, label: "schema/workflows → 规则/工作流" },
      
      // System 数据
      { from: `${base}/_system`, to: `${base}/${DIR_SYSTEM}`, label: "_system → _系统数据" },
      { from: `${base}/_system/chat-sessions`, to: `${base}/${DIR_SYSTEM_CHAT_SESSIONS}`, label: "_system/chat-sessions → _系统数据/对话历史" },
      
      // Recall 复习
      { from: `${base}/_system/recall`, to: `${base}/${DIR_RECALL}`, label: "_system/recall → _系统数据/复习" },
      { from: `${base}/_system/recall/cards`, to: `${base}/${DIR_RECALL_CARDS}`, label: "_system/recall/cards → _系统数据/复习/卡片" },
      { from: `${base}/_system/recall/sessions`, to: `${base}/${DIR_RECALL_SESSIONS}`, label: "_system/recall/sessions → _系统数据/复习/会话" },
      { from: `${base}/_system/recall/stats`, to: `${base}/${DIR_RECALL_STATS}`, label: "_system/recall/stats → _系统数据/复习/统计" },
      { from: `${base}/_system/recall/wordlists`, to: `${base}/${DIR_RECALL_WORDLISTS}`, label: "_system/recall/wordlists → _系统数据/复习/词库" },
      { from: `${base}/_system/recall/interview`, to: `${base}/${DIR_RECALL_INTERVIEW}`, label: "_system/recall/interview → _系统数据/复习/面试" },
      
      // Express 输出
      { from: `${base}/_system/express`, to: `${base}/${EXPRESS_STORAGE_DIR}`, label: "_system/express → _系统数据/输出" },
      { from: `${base}/_system/express/drafts`, to: `${base}/${EXPRESS_DRAFTS_DIR}`, label: "_system/express/drafts → _系统数据/输出/草稿" },
      
      // Connect 关联
      { from: `${base}/_system/connect`, to: `${base}/_系统数据/关联`, label: "_system/connect → _系统数据/关联" },
      
      // Temp 临时
      { from: `${base}/_system/temp`, to: `${base}/_系统数据/临时`, label: "_system/temp → _系统数据/临时" },
    ];

    // 执行迁移（注意：要从最深层到最外层，避免父文件夹先被移动）
    const sortedTasks = [...tasks].sort((a, b) => {
      return b.from.split("/").length - a.from.split("/").length;
    });

    for (const t of sortedTasks) {
      try {
        const c = await this.moveFolderContents(t.from, t.to);
        moved += c;
      } catch (e) {
        errors.push(`${t.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { moved, errors };
  }

  private async checkOldFoldersExist(base: string): Promise<boolean> {
    const oldPaths = [
      `${base}/raw`,
      `${base}/wiki`,
      `${base}/schema`,
      `${base}/_system`,
    ];
    
    for (const p of oldPaths) {
      const folder = this.app.vault.getAbstractFileByPath(normalizePath(p));
      if (folder instanceof TFolder) {
        return true;
      }
    }
    return false;
  }

  private async moveFolder(fromPath: string, toPath: string): Promise<number> {
    const from = this.app.vault.getAbstractFileByPath(normalizePath(fromPath));
    if (!(from instanceof TFolder)) return 0;

    await this.ensureFolder(toPath);
    let moved = 0;

    const files = this.collectFiles(from);
    for (const f of files) {
      const fileName = f.name;
      const newPath = normalizePath(`${toPath}/${this.dedupName(toPath, fileName)}`);
      try {
        await this.app.fileManager.renameFile(f, newPath);
        moved++;
      } catch (e) {
        // 忽略单文件错误
      }
    }

    return moved;
  }

  private collectFiles(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") files.push(child);
      else if (child instanceof TFolder) files.push(...this.collectFiles(child));
    }
    return files;
  }

  private dedupName(dir: string, name: string): string {
    let candidate = name;
    let i = 1;
    while (this.app.vault.getAbstractFileByPath(normalizePath(`${dir}/${candidate}`))) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.substring(0, dot) : name;
      const ext = dot > 0 ? name.substring(dot) : "";
      candidate = `${stem} (${i})${ext}`;
      i++;
    }
    return candidate;
  }

  private async ensureFolder(p: string) {
    if (await this.app.vault.adapter.exists(p)) return;
    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e: any) {
          if (!e?.message?.includes?.("already exists")) throw e;
        }
      }
    }
  }

  private async moveFolderContents(fromPath: string, toPath: string): Promise<number> {
    const from = this.app.vault.getAbstractFileByPath(normalizePath(fromPath));
    if (!(from instanceof TFolder)) return 0;

    await this.ensureFolder(toPath);
    let moved = 0;

    for (const child of [...from.children]) {
      if (child instanceof TFile) {
        const newPath = normalizePath(`${toPath}/${this.dedupName(toPath, child.name)}`);
        try {
          await this.app.fileManager.renameFile(child, newPath);
          moved++;
        } catch (e) {
          // 忽略单文件错误
        }
      } else if (child instanceof TFolder) {
        // 递归处理子文件夹
        const subToPath = normalizePath(`${toPath}/${child.name}`);
        const subMoved = await this.moveFolderContents(child.path, subToPath);
        moved += subMoved;
        
        // 如果原文件夹为空，删除它
        if (child.children.length === 0) {
          try {
            await this.app.vault.remove(child);
          } catch (e) {}
        }
      }
    }

    // 如果原文件夹为空，删除它
    if (from.children.length === 0) {
      try {
        await this.app.vault.remove(from);
      } catch (e) {}
    }

    return moved;
  }
}