import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon } from 'obsidian';
import type MindOSPlugin from '../../../../main';
import { VIEW_TYPE_CONNECT_BACKLINK } from '../constants';
import { BacklinkAnalyzer } from './backlink-analyzer';
import { BacklinkStore } from './backlink-store';
import { ExplicitBacklink, ImplicitBacklink } from '../../../core/types';
import { PLUGIN_NAME } from '../../../core/constants';

type BacklinkTab = 'explicit' | 'implicit';

export class BacklinkView extends ItemView {
  plugin: MindOSPlugin;
  analyzer: BacklinkAnalyzer;
  store: BacklinkStore;
  currentPath: string | null = null;
  currentTab: BacklinkTab = 'explicit';
  explicitBacklinks: ExplicitBacklink[] = [];
  implicitBacklinks: ImplicitBacklink[] = [];
  isLoading = false;

  constructor(leaf: WorkspaceLeaf, plugin: MindOSPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.analyzer = new BacklinkAnalyzer(this.app, () => this.plugin.settings);
    this.store = new BacklinkStore(this.app, () => this.plugin.settings);
  }

  getViewType(): string { return VIEW_TYPE_CONNECT_BACKLINK; }
  getDisplayText(): string { return '反向链接增强'; }
  getIcon(): string { return 'link-2'; }

