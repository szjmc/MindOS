import { ItemView, WorkspaceLeaf, TFile, MarkdownRenderer, setIcon } from 'obsidian';
import type MindOSPlugin from '../../../main';
import { PageSummary, GeneratedQuestion } from '../../core/types';
import { PLUGIN_NAME } from '../../core/constants';

export const VIEW_TYPE_SMART_EXTRACT = 'mindos-smart-extract';

export class SmartExtractView extends ItemView {
  private plugin: MindOSPlugin;
  private currentFile: TFile | null = null;
  private summary: PageSummary | null = null;
  private questions: GeneratedQuestion[] = [];
  private activeTab: 'summary' | 'questions' = 'summary';
  private isLoading = false;

  constructor(leaf: WorkspaceLeaf, plugin: MindOSPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_SMART_EXTRACT;
  }

  getDisplayText() {
    return '智能萃取';
  }

  getIcon() {
    return 'sparkles';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('mindos-root', 'mindos-smart-extract-container');
    
    await this.render();
    
    this.app.workspace.on('active-leaf-change', async () => {
      await this.handleFileChange();
    });
  }

  async onClose() {
    // Cleanup
  }

  private async handleFileChange() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile && activeFile.extension === 'md') {
      this.currentFile = activeFile;
      await this.loadData();
      await this.render();
    }
  }

  private async loadData() {
    if (!this.currentFile) return;

    const result = await this.plugin.unifiedParser.getParseResult(this.currentFile.path);
    if (result) {
      this.summary = result.summary;
      this.questions = result.questions;
    } else {
      this.summary = await this.plugin.summaryGenerator.getSummary(this.currentFile.path);
      this.questions = await this.plugin.questionGenerator.getQuestions(this.currentFile.path);
    }
  }

  private async render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    // 统一 MindOS 品牌顶栏
    this.renderTopBar(container);

    if (!this.currentFile) {
      this.renderEmptyState(container);
      return;
    }

    // 文件信息子栏
    this.renderFileInfoBar(container);
    this.renderTabs(container);
    
    const contentArea = container.createEl('div', { cls: 'mindos-content-area' });
    
    if (this.isLoading) {
      this.renderSkeleton(contentArea);
    } else if (this.activeTab === 'summary') {
      this.renderSummarySection(contentArea);
    } else {
      this.renderQuestionsSection(contentArea);
    }
  }

  private renderTopBar(parent: HTMLElement) {
    const bar = parent.createDiv({ cls: 'mindos-topbar' });
    
    const left = bar.createDiv({ cls: 'mindos-topbar-left' });
    const titleWrap = left.createDiv({ cls: 'mindos-brand' });
    const iconEl = titleWrap.createSpan({ cls: 'mindos-brand-icon' });
    setIcon(iconEl, 'brain-circuit');
    titleWrap.createSpan({ cls: 'mindos-brand-text', text: PLUGIN_NAME });
    titleWrap.createSpan({ cls: 'mindos-version-tag', text: `v${this.plugin.manifest.version}` });

    const right = bar.createDiv({ cls: 'mindos-topbar-right' });
    const settingsBtn = right.createEl('button', { cls: 'mindos-settings-btn' });
    const settingsIcon = settingsBtn.createSpan({ cls: 'mindos-settings-icon' });
    setIcon(settingsIcon, 'settings');
    settingsBtn.addEventListener('click', () => {
      // @ts-ignore
      this.plugin.app.setting.open();
      // @ts-ignore
      this.plugin.app.setting.openTabById(this.plugin.manifest.id);
    });
  }

  private renderEmptyState(container: HTMLElement) {
    const empty = container.createEl('div', { cls: 'mindos-empty-state' });
    empty.createEl('div', { cls: 'mindos-empty-icon', text: '📚' });
    empty.createEl('h3', { text: '打开一个笔记' });
    empty.createEl('p', { text: '智能萃取会自动为您的笔记生成多层总结和复习问题' });
  }

  private renderFileInfoBar(container: HTMLElement) {
    const header = container.createEl('div', { cls: 'mindos-se-header' });
    
    const fileInfo = header.createEl('div', { cls: 'mindos-se-file-info' });
    fileInfo.createEl('span', { cls: 'mindos-se-file-icon', text: '📄' });
    fileInfo.createEl('span', { cls: 'mindos-se-file-name', text: this.currentFile!.basename });
    
    const actions = header.createEl('div', { cls: 'mindos-se-actions' });
    
    const refreshBtn = actions.createEl('button', { cls: 'mindos-se-refresh-btn' });
    refreshBtn.createEl('span', { cls: 'mindos-se-btn-icon', text: '🔄' });
    refreshBtn.createEl('span', { text: '刷新' });
    refreshBtn.addEventListener('click', async () => {
      this.isLoading = true;
      await this.render();
      await this.loadData();
      this.isLoading = false;
      await this.render();
    });

    const regenerateBtn = actions.createEl('button', { cls: 'mindos-se-regenerate-btn' });
    regenerateBtn.createEl('span', { cls: 'mindos-se-btn-icon', text: '✨' });
    regenerateBtn.createEl('span', { text: '重新生成' });
    regenerateBtn.addEventListener('click', async () => {
      if (!this.currentFile) return;
      this.isLoading = true;
      await this.render();
      await this.plugin.unifiedParser.parse(this.currentFile.path, true);
      await this.loadData();
      this.isLoading = false;
      await this.render();
    });

    container.createEl('div', { cls: 'mindos-se-divider' });
  }

  private renderTabs(container: HTMLElement) {
    const tabs = container.createEl('div', { cls: 'mindos-se-tabs' });
    
    const summaryTab = tabs.createEl('button', { 
      cls: `mindos-se-tab ${this.activeTab === 'summary' ? 'active' : ''}`
    });
    summaryTab.createEl('span', { text: '多层总结' });
    summaryTab.addEventListener('click', () => {
      this.activeTab = 'summary';
      this.render();
    });
    
    const questionsTab = tabs.createEl('button', { 
      cls: `mindos-se-tab ${this.activeTab === 'questions' ? 'active' : ''}`
    });
    questionsTab.createEl('span', { text: '复习问题' });
    if (this.questions.length > 0) {
      questionsTab.createEl('span', { cls: 'mindos-se-tab-count', text: `(${this.questions.length})` });
    }
    questionsTab.addEventListener('click', () => {
      this.activeTab = 'questions';
      this.render();
    });
  }

  private renderSkeleton(container: HTMLElement) {
    for (let i = 0; i < 3; i++) {
      const skeleton = container.createEl('div', { cls: 'mindos-se-skeleton' });
      skeleton.createEl('div', { cls: 'mindos-se-skeleton-title' });
      skeleton.createEl('div', { cls: 'mindos-se-skeleton-line' });
      skeleton.createEl('div', { cls: 'mindos-se-skeleton-line short' });
      skeleton.createEl('div', { cls: 'mindos-se-skeleton-line' });
    }
  }

  private renderSummarySection(container: HTMLElement) {
    const section = container.createEl('div', { cls: 'mindos-se-summary-section' });

    if (!this.summary) {
      const empty = section.createEl('div', { cls: 'mindos-se-empty-section' });
      empty.createEl('div', { cls: 'mindos-se-empty-icon', text: '📝' });
      empty.createEl('h4', { text: '暂无总结' });
      empty.createEl('p', { text: '正在为您生成总结...' });
      return;
    }

    const levels = [
      { level: 1, title: '一句话总结', content: this.summary.level1, icon: '●' },
      { level: 2, title: '简短摘要', content: this.summary.level2, icon: '◆' },
      { level: 3, title: '详细摘要', content: this.summary.level3, icon: '■' },
    ];

    for (const { level, title, content, icon } of levels) {
      const card = section.createEl('div', { cls: 'mindos-se-summary-card' });
      
      const cardHeader = card.createEl('div', { cls: 'mindos-se-card-header' });
      cardHeader.createEl('span', { cls: 'mindos-se-level-icon', text: icon });
      cardHeader.createEl('h4', { cls: 'mindos-se-card-title', text: title });
      
      card.createEl('div', { cls: 'mindos-se-divider-light' });
      
      const cardContent = card.createEl('div', { cls: 'mindos-se-card-content' });
      
      const markdownContainer = cardContent.createEl('div', { cls: 'mindos-se-markdown' });
      MarkdownRenderer.renderMarkdown(content, markdownContainer, this.currentFile!.path, this);
      
      const cardFooter = card.createEl('div', { cls: 'mindos-se-card-footer' });
      if (level === 1) {
        cardFooter.createEl('span', { cls: 'mindos-se-badge', text: '快速预览' });
      }
    }

    const stats = section.createEl('div', { cls: 'mindos-se-stats' });
    stats.createEl('span', { cls: 'mindos-se-stat', text: `${this.summary.wordCount} 字` });
    stats.createEl('span', { cls: 'mindos-se-stat', text: new Date(this.summary.generatedAt).toLocaleString('zh-CN') });
  }

  private renderQuestionsSection(container: HTMLElement) {
    const section = container.createEl('div', { cls: 'mindos-se-questions-section' });

    if (this.questions.length === 0) {
      const empty = section.createEl('div', { cls: 'mindos-se-empty-section' });
      empty.createEl('div', { cls: 'mindos-se-empty-icon', text: '❓' });
      empty.createEl('h4', { text: '暂无复习问题' });
      empty.createEl('p', { text: '点击下方按钮为当前笔记生成问题' });
      
      const generateBtn = empty.createEl('button', { cls: 'mindos-se-generate-btn', text: '✨ 生成问题' });
      generateBtn.addEventListener('click', async () => {
        if (!this.currentFile) return;
        this.isLoading = true;
        await this.render();
        await this.plugin.questionGenerator.generateQuestions(this.currentFile.path);
        await this.loadData();
        this.isLoading = false;
        await this.render();
      });
      return;
    }

    for (const question of this.questions) {
      const card = section.createEl('div', { cls: 'mindos-se-question-card' });
      
      const difficultyClass = {
        easy: 'mindos-se-diff-easy',
        medium: 'mindos-se-diff-medium',
        hard: 'mindos-se-diff-hard'
      }[question.difficulty];
      
      const difficultyLabel = {
        easy: '简单',
        medium: '中等',
        hard: '困难'
      }[question.difficulty];

      const cardHeader = card.createEl('div', { cls: 'mindos-se-question-header' });
      cardHeader.createEl('span', { cls: `mindos-se-diff-badge ${difficultyClass}`, text: difficultyLabel });
      cardHeader.createEl('span', { cls: 'mindos-se-quality', text: `质量 ${Math.round(question.qualityScore * 100)}%` });

      const questionText = card.createEl('div', { cls: 'mindos-se-question-text' });
      MarkdownRenderer.renderMarkdown(question.question, questionText, this.currentFile!.path, this);
      
      const answerSection = card.createEl('div', { cls: 'mindos-se-answer-section' });
      const answerToggle = answerSection.createEl('button', { cls: 'mindos-se-answer-toggle' });
      answerToggle.createEl('span', { cls: 'mindos-se-toggle-icon', text: '▼' });
      answerToggle.createEl('span', { text: '显示答案' });
      
      const answerContent = answerSection.createEl('div', { cls: 'mindos-se-answer-content' });
      answerContent.hide();
      MarkdownRenderer.renderMarkdown(question.answer, answerContent, this.currentFile!.path, this);
      
      answerToggle.addEventListener('click', () => {
        if (answerContent.isShown()) {
          answerContent.hide();
          answerToggle.querySelector('.mindos-se-toggle-icon')?.setText('▼');
          answerToggle.querySelector('span:last-child')?.setText('显示答案');
        } else {
          answerContent.show();
          answerToggle.querySelector('.mindos-se-toggle-icon')?.setText('▲');
          answerToggle.querySelector('span:last-child')?.setText('隐藏答案');
        }
      });

      const actions = card.createEl('div', { cls: 'mindos-se-question-actions' });
      const correctBtn = actions.createEl('button', { cls: 'mindos-se-action-btn correct' });
      correctBtn.createEl('span', { text: '✓' });
      correctBtn.createEl('span', { text: '答对' });
      
      const wrongBtn = actions.createEl('button', { cls: 'mindos-se-action-btn wrong' });
      wrongBtn.createEl('span', { text: '✗' });
      wrongBtn.createEl('span', { text: '答错' });
      
      correctBtn.addEventListener('click', async () => {
        await this.plugin.questionGenerator.updateQuestionReview(question.id, true);
        await this.loadData();
        await this.render();
      });
      
      wrongBtn.addEventListener('click', async () => {
        await this.plugin.questionGenerator.updateQuestionReview(question.id, false);
        await this.loadData();
        await this.render();
      });

      if (question.reviewedCount > 0) {
        const accuracy = Math.round((question.correctCount / question.reviewedCount) * 100);
        card.createEl('div', { cls: 'mindos-se-review-stats', text: `已复习 ${question.reviewedCount} 次 · 正确率 ${accuracy}%` });
      }
    }
  }
}
