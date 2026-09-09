import { App, setIcon, TFile } from "obsidian";
import { ContextAwarenessService, RelatedPage } from "./context-awareness";
import { Notice } from "obsidian";

export class ContextAwarenessView {
  private container: HTMLElement;
  private isLoading = false;
  private currentSuggestions: {
    orphanPages: TFile[];
    outdatedPages: TFile[];
    relatedReading: RelatedPage[];
  } | null = null;
  private fileChangeListener: () => void;
  private currentFilePath: string | null = null;
  private lastRefreshTime = 0;
  private MIN_REFRESH_INTERVAL = 60 * 1000; // 至少60秒间隔
  private pendingRefresh = false;

  constructor(
    private app: App,
    private service: ContextAwarenessService,
    container: HTMLElement,
  ) {
    this.container = container;
    this.setupFileChangeListener();
    // 初始化时立即刷新
    this.doRefresh();
  }

  private setupFileChangeListener() {
    this.fileChangeListener = () => {
      const activeFile = this.app.workspace.getActiveFile();
      const newPath = activeFile?.path || null;
      
      if (newPath !== this.currentFilePath) {
        this.currentFilePath = newPath;
        this.safeRefresh();
      }
    };
    
    this.app.workspace.on("active-leaf-change", this.fileChangeListener);
    this.app.workspace.on("file-open", this.fileChangeListener);
  }

  destroy() {
    this.app.workspace.off("active-leaf-change", this.fileChangeListener);
    this.app.workspace.off("file-open", this.fileChangeListener);
  }

  private refreshTimeout: number | null = null;

