import { App, normalizePath, TFile, TFolder } from "obsidian";
import {
  DIR_RAW_CONVERSATIONS,
  DIR_WIKI_CONCEPTS,
  DIR_WIKI_TOPICS,
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
    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        await this.app.vault.createFolder(cur);
      }
    }
  }
}