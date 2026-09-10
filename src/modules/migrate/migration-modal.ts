/**
 * MigrationModal —— 数据迁移中心（v1.1 / 路线图 4C）
 *
 * 提供导出 / 导入 / 备份 / 恢复的统一入口。
 */
import { App, Modal, Notice } from "obsidian";
import { MigrationService } from "./migration-service";

export class MigrationModal extends Modal {
  constructor(app: App, private service: MigrationService) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-migration-modal");

    contentEl.createEl("h2", { text: "📦 数据迁移中心" });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: "导出复习卡片到 Anki / CSV / Markdown / JSON，或导入外部卡片、备份与恢复全部数据。",
    });

    this.renderExportSection(contentEl);
    this.renderImportSection(contentEl);
    this.renderBackupSection(contentEl);
  }

  onClose() {
    this.contentEl.empty();
  }

  // ════════════════════════════════════════════════════════════
  // 导出
  // ════════════════════════════════════════════════════════════
  private renderExportSection(parent: HTMLElement) {
    const section = parent.createDiv({ cls: "mindos-migration-section" });
    section.createEl("h3", { text: "导出" });

    const wrap = section.createDiv({ cls: "mindos-migration-actions" });

    this.makeButton(wrap, "Anki 文本 (.txt)", "导出后可在 Anki 中直接导入", () =>
      this.service.exportAnki(),
    );
    this.makeButton(wrap, "CSV 表格 (.csv)", "通用表格，可用 Excel 打开", () =>
      this.service.exportCSV(),
    );
    this.makeButton(wrap, "Markdown (.md)", "人类可读归档", () =>
      this.service.exportMarkdown(),
    );
    this.makeButton(wrap, "JSON (.json)", "完整数据，可无损回导", () =>
      this.service.exportJSON(),
    );
  }

  // ════════════════════════════════════════════════════════════
  // 导入
  // ════════════════════════════════════════════════════════════
  private renderImportSection(parent: HTMLElement) {
    const section = parent.createDiv({ cls: "mindos-migration-section" });
    section.createEl("h3", { text: "导入" });
    section.createEl("p", {
      cls: "setting-item-description",
      text: "支持 MindOS JSON、Anki 文本、CSV/TSV。将自动识别格式并去重。",
    });

    const wrap = section.createDiv({ cls: "mindos-migration-actions" });
    const btn = wrap.createEl("button", { cls: "mindos-btn mindos-btn-md", text: "选择文件导入…" });
    btn.onclick = () => this.pickAndImport();
  }

  // ════════════════════════════════════════════════════════════
  // 备份 / 恢复
  // ════════════════════════════════════════════════════════════
  private renderBackupSection(parent: HTMLElement) {
    const section = parent.createDiv({ cls: "mindos-migration-section" });
    section.createEl("h3", { text: "备份与恢复" });
    const wrap = section.createDiv({ cls: "mindos-migration-actions" });

    const backupBtn = wrap.createEl("button", {
      cls: "mindos-btn mindos-btn-md mindos-btn-primary",
      text: "一键备份全部数据",
    });
    backupBtn.onclick = async () => {
      try {
        const path = await this.service.exportBackup();
        new Notice(`✅ 备份完成：${path}`);
      } catch (e) {
        new Notice(`❌ 备份失败：${(e as Error).message}`);
      }
    };

    const restoreBtn = wrap.createEl("button", { cls: "mindos-btn mindos-btn-md", text: "从备份恢复…" });
    restoreBtn.onclick = () => this.pickAndRestore();
  }

  // ════════════════════════════════════════════════════════════
  // 辅助
  // ════════════════════════════════════════════════════════════
  private makeButton(
    parent: HTMLElement,
    label: string,
    desc: string,
    action: () => Promise<string>,
  ) {
    const item = parent.createDiv({ cls: "mindos-migration-action" });
    const btn = item.createEl("button", { cls: "mindos-btn mindos-btn-md", text: label });
    item.createEl("span", { cls: "setting-item-description", text: desc });
    btn.onclick = async () => {
      try {
        btn.disabled = true;
        const path = await action();
        new Notice(`✅ 已导出：${path}`);
      } catch (e) {
        new Notice(`❌ 导出失败：${(e as Error).message}`);
      } finally {
        btn.disabled = false;
      }
    };
  }

  private pickFile(accept: string, onPicked: (content: string, name: string) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("accept", accept);
    input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const content = await file.text();
      onPicked(content, file.name);
      input.remove();
    };
    input.click();
  }

  private pickAndImport() {
    this.pickFile(".json,.csv,.txt,.tsv", async (content, name) => {
      try {
        const res = await this.service.importFromText(content);
        const parts = [`导入 ${res.imported} 张`];
        if (res.duplicated) parts.push(`跳过重复 ${res.duplicated}`);
        if (res.invalid) parts.push(`忽略无效 ${res.invalid}`);
        new Notice(`✅ ${name}：${parts.join("，")}`);
      } catch (e) {
        new Notice(`❌ 导入失败：${(e as Error).message}`);
      }
    });
  }

  private pickAndRestore() {
    this.pickFile(".json", async (content, name) => {
      try {
        const res = await this.service.restoreFromText(content);
        new Notice(`✅ 已恢复 ${res.cards} 张卡片${res.pluginDataRestored ? "及插件数据" : ""}`);
      } catch (e) {
        new Notice(`❌ 恢复失败（${name}）：${(e as Error).message}`);
      }
    });
  }
}