  private safeRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    this.refreshTimeout = window.setTimeout(() => {
      this.refreshTimeout = null;
      this.doRefresh();
    }, 500);
  }

  private async doRefresh() {
    if (this.pendingRefresh) return;
    
    const now = Date.now();
    if (now - this.lastRefreshTime < this.MIN_REFRESH_INTERVAL) {
      console.log(`⏱️ 情境感知：距上次刷新不足 ${this.MIN_REFRESH_INTERVAL / 1000} 秒，跳过`);
      // 即使时间不足，也尝试获取当前的建议
      if (!this.currentSuggestions) {
        this.isLoading = true;
        this.render();
      } else {
        return;
      }
    }

    this.pendingRefresh = true;
    this.isLoading = true;
    this.render();
    
    try {
      // 真正调用服务生成推荐
      this.currentSuggestions = await this.service.generateSuggestions();
      this.lastRefreshTime = now;
      this.isLoading = false;
      await this.render();
    } catch (error) {
      console.error("情境感知刷新失败:", error);
      this.isLoading = false;
      this.showEmpty();
    } finally {
      this.pendingRefresh = false;
    }
  }

  async render() {
    this.container.empty();
    this.container.addClass("mindos-context-view");

    if (this.isLoading) {
      this.showLoading();
      return;
    }

    this.currentSuggestions = await this.service.generateSuggestions();

    if (!this.currentSuggestions ||
        (this.currentSuggestions.orphanPages.length === 0 &&
         this.currentSuggestions.outdatedPages.length === 0 &&
         this.currentSuggestions.relatedReading.length === 0)) {
      this.showEmpty();
      return;
    }

    if (this.currentSuggestions.relatedReading.length > 0) {
      this.renderRelatedSection();
    }

    if (this.currentSuggestions.orphanPages.length > 0) {
      this.renderOrphanSection();
    }

    if (this.currentSuggestions.outdatedPages.length > 0) {
      this.renderOutdatedSection();
    }
  }

  private showLoading() {
    const loading = this.container.createDiv({ cls: "mindos-context-loading" });
    loading.innerHTML = `
      <div class="mindos-context-spinner"></div>
      <span>分析中...</span>
    `;
  }

  private showEmpty() {
    const empty = this.container.createDiv({ cls: "mindos-context-empty" });
    empty.innerHTML = `
      <div class="mindos-context-empty-icon">📚</div>
      <p>暂无相关推荐</p>
      <small>打开一个 Wiki 页面查看关联内容</small>
    `;
  }

  private renderRelatedSection() {
    const section = this.container.createDiv({ cls: "mindos-context-section" });

    const header = section.createDiv({ cls: "mindos-context-header" });
    header.innerHTML = `
      <div class="mindos-context-title">
        <span class="mindos-context-icon">🔗</span>
        <span>相关阅读</span>
      </div>
      <span class="mindos-context-count">${this.currentSuggestions!.relatedReading.length}</span>
    `;

    const list = section.createDiv({ cls: "mindos-context-list" });

    for (const item of this.currentSuggestions!.relatedReading) {
      const itemEl = list.createDiv({ cls: "mindos-context-item" });

      const matchIcon = item.matchType === 'link' ? 'link' : item.matchType === 'tag' ? 'tag' : 'search';
      const iconWrap = itemEl.createDiv({ cls: "mindos-context-item-icon" });
      setIcon(iconWrap, matchIcon);

      const content = itemEl.createDiv({ cls: "mindos-context-item-content" });

      const titleEl = content.createDiv({ cls: "mindos-context-item-title" });
      titleEl.textContent = item.file.basename;

      const reason = content.createDiv({ cls: "mindos-context-item-reason" });
      reason.textContent = item.matchReason;

      const preview = content.createDiv({ cls: "mindos-context-item-preview" });
      preview.textContent = item.preview.substring(0, 60) + (item.preview.length > 60 ? '...' : '');

      itemEl.onclick = async () => {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(item.file);
      };

      itemEl.onmouseenter = () => itemEl.addClass("is-hover");
      itemEl.onmouseleave = () => itemEl.removeClass("is-hover");
    }
  }

  private renderOrphanSection() {
    const section = this.container.createDiv({ cls: "mindos-context-section" });

    const header = section.createDiv({ cls: "mindos-context-header" });
    header.innerHTML = `
      <div class="mindos-context-title">
        <span class="mindos-context-icon">🏝️</span>
        <span>孤岛页面</span>
      </div>
      <span class="mindos-context-count mindos-context-count-warning">${this.currentSuggestions!.orphanPages.length}</span>
    `;

    const desc = section.createEl("p", { cls: "mindos-context-desc", text: "这些页面没有与其他页面建立链接" });
    const list = section.createDiv({ cls: "mindos-context-list" });

    for (const file of this.currentSuggestions!.orphanPages) {
      const itemEl = list.createDiv({ cls: "mindos-context-item" });

      const iconWrap = itemEl.createDiv({ cls: "mindos-context-item-icon" });
      setIcon(iconWrap, "file-text");

      const content = itemEl.createDiv({ cls: "mindos-context-item-content" });

      const titleEl = content.createDiv({ cls: "mindos-context-item-title" });
      titleEl.textContent = file.basename;

      const reason = content.createDiv({ cls: "mindos-context-item-reason" });
      reason.textContent = "未被任何页面链接";

      itemEl.onclick = async () => {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
      };

      itemEl.onmouseenter = () => itemEl.addClass("is-hover");
      itemEl.onmouseleave = () => itemEl.removeClass("is-hover");
    }
  }

  private renderOutdatedSection() {
    const section = this.container.createDiv({ cls: "mindos-context-section" });

    const header = section.createDiv({ cls: "mindos-context-header" });
    header.innerHTML = `
      <div class="mindos-context-title">
        <span class="mindos-context-icon">⏰</span>
        <span>久未复习</span>
      </div>
      <span class="mindos-context-count mindos-context-count-warning">${this.currentSuggestions!.outdatedPages.length}</span>
    `;

    const desc = section.createEl("p", { cls: "mindos-context-desc", text: "这些页面超过 6 个月未更新" });
    const list = section.createDiv({ cls: "mindos-context-list" });

    for (const file of this.currentSuggestions!.outdatedPages) {
      const itemEl = list.createDiv({ cls: "mindos-context-item" });

      const iconWrap = itemEl.createDiv({ cls: "mindos-context-item-icon" });
      setIcon(iconWrap, "clock");

      const content = itemEl.createDiv({ cls: "mindos-context-item-content" });

      const titleEl = content.createDiv({ cls: "mindos-context-item-title" });
      titleEl.textContent = file.basename;

      const reason = content.createDiv({ cls: "mindos-context-item-reason" });
      const lastModified = new Date(file.stat.mtime);
      reason.textContent = `上次修改: ${lastModified.toLocaleDateString('zh-CN')}`;

      itemEl.onclick = async () => {
        const leaf = this.app.workspace.getLeaf(true);
        await leaf.openFile(file);
      };

      itemEl.onmouseenter = () => itemEl.addClass("is-hover");
      itemEl.onmouseleave = () => itemEl.removeClass("is-hover");
    }
  }

  setLoading(loading: boolean) {
    this.isLoading = loading;
    this.render();
  }

  async refresh() {
    await this.doRefresh();
  }
}
