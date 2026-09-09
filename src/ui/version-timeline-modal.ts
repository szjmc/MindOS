import { App, Modal, Notice } from "obsidian";
import { VersionManager } from "../modules/wiki/version-manager";
import { diffVersions } from "../modules/wiki/version-differ";
import { PageVersion } from "../core/types";

export class VersionTimelineModal extends Modal {
  private versions: PageVersion[] = [];
  private selectedVersions: Set<string> = new Set();
  private isCompareMode = false;

  constructor(
    app: App,
    private pagePath: string,
    private versionManager: VersionManager,
  ) {
    super(app);
    this.titleEl.setText("📜 版本历史");
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-version-modal");
    contentEl.empty();

    this.renderHeader(contentEl);
    this.renderLoading(contentEl);

    try {
      this.versions = await this.versionManager.getVersions(this.pagePath);
      this.renderContent(contentEl);
    } catch (e) {
      contentEl.empty();
      contentEl.createEl("p", {
        cls: "mindos-version-error",
        text: `加载失败：${e instanceof Error ? e.message : "未知错误"}`,
      });
    }
  }

  private renderHeader(parent: HTMLElement) {
    const header = parent.createDiv({ cls: "mindos-version-header" });
    header.createEl("h3", {
      cls: "mindos-version-title",
      text: "📜 版本历史",
    });
    header.createEl("p", {
      cls: "mindos-version-page-path",
      text: this.pagePath,
    });
  }

  private renderLoading(parent: HTMLElement) {
    const loading = parent.createDiv({ cls: "mindos-version-loading" });
    loading.createEl("div", { cls: "mindos-version-spinner" });
    loading.createEl("p", { text: "正在加载版本历史..." });
  }

  private renderContent(parent: HTMLElement) {
    parent.empty();
    this.renderHeader(parent);

    if (this.versions.length === 0) {
      this.renderEmpty(parent);
      return;
    }

    this.renderSummary(parent);
    this.renderActions(parent);
    this.renderTimeline(parent);
  }

  private renderEmpty(parent: HTMLElement) {
    const empty = parent.createDiv({ cls: "mindos-version-empty" });
    empty.createEl("div", { cls: "mindos-version-empty-icon", text: "📭" });
    empty.createEl("p", {
      cls: "mindos-version-empty-text",
      text: "该页面还没有版本记录",
    });
    empty.createEl("p", {
      cls: "mindos-version-empty-hint",
      text: "修改并保存页面后，版本历史将自动记录",
    });
  }

  private renderSummary(parent: HTMLElement) {
    const summary = parent.createDiv({ cls: "mindos-version-summary" });

    const totalItem = summary.createDiv({ cls: "mindos-version-summary-item" });
    totalItem.createSpan({ cls: "mindos-version-summary-value", text: String(this.versions.length) });
    totalItem.createSpan({ text: "个版本" });

    if (this.versions.length > 1) {
      const first = this.versions[0];
      const last = this.versions[this.versions.length - 1];
      const days = Math.round(
        (new Date(first.timestamp).getTime() - new Date(last.timestamp).getTime()) /
        (1000 * 60 * 60 * 24),
      );

      const spanItem = summary.createDiv({ cls: "mindos-version-summary-item" });
      spanItem.createSpan({ cls: "mindos-version-summary-value", text: String(days) });
      spanItem.createSpan({ text: "天跨度" });
    }
  }

  private renderActions(parent: HTMLElement) {
    const actions = parent.createDiv({ cls: "mindos-version-actions" });

    if (!this.isCompareMode) {
      const compareBtn = actions.createEl("button", {
        cls: "mindos-version-btn mindos-version-btn-secondary",
        text: "🔍 比较版本",
      });
      compareBtn.addEventListener("click", () => {
        this.isCompareMode = true;
        this.renderContent(parent);
      });
    } else {
      const cancelBtn = actions.createEl("button", {
        cls: "mindos-version-btn mindos-version-btn-secondary",
        text: "✕ 取消比较",
      });
      cancelBtn.addEventListener("click", () => {
        this.isCompareMode = false;
        this.selectedVersions.clear();
        this.renderContent(parent);
      });
    }
  }

  private renderTimeline(parent: HTMLElement) {
    const timeline = parent.createDiv({ cls: "mindos-version-timeline" });

    for (let i = 0; i < this.versions.length; i++) {
      const version = this.versions[i];
      const isSelected = this.selectedVersions.has(version.id);
      const isFirst = i === 0;

      const item = timeline.createDiv({
        cls: `mindos-version-item${isFirst ? " is-latest" : ""}${isSelected ? " is-selected" : ""}`,
      });

      // Timeline dot + line
      const dot = item.createDiv({ cls: "mindos-version-dot" });
      if (isFirst) dot.addClass("is-latest");

      // Content
      const content = item.createDiv({ cls: "mindos-version-content" });

      const top = content.createDiv({ cls: "mindos-version-top" });
      top.createSpan({
        cls: "mindos-version-number",
        text: `v${this.versions.length - i}`,
      });
      if (isFirst) {
        top.createSpan({ cls: "mindos-version-badge", text: "当前" });
      }

      const date = content.createDiv({ cls: "mindos-version-date" });
      date.createSpan({
        cls: "mindos-version-date-text",
        text: this.formatDate(version.timestamp),
      });

      const stats = content.createDiv({ cls: "mindos-version-stats" });
      stats.createSpan({
        cls: "mindos-version-wordcount",
        text: `${version.wordCount} 词`,
      });

      // Change summary (async)
      this.renderChangeSummary(stats, version, i);

      // Click handlers
      if (this.isCompareMode) {
        item.addEventListener("click", () => {
          if (this.selectedVersions.has(version.id)) {
            this.selectedVersions.delete(version.id);
          } else {
            if (this.selectedVersions.size >= 2) {
              // Remove oldest selection
              const arr = Array.from(this.selectedVersions);
              this.selectedVersions.delete(arr[arr.length - 1]);
            }
            this.selectedVersions.add(version.id);
          }

          if (this.selectedVersions.size === 2) {
            this.showDiff(parent);
          } else {
            this.renderContent(parent);
          }
        });
      } else {
        item.addEventListener("click", () => {
          this.viewVersion(version);
        });
      }
    }
  }

