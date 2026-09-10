import { App, Modal, Notice, TFile } from "obsidian";
import { MindOSSettings } from "../../core/types";

export class QuickNoteModal extends Modal {
  private textarea!: HTMLTextAreaElement;
  private tagsInput!: HTMLInputElement;
  private callback: (note: string, tags: string[]) => void;

  constructor(
    app: App,
    callback: (note: string, tags: string[]) => void,
    prefill?: string,
  ) {
    super(app);
    this.callback = callback;
    this.titleEl.setText("💡 闪念笔记");
    
    if (prefill) {
      setTimeout(() => {
        this.textarea.value = prefill;
        this.textarea.focus();
        this.textarea.select();
      }, 100);
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-quick-note-modal");
    contentEl.empty();

    const form = contentEl.createDiv({ cls: "mindos-quick-note-form" });

    form.createEl("p", {
      cls: "mindos-quick-note-desc",
      text: "快速记录想法，自动存入 Inbox",
    });

    this.textarea = form.createEl("textarea", {
      cls: "mindos-quick-note-textarea",
      placeholder: "输入你的想法...",
    });
    this.textarea.rows = 6;
    this.textarea.focus();

    const tagsRow = form.createDiv({ cls: "mindos-quick-note-tags-row" });
    tagsRow.createEl("label", { cls: "mindos-quick-note-tags-label", text: "标签：" });
    this.tagsInput = tagsRow.createEl("input", {
      cls: "mindos-quick-note-tags-input",
      type: "text",
      placeholder: "用逗号分隔，如：idea, todo",
    });

    const actions = form.createDiv({ cls: "mindos-quick-note-actions" });

    const cancelBtn = actions.createEl("button", {
      cls: "mindos-quick-note-btn mindos-quick-note-btn-secondary",
      text: "取消",
    });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = actions.createEl("button", {
      cls: "mindos-quick-note-btn mindos-quick-note-btn-primary",
      text: "保存",
    });
    saveBtn.addEventListener("click", () => this.saveNote());

    this.textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        this.saveNote();
      }
    });
  }

  private saveNote() {
    const note = this.textarea.value.trim();
    if (!note) {
      new Notice("请输入内容");
      return;
    }

    const tags = this.tagsInput.value
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t);

    this.callback(note, tags);
    this.close();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export class QuickNoteService {
  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
  ) {}

  async createQuickNote(note: string, tags: string[]): Promise<string> {
    const settings = this.getSettings();
    const inboxFolder = `${settings.baseFolder}/原始素材/inbox`;
    
    try {
      await this.app.vault.createFolder(inboxFolder);
    } catch (e) {
      // 文件夹已存在
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `quick-note-${timestamp}.md`;
    const path = `${inboxFolder}/${filename}`;

    const frontmatter = {
      title: "闪念笔记",
      created: new Date().toISOString(),
      tags: ["mindos-quick-note", ...tags],
      type: "quick-note",
    };

    const content = `---
${Object.entries(frontmatter)
  .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map((t) => `"${t}"`).join(", ")}]` : `"${v}"`}`)
  .join("\n")}
---

${note}

---

> 💡 此笔记由闪念笔记功能创建
`;

    try {
      await this.app.vault.create(path, content);
    } catch (e: any) {
      if (e?.message?.includes?.("already exists")) {
        // 时间戳路径理论上不会重复，此处仅作防御性保护
        return path;
      }
      throw e;
    }
    return path;
  }

  showQuickNoteModal(prefill?: string) {
    new QuickNoteModal(this.app, async (note, tags) => {
      try {
        const path = await this.createQuickNote(note, tags);
        new Notice(`✅ 闪念笔记已保存到 Inbox`);
        
        setTimeout(() => {
          const f = this.app.vault.getAbstractFileByPath(path);
          if (f instanceof TFile) this.app.workspace.getLeaf(true).openFile(f);
        }, 500);
      } catch (e) {
        new Notice(`❌ 保存失败: ${e instanceof Error ? e.message : "未知错误"}`);
      }
    }, prefill).open();
  }
}