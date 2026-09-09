import { TFile, Notice, setIcon } from 'obsidian';
import type MindOSPlugin from '../../../../main';
import { BacklinkAnalyzer } from './backlink-analyzer';
import { BacklinkStore } from './backlink-store';
import { ExplicitBacklink, ImplicitBacklink } from '../../../core/types';

type BacklinkTab = 'explicit' | 'implicit';

export class BacklinkRenderer {
  private plugin: MindOSPlugin;
  private analyzer: BacklinkAnalyzer;
  private store: BacklinkStore;
  private container: HTMLElement | null = null;
  private currentPath: string | null = null;
  private currentTab: BacklinkTab = 'explicit';
  private explicitBacklinks: ExplicitBacklink[] = [];
  private implicitBacklinks: ImplicitBacklink[] = [];
  private isLoading = false;
  private registered = false;

  constructor(plugin: MindOSPlugin) {
    this.plugin = plugin;
    this.analyzer = new BacklinkAnalyzer(this.plugin.app, () => this.plugin.settings);
    this.store = new BacklinkStore(this.plugin.app, () => this.plugin.settings);
  }

  setContainer(container: HTMLElement) {
    this.container = container;
  }

  async initialize() {
    await this.store.load();
    if (!this.registered) {
      this.plugin.app.workspace.on('active-leaf-change', this.onFileChange);
      this.registered = true;
    }
    this.onFileChange();
  }

  destroy() {
    if (this.registered) {
      this.plugin.app.workspace.off('active-leaf-change', this.onFileChange);
      this.registered = false;
    }
  }