  private async renderChangeSummary(
    parent: HTMLElement,
    version: PageVersion,
    index: number,
  ) {
    const span = parent.createSpan({ cls: "mindos-version-change" });
    try {
      const summary = await this.versionManager.getChangeSummary(
        version,
        this.pagePath,
      );
      span.setText(summary);
    } catch {
      span.setText("");
    }
  }

  private viewVersion(version: PageVersion) {
    const modal = new VersionViewModal(
      this.app,
      version,
      this.versionManager,
      this.pagePath,
    );
    modal.open();
  }

  private showDiff(parent: HTMLElement) {
    const arr = Array.from(this.selectedVersions);
    const v1 = this.versions.find((v) => v.id === arr[0]);
    const v2 = this.versions.find((v) => v.id === arr[1]);

    if (!v1 || !v2) return;

    // v1 should be older, v2 newer
    const older = new Date(v1.timestamp) < new Date(v2.timestamp) ? v1 : v2;
    const newer = older === v1 ? v2 : v1;

    // Remove existing diff if any
    const existingDiff = parent.querySelector(".mindos-version-diff");
    if (existingDiff) existingDiff.remove();

    const diffContainer = parent.createDiv({ cls: "mindos-version-diff" });
    this.renderDiffContent(diffContainer, older, newer);

    // Scroll to diff
    diffContainer.scrollIntoView({ behavior: "smooth" });
  }

  private renderDiffContent(
    container: HTMLElement,
    older: PageVersion,
    newer: PageVersion,
  ) {
    const header = container.createDiv({ cls: "mindos-version-diff-header" });
    header.createEl("h4", { text: "版本对比" });
    header.createEl("p", {
      cls: "mindos-version-diff-meta",
      text: `${this.formatDate(older.timestamp)} → ${this.formatDate(newer.timestamp)}`,
    });

    const diff = diffVersions(older.content, newer.content);

    const stats = container.createDiv({ cls: "mindos-version-diff-stats" });
    stats.createSpan({ cls: "mindos-version-diff-added", text: `+${diff.additions}` });
    stats.createSpan({ cls: "mindos-version-diff-sep", text: " / " });
    stats.createSpan({ cls: "mindos-version-diff-removed", text: `-${diff.deletions}` });

    const lines = container.createDiv({ cls: "mindos-version-diff-lines" });
    for (const line of diff.lines) {
      const l = lines.createDiv({
        cls: `mindos-version-diff-line is-${line.type}`,
      });

      const sign = l.createSpan({
        cls: "mindos-version-diff-sign",
        text: line.type === "added" ? "+" : line.type === "removed" ? "-" : " ",
      });

      const text = l.createSpan({
        cls: "mindos-version-diff-text",
        text: line.content,
      });
    }
  }

  private formatDate(isoString: string): string {
    const d = new Date(isoString);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

// ── Version Content View Modal ──

class VersionViewModal extends Modal {
  constructor(
    app: App,
    private version: PageVersion,
    private versionManager: VersionManager,
    private pagePath: string,
  ) {
    super(app);
    this.titleEl.setText(`${version.id.slice(0, 8)} - 版本详情`);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-version-view-modal");
    contentEl.empty();

    this.renderDetail(contentEl);
    this.renderContent(contentEl);
  }

  private renderDetail(parent: HTMLElement) {
    const detail = parent.createDiv({ cls: "mindos-version-view-detail" });

    const items = [
      { label: "时间", value: new Date(this.version.timestamp).toLocaleString("zh-CN") },
      { label: "字数", value: `${this.version.wordCount} 词` },
      { label: "指纹", value: this.version.hash.slice(0, 12) },
    ];

    for (const item of items) {
      const row = detail.createDiv({ cls: "mindos-version-view-row" });
      row.createSpan({ cls: "mindos-version-view-label", text: item.label });
      row.createSpan({ cls: "mindos-version-view-value", text: item.value });
    }
  }

  private renderContent(parent: HTMLElement) {
    const section = parent.createDiv({ cls: "mindos-version-view-section" });
    section.createEl("h4", { text: "页面内容" });

    const content = section.createDiv({ cls: "mindos-version-view-content" });
    content.createEl("pre", {
      text: this.version.content.slice(0, 5000) +
        (this.version.content.length > 5000 ? "\n\n... (内容已截断)" : ""),
    });
  }
}