  private renderTopBar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: "mindos-topbar" });
    const left = bar.createDiv({ cls: "mindos-topbar-left" });
    const titleWrap = left.createDiv({ cls: "mindos-brand" });
    const iconEl = titleWrap.createSpan({ cls: "mindos-brand-icon" });
    setIcon(iconEl, "link-2");
    titleWrap.createSpan({ cls: "mindos-brand-text", text: PLUGIN_NAME });
    titleWrap.createSpan({
      cls: "mindos-version-tag",
      text: `v${this.plugin.manifest.version}`,
    });
    const right = bar.createDiv({ cls: "mindos-topbar-right" });
    const settingsBtn = right.createEl("button", { cls: "mindos-icon-btn" });
    settingsBtn.setAttribute("aria-label", "设置");
    settingsBtn.setAttribute("title", "设置");
    setIcon(settingsBtn, "settings");
    settingsBtn.onclick = () => {
      // @ts-ignore
      this.plugin.app.setting.open();
      // @ts-ignore
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
    };
  }

  async onOpen(): Promise<void> {
    await this.store.load();
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => this.onFileChange())
    );
    this.onFileChange();
  }

  private onFileChange = async () => {
    const file = this.app.workspace.getActiveFile();
    if (file?.path) {
      this.currentPath = file.path;
      await this.loadBacklinks();
    }
  };

  private async loadBacklinks(): Promise<void> {
    if (!this.currentPath) {
      this.renderEmpty();
      return;
    }

    this.isLoading = true;
    this.renderLoading();

    try {
      this.explicitBacklinks = await this.analyzer.scanExplicitBacklinks(this.currentPath);
      this.implicitBacklinks = await this.analyzer.scanImplicitBacklinks(
        this.currentPath,
        this.plugin.vectorStore
      );
      this.implicitBacklinks = this.store.filterIgnoredBacklinks(this.implicitBacklinks);
    } catch (e) {
      console.error('[MindOS] Load backlinks error:', e);
      new Notice('加载反向链接失败');
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private renderEmpty(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mindos-root', 'mindos-backlink-view');
    this.renderTopBar(contentEl);
    const wrap = contentEl.createDiv({ cls: 'mindos-backlink-container' });
    wrap.createDiv({ cls: 'mindos-backlink-empty', text: '请打开一个 Wiki 页面' });
  }

  private renderLoading(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mindos-root', 'mindos-backlink-view');
    this.renderTopBar(contentEl);
    const wrap = contentEl.createDiv({ cls: 'mindos-backlink-container' });
    const loading = wrap.createDiv({ cls: 'mindos-backlink-loading' });
    const spinner = loading.createSpan({ cls: 'mindos-backlink-spinner' });
    setIcon(spinner, 'loader-2');
    loading.createSpan({ text: ' 加载中...' });
  }

  render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('mindos-root', 'mindos-backlink-view');

    this.renderTopBar(contentEl);

    const container = contentEl.createDiv({ cls: 'mindos-backlink-container' });

    // Tab 栏
    const tabBar = container.createDiv({ cls: 'mindos-backlink-tabs' });
    const tabs: BacklinkTab[] = ['explicit', 'implicit'];
    for (const tab of tabs) {
      const btn = tabBar.createDiv({
        cls: `mindos-backlink-tab ${this.currentTab === tab ? 'active' : ''}` });
      btn.setText(tab === 'explicit' ? '显式链接' : '隐式关联');
      if (tab === 'explicit') {
        btn.createSpan({ cls: 'mindos-backlink-count', text: `(${this.explicitBacklinks.length}` });
      } else {
        btn.createSpan({ cls: 'mindos-backlink-count', text: `(${this.implicitBacklinks.length}` });
      }
      btn.onClickEvent(() => {
        this.currentTab = tab;
        this.render();
      });
    }

    // 刷新按钮
    const refreshBtn = tabBar.createEl('button', { cls: 'mindos-backlink-refresh' });
    setIcon(refreshBtn.createSpan(), 'refresh-cw');
    refreshBtn.title = '刷新';
    refreshBtn.onClickEvent(() => this.loadBacklinks());

    // 内容区域
    const content = container.createDiv({ cls: 'mindos-backlink-content' });

    if (this.currentTab === 'explicit') {
      this.renderExplicitBacklinks(content);
    } else {
      this.renderImplicitBacklinks(content);
    }
  }

  private renderExplicitBacklinks(parent: HTMLElement): void {
    if (this.explicitBacklinks.length === 0) {
      parent.createDiv({ cls: 'mindos-backlink-empty', text: '暂无显式链接' });
      return;
    }

    for (const backlink of this.explicitBacklinks) {
      const item = parent.createDiv({ cls: 'mindos-backlink-item' });

      const header = item.createDiv({ cls: 'mindos-backlink-header' });
      const title = header.createDiv({
        cls: 'mindos-backlink-title', text: this.extractDisplayTitle(backlink.sourcePath) });
      title.onClickEvent(() => this.openFile(backlink.sourcePath));
      
      const file = this.app.vault.getAbstractFileByPath(backlink.sourcePath);
      if (file instanceof TFile) {
        header.createDiv({
          cls: 'mindos-backlink-time',
          text: this.formatTime(file.stat.mtime)
        });
      }

      item.createDiv({ cls: 'mindos-backlink-context', text: '…' + backlink.context + '…' });

      const actions = item.createDiv({ cls: 'mindos-backlink-actions' });
      const openBtn = actions.createEl('button', { cls: 'mindos-mini-btn' });
      setIcon(openBtn.createSpan(), 'arrow-up-right');
      openBtn.createSpan({ text: '打开' });
      openBtn.onClickEvent(() => this.openFile(backlink.sourcePath));
    }
  }

  private renderImplicitBacklinks(parent: HTMLElement): void {
    if (this.implicitBacklinks.length === 0) {
      parent.createDiv({ cls: 'mindos-backlink-empty', text: '暂无隐式关联' });
      return;
    }

    for (const backlink of this.implicitBacklinks) {
      const item = parent.createDiv({ cls: 'mindos-backlink-item' });

      const header = item.createDiv({ cls: 'mindos-backlink-header' });
      const title = header.createDiv({
        cls: 'mindos-backlink-title', text: this.extractDisplayTitle(backlink.sourcePath) });
      title.onClickEvent(() => this.openFile(backlink.sourcePath));
      const score = header.createDiv({ cls: 'mindos-backlink-score', text: `${Math.round(backlink.similarityScore * 100)}%` });

      item.createDiv({ cls: 'mindos-backlink-reason', text: backlink.reason });

      const actions = item.createDiv({ cls: 'mindos-backlink-actions' });
      const insertBtn = actions.createEl('button', { cls: 'mindos-mini-btn mod-cta' });
      setIcon(insertBtn.createSpan(), 'plus');
      insertBtn.createSpan({ text: '插入链接' });
      insertBtn.onClickEvent(() => this.insertLinkTo(backlink.sourcePath));

      const ignoreBtn = actions.createEl('button', { cls: 'mindos-mini-btn' });
      setIcon(ignoreBtn.createSpan(), 'x');
      ignoreBtn.createSpan({ text: '忽略' });
      ignoreBtn.onClickEvent(async () => {
        await this.store.ignoreBacklink(backlink.sourcePath, backlink.targetPath);
        this.implicitBacklinks = this.implicitBacklinks.filter(b => b.sourcePath !== backlink.sourcePath);
        this.render();
        new Notice('已忽略该关联');
      });
    }
  }

  private extractDisplayTitle(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
  }

  private formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    if (days < 7) return `${days} 天前`;
    const d = new Date(timestamp);
    return d.toLocaleDateString();
  }

  private async openFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }
  }

  private async insertLinkTo(sourcePath: string): Promise<void> {
    if (!this.currentPath) return;
    const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceFile instanceof TFile)) {
      new Notice('找不到源文件');
      return;
    }

    const targetTitle = this.extractDisplayTitle(this.currentPath);
    const content = await this.app.vault.read(sourceFile);
    const insertText = ` [[${targetTitle}]]`;
    const newContent = content + '\n\n' + insertText + '\n';
    await this.app.vault.modify(sourceFile, newContent);
    await this.openFile(sourcePath);
    new Notice('已插入链接');
  }
}