  private onFileChange = async () => {
    const file = this.plugin.app.workspace.getActiveFile();
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
      await this.render();
    }
  }

  private renderEmpty(): void {
    if (!this.container) return;
    this.container.empty();
    const wrap = this.container.createDiv({ cls: 'mindos-backlink-container' });
    const empty = wrap.createDiv({ cls: 'mindos-backlink-empty' });
    empty.createDiv({ cls: 'mindos-backlink-empty-icon', text: '🔗' });
    empty.createDiv({ cls: 'mindos-backlink-empty-title', text: '暂无反向链接' });
    empty.createDiv({ cls: 'mindos-backlink-empty-desc', text: '在其他笔记中链接或提及当前页面即可查看关联关系' });
  }

  private renderLoading(): void {
    if (!this.container) return;
    this.container.empty();
    const wrap = this.container.createDiv({ cls: 'mindos-backlink-container' });
    const loading = wrap.createDiv({ cls: 'mindos-backlink-loading' });
    loading.createDiv({ cls: 'mindos-backlink-spinner' });
    loading.createEl('p', { text: '加载中...' });
  }

  async render(): Promise<void> {
    if (!this.container) return;
    this.container.empty();
    const container = this.container.createDiv({ cls: 'mindos-backlink-container' });

    // 统计面板
    this.renderStats(container);

    // Tab 栏
    this.renderTabBar(container);

    // 内容区域
    const content = container.createDiv({ cls: 'mindos-backlink-content' });

    if (this.currentTab === 'explicit') {
      this.renderExplicitBacklinks(content);
    } else {
      this.renderImplicitBacklinks(content);
    }
  }

  private renderStats(parent: HTMLElement): void {
    const stats = parent.createDiv({ cls: 'mindos-backlink-stats' });
    
    const total = stats.createDiv({ cls: 'mindos-stat-card' });
    total.createDiv({ cls: 'mindos-stat-value', text: String(this.explicitBacklinks.length + this.implicitBacklinks.length) });
    total.createDiv({ cls: 'mindos-stat-label', text: '总链接' });
    
    const explicit = stats.createDiv({ cls: 'mindos-stat-card' });
    explicit.createDiv({ cls: 'mindos-stat-value', text: String(this.explicitBacklinks.length) });
    explicit.createDiv({ cls: 'mindos-stat-label', text: '显式链接' });
    
    const implicit = stats.createDiv({ cls: 'mindos-stat-card' });
    implicit.createDiv({ cls: 'mindos-stat-value', text: String(this.implicitBacklinks.length) });
    implicit.createDiv({ cls: 'mindos-stat-label', text: '隐式提及' });
  }

  private renderTabBar(parent: HTMLElement): void {
    const tabBar = parent.createDiv({ cls: 'mindos-backlink-tabs' });
    
    const tabs: BacklinkTab[] = ['explicit', 'implicit'];
    for (const tab of tabs) {
      const btn = tabBar.createDiv({
        cls: `mindos-backlink-tab ${this.currentTab === tab ? 'active' : ''}`
      });
      
      const icon = btn.createSpan({ cls: 'mindos-backlink-tab-icon' });
      icon.setText(tab === 'explicit' ? '🔗' : '💡');
      
      btn.createSpan({ 
        cls: 'mindos-backlink-tab-text',
        text: tab === 'explicit' ? '显式链接' : '隐式提及' 
      });
      
      const count = btn.createSpan({ 
        cls: 'mindos-backlink-count', 
        text: `(${tab === 'explicit' ? this.explicitBacklinks.length : this.implicitBacklinks.length})` 
      });
      
      btn.onClickEvent(() => {
        this.currentTab = tab;
        this.render();
      });
    }

    // 刷新按钮
    const refreshBtn = tabBar.createEl('button', { cls: 'mindos-backlink-refresh' });
    refreshBtn.createSpan({ text: '🔄' });
    refreshBtn.createSpan({ text: '刷新' });
    refreshBtn.onClickEvent(() => this.loadBacklinks());
  }

  private renderExplicitBacklinks(parent: HTMLElement): void {
    if (this.explicitBacklinks.length === 0) {
      const empty = parent.createDiv({ cls: 'mindos-backlink-empty' });
      empty.createDiv({ cls: 'mindos-backlink-empty-icon', text: '🔗' });
      empty.createDiv({ cls: 'mindos-backlink-empty-title', text: '暂无显式链接' });
      empty.createDiv({ cls: 'mindos-backlink-empty-desc', text: '在其他笔记中链接当前页面即可查看关联' });
      return;
    }

    for (const backlink of this.explicitBacklinks) {
      const item = parent.createDiv({ cls: 'mindos-backlink-card' });

      // 图标和标题
      const header = item.createDiv({ cls: 'mindos-backlink-card-header' });
      
      const icon = header.createSpan({ cls: 'mindos-backlink-card-icon', text: '🔗' });
      
      const title = header.createDiv({
        cls: 'mindos-backlink-card-title',
        text: this.extractDisplayTitle(backlink.sourcePath)
      });
      title.onClickEvent(() => this.openFile(backlink.sourcePath));

      const file = this.plugin.app.vault.getAbstractFileByPath(backlink.sourcePath);
      if (file instanceof TFile) {
        header.createDiv({
          cls: 'mindos-backlink-card-time',
          text: this.formatTime(file.stat.mtime)
        });
      }

      // 引用上下文
      const context = item.createDiv({ cls: 'mindos-backlink-card-context' });
      const highlightContext = this.highlightLinkContext(backlink.context);
      context.innerHTML = highlightContext;

      // 操作按钮（hover显示）
      const actions = item.createDiv({ cls: 'mindos-backlink-card-actions' });
      
      const openBtn = actions.createEl('button', { cls: 'mindos-backlink-action-btn' });
      openBtn.createSpan({ text: '👁️' });
      openBtn.createSpan({ text: '打开' });
      openBtn.onClickEvent(() => this.openFile(backlink.sourcePath));
      
      const copyBtn = actions.createEl('button', { cls: 'mindos-backlink-action-btn' });
      copyBtn.createSpan({ text: '📋' });
      copyBtn.createSpan({ text: '复制' });
      copyBtn.onClickEvent(() => this.copyLinkContext(backlink.context));
    }
  }

  private renderImplicitBacklinks(parent: HTMLElement): void {
    if (this.implicitBacklinks.length === 0) {
      const empty = parent.createDiv({ cls: 'mindos-backlink-empty' });
      empty.createDiv({ cls: 'mindos-backlink-empty-icon', text: '💡' });
      empty.createDiv({ cls: 'mindos-backlink-empty-title', text: '暂无隐式提及' });
      empty.createDiv({ cls: 'mindos-backlink-empty-desc', text: '系统会自动识别与当前笔记相关的提及' });
      return;
    }

    for (const backlink of this.implicitBacklinks) {
      const item = parent.createDiv({ cls: 'mindos-backlink-card' });

      // 图标和标题
      const header = item.createDiv({ cls: 'mindos-backlink-card-header' });
      
      const icon = header.createSpan({ cls: 'mindos-backlink-card-icon', text: '💡' });
      
      const title = header.createDiv({
        cls: 'mindos-backlink-card-title',
        text: this.extractDisplayTitle(backlink.sourcePath)
      });
      title.onClickEvent(() => this.openFile(backlink.sourcePath));

      const score = header.createDiv({
        cls: 'mindos-backlink-card-score',
        text: `${Math.round(backlink.similarityScore * 100)}%`
      });

      // 原因说明
      item.createDiv({ cls: 'mindos-backlink-card-reason', text: backlink.reason });

      // 操作按钮（hover显示）
      const actions = item.createDiv({ cls: 'mindos-backlink-card-actions' });
      
      const insertBtn = actions.createEl('button', { cls: 'mindos-backlink-action-btn mod-cta' });
      insertBtn.createSpan({ text: '🔗' });
      insertBtn.createSpan({ text: '添加关联' });
      insertBtn.onClickEvent(() => this.insertLinkTo(backlink.sourcePath));
      
      const ignoreBtn = actions.createEl('button', { cls: 'mindos-backlink-action-btn' });
      ignoreBtn.createSpan({ text: '✕' });
      ignoreBtn.createSpan({ text: '屏蔽' });
      ignoreBtn.onClickEvent(async () => {
        await this.store.ignoreBacklink(backlink.sourcePath, backlink.targetPath);
        this.implicitBacklinks = this.implicitBacklinks.filter(b => b.sourcePath !== backlink.sourcePath);
        await this.render();
        new Notice('已屏蔽该提及');
      });
    }
  }

  private highlightLinkContext(context: string): string {
    if (!this.currentPath) return context;
    const currentTitle = this.extractDisplayTitle(this.currentPath);
    const pattern = new RegExp(`\\[\\[${currentTitle}\\]\\]`, 'gi');
    return `…${context.replace(pattern, `<span class="mindos-backlink-highlight">$&</span>`)}…`;
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
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.plugin.app.workspace.getLeaf(false).openFile(file);
    }
  }

  private async copyLinkContext(context: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(context);
      new Notice('已复制');
    } catch {
      new Notice('复制失败');
    }
  }

  private async insertLinkTo(sourcePath: string): Promise<void> {
    if (!this.currentPath) return;
    const sourceFile = this.plugin.app.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceFile instanceof TFile)) {
      new Notice('找不到源文件');
      return;
    }

    const targetTitle = this.extractDisplayTitle(this.currentPath);
    const content = await this.plugin.app.vault.read(sourceFile);
    const insertText = ` [[${targetTitle}]]`;
    const newContent = content + '\n\n' + insertText + '\n';
    await this.plugin.app.vault.modify(sourceFile, newContent);
    await this.openFile(sourcePath);
    new Notice('已添加关联');
  }
}
