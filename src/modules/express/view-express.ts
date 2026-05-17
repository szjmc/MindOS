import {
  ItemView,
  WorkspaceLeaf,
  MarkdownRenderer,
  Notice,
  setIcon
} from 'obsidian';
import type MindOSPlugin from '../../../main';
import type {
  ArticleDraft,
  ArticleStyle,
  ArticleOutline,
  OutlineSection,
  ExpressGenerateOptions,
} from '../../core/types';
import { EXPRESS_LENGTH_MAP } from '../../core/constants';
import { ArticleStore } from './article-store';
import { OutlineBuilder } from './outline-builder';
import { ArticleGenerator } from './article-generator';
import { getAllStyles, getStyleTemplate } from './style-templates';

// ----------------------------------------------------------------
// View 常量
// ----------------------------------------------------------------

export const EXPRESS_VIEW_TYPE = 'mindos-express';

type ExpressPage   = 'home' | 'compose' | 'preview';
type ComposeStep   = 'input' | 'outline' | 'generating' | 'editor';

// ----------------------------------------------------------------
// ExpressView
// ----------------------------------------------------------------

export class ExpressView extends ItemView {
  private plugin:    MindOSPlugin;
  private store:     ArticleStore;
  private builder:   OutlineBuilder;
  private generator: ArticleGenerator;

  // UI 状态
  private currentPage:  ExpressPage  = 'home';
  private currentStep:  ComposeStep  = 'input';
  private currentDraft: ArticleDraft | null = null;
  private allDrafts:    ArticleDraft[]      = [];

  // 输入状态
  private inputTopic:        string  = '';
  private inputStyle:        ArticleStyle = 'tech-blog';
  private inputLength:       'short' | 'medium' | 'long' = 'medium';
  private inputInstruction:  string  = '';
  private inputUseWiki:      boolean = true;

  // 生成状态
  private isGeneratingOutline:  boolean = false;
  private isGeneratingContent:  boolean = false;
  private outlineAbort:         AbortController | null = null;
  private contentAbort:         AbortController | null = null;
  private generatingContent:    string = '';
  private generationProgress:   { completed: number; total: number } = { completed: 0, total: 0 };

  // 编辑状态
  private editingContent: string  = '';
  private isRewriting:    boolean = false;

  // DOM 引用
  private rootEl:        HTMLElement | null = null;
  private contentAreaEl: HTMLElement | null = null;
  private composeBodyEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: MindOSPlugin) {
    super(leaf);
    this.plugin = plugin;

    const baseFolder = (plugin as any).settings?.baseFolder || '';
    const aiAdapter  = (plugin as any).buildAIClientAdapter?.() ?? null;

    // SemanticSearch 适配器
    const rawSearch = (plugin as any).semanticSearch ?? null;
    const semanticAdapter = rawSearch
      ? {
          search: async (
            query: string,
            topK: number
          ): Promise<Array<{ content: string; filePath: string; score: number }>> => {
            const results = await rawSearch.search(query, { topK });
            return (results as any[]).map((r) => ({
              content:  r.content  ?? r.chunk ?? r.text  ?? '',
              filePath: r.filePath ?? r.path  ?? r.file  ?? '',
              score:    typeof r.score === 'number' ? r.score : 0,
            }));
          }
        }
      : null;

    this.store     = new ArticleStore(plugin.app, baseFolder);
    this.builder   = new OutlineBuilder(plugin.app, aiAdapter, baseFolder, semanticAdapter);
    this.generator = new ArticleGenerator(aiAdapter);
  }

  getViewType():    string { return EXPRESS_VIEW_TYPE; }
  getDisplayText(): string { return 'Express 输出'; }
  getIcon():        string { return 'file-text'; }

  // ---- 生命周期 ------------------------------------------------

  async onOpen(): Promise<void> {
    this.rootEl = this.containerEl.children[1] as HTMLElement;
    this.rootEl.empty();
    this.rootEl.addClass('mindos-express');
    await this.loadDrafts();
    this.render();
  }

  async onClose(): Promise<void> {
    this.outlineAbort?.abort();
    this.contentAbort?.abort();
  }

  // ---- 数据加载 ------------------------------------------------

  private async loadDrafts(): Promise<void> {
    this.allDrafts = await this.store.loadAllDrafts();
  }

  // ---- 主渲染入口 ----------------------------------------------

  private render(): void {
    if (!this.rootEl) return;
    this.rootEl.empty();
    this.renderHeader(this.rootEl);
    this.contentAreaEl = this.rootEl.createDiv({ cls: 'express-content-area' });
    switch (this.currentPage) {
      case 'home':    this.renderHome(this.contentAreaEl);    break;
      case 'compose': this.renderCompose(this.contentAreaEl); break;
      case 'preview': this.renderPreview(this.contentAreaEl); break;
    }
  }

  // ================================================================
  // Header
  // ================================================================

  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: 'express-header' });

    // 左：Logo + 标题
    const left = header.createDiv({ cls: 'express-header-left' });
    const logoWrap = left.createDiv({ cls: 'express-header-logo' });
    setIcon(logoWrap, 'file-text');
    left.createEl('span', { cls: 'express-header-title', text: 'Express 输出' });

    // 中：步骤面包屑（仅 compose 页）
    if (this.currentPage === 'compose') {
      const steps = header.createDiv({ cls: 'express-steps' });
      const stepDefs: { key: ComposeStep; label: string }[] = [
        { key: 'input',      label: '① 配置' },
        { key: 'outline',    label: '② 大纲' },
        { key: 'generating', label: '③ 生成中' },
        { key: 'editor',     label: '④ 编辑' },
      ];
      for (const s of stepDefs) {
        const el = steps.createEl('span', {
          cls: [
            'express-step',
            this.currentStep === s.key ? 'active' : '',
            this.isStepReachable(s.key) ? 'reachable' : '',
          ].join(' ').trim(),
          text: s.label,
        });
        if (this.isStepReachable(s.key) && s.key !== 'generating') {
          el.addEventListener('click', () => {
            this.currentStep = s.key;
            this.renderComposeContent();
          });
        }
      }
    }

    // 右：操作按钮
    const right = header.createDiv({ cls: 'express-header-right' });

    if (this.currentPage !== 'home') {
      const backBtn = right.createEl('button', {
        cls:  'express-btn express-btn-ghost',
        text: '← 草稿列表',
      });
      backBtn.addEventListener('click', () => {
        this.outlineAbort?.abort();
        this.contentAbort?.abort();
        this.currentPage  = 'home';
        this.currentDraft = null;
        this.currentStep  = 'input';
        this.render();
      });
    }

    const newBtn = right.createEl('button', {
      cls:  'express-btn express-btn-primary',
      text: '+ 新建文章',
    });
    newBtn.addEventListener('click', () => this.startNewCompose());
  }

  private isStepReachable(step: ComposeStep): boolean {
    const order: ComposeStep[] = ['input', 'outline', 'generating', 'editor'];
    const currentIdx = order.indexOf(this.currentStep);
    const targetIdx  = order.indexOf(step);
    if (step === 'generating') return false;
    return targetIdx <= currentIdx;
  }

  // ================================================================
  // Home 页：草稿列表
  // ================================================================

  private renderHome(parent: HTMLElement): void {
    if (this.allDrafts.length === 0) {
      this.renderEmptyHome(parent);
      return;
    }
    const listWrap = parent.createDiv({ cls: 'express-draft-list' });
    listWrap.createEl('h3', { cls: 'express-section-title', text: '📄 我的草稿' });
    for (const draft of this.allDrafts) {
      this.renderDraftCard(listWrap, draft);
    }
  }

  private renderEmptyHome(parent: HTMLElement): void {
    const empty = parent.createDiv({ cls: 'express-empty' });
    const iconWrap = empty.createDiv({ cls: 'express-empty-icon' });
    setIcon(iconWrap, 'pencil');
    empty.createEl('p', { cls: 'express-empty-title', text: '还没有文章草稿' });
    empty.createEl('p', {
      cls:  'express-empty-desc',
      text: '点击「新建文章」，基于你的 Wiki 知识库生成精彩内容',
    });
    const startBtn = empty.createEl('button', {
      cls:  'express-btn express-btn-primary express-btn-lg',
      text: '✍️ 开始创作',
    });
    startBtn.addEventListener('click', () => this.startNewCompose());
  }

  private renderDraftCard(parent: HTMLElement, draft: ArticleDraft): void {
    const card = parent.createDiv({ cls: 'express-draft-card' });

    const statusMap: Record<string, { label: string; cls: string }> = {
      outline:    { label: '大纲',  cls: 'status-outline' },
      generating: { label: '生成中', cls: 'status-generating' },
      draft:      { label: '草稿',  cls: 'status-draft' },
      exported:   { label: '已导出', cls: 'status-exported' },
    };
    const status = statusMap[draft.status] ?? { label: draft.status, cls: '' };
    const tpl    = getStyleTemplate(draft.style);

    const cardTop = card.createDiv({ cls: 'express-draft-card-top' });
    cardTop.createEl('span', { cls: 'express-draft-style',  text: `${tpl.icon} ${tpl.label}` });
    cardTop.createEl('span', { cls: `express-draft-status ${status.cls}`, text: status.label });

    card.createEl('div', {
      cls:  'express-draft-title',
      text: draft.outline?.title ?? draft.topic,
    });
    card.createEl('div', { cls: 'express-draft-topic', text: draft.topic });

    const meta = card.createDiv({ cls: 'express-draft-meta' });
    if (draft.wordCount > 0) {
      meta.createEl('span', { text: `${draft.wordCount} 字` });
    }
    meta.createEl('span', {
      text: new Date(draft.updatedAt).toLocaleDateString('zh-CN'),
    });

    const actions = card.createDiv({ cls: 'express-draft-actions' });

    const editBtn = actions.createEl('button', {
      cls:  'express-btn express-btn-sm',
      text: '继续编辑',
    });
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openDraft(draft);
    });

    if (draft.status === 'draft') {
      const previewBtn = actions.createEl('button', {
        cls:  'express-btn express-btn-sm express-btn-ghost',
        text: '预览',
      });
      previewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.currentDraft = draft;
        this.currentPage  = 'preview';
        this.render();
      });
    }

    const deleteBtn = actions.createEl('button', {
      cls: 'express-btn express-btn-sm express-btn-danger',
    });
    setIcon(deleteBtn, 'trash');
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.store.deleteDraft(draft.id);
      await this.loadDrafts();
      this.render();
    });

    card.addEventListener('click', () => this.openDraft(draft));
  }

  private openDraft(draft: ArticleDraft): void {
    this.currentDraft = draft;
    this.currentPage  = 'compose';

    if (draft.status === 'outline' && draft.outline != null) {
      this.currentStep = 'outline';
    } else if (draft.status === 'draft' || draft.status === 'exported') {
      this.currentStep    = 'editor';
      this.editingContent = draft.content;
    } else {
      this.currentStep = 'input';
    }
    this.render();
  }

  // ================================================================
  // Compose 页
  // ================================================================

  private renderCompose(parent: HTMLElement): void {
    this.composeBodyEl = parent.createDiv({ cls: 'express-compose-body' });
    this.renderComposeContent();
  }

  private renderComposeContent(): void {
    if (!this.composeBodyEl) return;
    this.composeBodyEl.empty();
    switch (this.currentStep) {
      case 'input':      this.renderStepInput(this.composeBodyEl);      break;
      case 'outline':    this.renderStepOutline(this.composeBodyEl);    break;
      case 'generating': this.renderStepGenerating(this.composeBodyEl); break;
      case 'editor':     this.renderStepEditor(this.composeBodyEl);     break;
    }
  }

  // ================================================================
  // Step 1：输入配置
  // ================================================================

  private renderStepInput(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: 'express-step-input' });

    wrap.createEl('h2', { cls: 'express-step-title', text: '✍️ 创作新文章' });
    wrap.createEl('p', {
      cls:  'express-step-desc',
      text: '输入主题，MindOS 将从你的 Wiki 知识库中提炼内容，生成专属文章。',
    });

    // 主题输入
    const topicGroup = wrap.createDiv({ cls: 'express-form-group' });
    topicGroup.createEl('label', { cls: 'express-label', text: '文章主题 *' });
    const topicInput = topicGroup.createEl('input', {
      cls:  'express-input',
      type: 'text',
      placeholder: '例如：Docker 容器化最佳实践、如何构建个人知识体系...',
    });
    topicInput.value = this.inputTopic;
    topicInput.addEventListener('input', () => { this.inputTopic = topicInput.value; });
    topicInput.addEventListener('mousedown', (e) => e.stopPropagation());

    // 风格选择
    const styleGroup = wrap.createDiv({ cls: 'express-form-group' });
    styleGroup.createEl('label', { cls: 'express-label', text: '文章风格' });
    const styleGrid = styleGroup.createDiv({ cls: 'express-style-grid' });
    for (const tpl of getAllStyles()) {
      const styleCard = styleGrid.createDiv({
        cls: `express-style-card${this.inputStyle === tpl.key ? ' active' : ''}`,
      });
      styleCard.createEl('span', { cls: 'express-style-icon', text: tpl.icon });
      styleCard.createEl('span', { cls: 'express-style-name', text: tpl.label });
      styleCard.createEl('span', { cls: 'express-style-desc', text: tpl.description });
      styleCard.addEventListener('click', () => {
        this.inputStyle = tpl.key;
        styleGrid.querySelectorAll('.express-style-card').forEach((el) => el.removeClass('active'));
        styleCard.addClass('active');
      });
    }

    // 长度选择
    const lengthGroup = wrap.createDiv({ cls: 'express-form-group' });
    lengthGroup.createEl('label', { cls: 'express-label', text: '文章长度' });
    const lengthRow = lengthGroup.createDiv({ cls: 'express-length-row' });
    const lengths: Array<'short' | 'medium' | 'long'> = ['short', 'medium', 'long'];
    for (const len of lengths) {
      const cfg    = EXPRESS_LENGTH_MAP[len];
      const lenBtn = lengthRow.createEl('button', {
        cls: `express-length-btn${this.inputLength === len ? ' active' : ''}`,
      });
      lenBtn.createEl('span', { cls: 'express-length-label', text: cfg.label });
      lenBtn.createEl('span', { cls: 'express-length-desc',  text: cfg.description });
      lenBtn.addEventListener('click', () => {
        this.inputLength = len;
        lengthRow.querySelectorAll('.express-length-btn').forEach((el) => el.removeClass('active'));
        lenBtn.addClass('active');
      });
    }

    // Wiki 上下文开关
    const wikiGroup  = wrap.createDiv({ cls: 'express-form-group express-form-group-row' });
    const wikiToggle = wikiGroup.createEl('input', { type: 'checkbox' });
    wikiToggle.id      = 'express-use-wiki';
    wikiToggle.checked = this.inputUseWiki;
    const wikiLabel    = wikiGroup.createEl('label', { text: '📚 检索 Wiki 知识库作为创作素材' });
    wikiLabel.htmlFor  = 'express-use-wiki';
    wikiToggle.addEventListener('change', () => { this.inputUseWiki = wikiToggle.checked; });

    // 补充说明
    const extraGroup = wrap.createDiv({ cls: 'express-form-group' });
    extraGroup.createEl('label', { cls: 'express-label', text: '补充说明（可选）' });
    const extraInput = extraGroup.createEl('textarea', {
      cls:         'express-textarea',
      placeholder: '例如：面向初学者、重点强调实战、字节跳动面试风格...',
    });
    extraInput.value = this.inputInstruction;
    (extraInput as HTMLTextAreaElement).rows = 3;
    extraInput.addEventListener('input', () => { this.inputInstruction = extraInput.value; });
    extraInput.addEventListener('mousedown', (e) => e.stopPropagation());

    // 生成大纲按钮
    const footer = wrap.createDiv({ cls: 'express-step-footer' });
    const genBtn  = footer.createEl('button', {
      cls:  'express-btn express-btn-primary express-btn-lg',
      text: '🪄 生成大纲',
    });
    genBtn.addEventListener('click', () => this.handleGenerateOutline());
  }

  // ================================================================
  // Step 2：大纲确认
  // ================================================================

  private renderStepOutline(parent: HTMLElement): void {
    if (this.currentDraft?.outline == null) {
      this.currentStep = 'input';
      this.renderComposeContent();
      return;
    }

    const outline = this.currentDraft.outline;
    const wrap    = parent.createDiv({ cls: 'express-step-outline' });

    // 标题区
    const titleArea = wrap.createDiv({ cls: 'express-outline-header' });
    titleArea.createEl('h2', { cls: 'express-outline-title',    text: outline.title });
    titleArea.createEl('p',  { cls: 'express-outline-oneliner', text: outline.oneLiner });

    const metaRow = titleArea.createDiv({ cls: 'express-outline-meta' });
    metaRow.createEl('span', { text: `👤 ${outline.targetAudience}` });
    metaRow.createEl('span', { text: `📝 约 ${outline.totalEstimatedWords} 字` });

    // searchMode 用 as string 断言，避免与 types.ts 中旧 SearchMode 冲突
    const searchModeStr = outline.searchMode as string;
    metaRow.createEl('span', {
      text: `🔍 ${
        searchModeStr === 'vector'  ? '向量检索'   :
        searchModeStr === 'keyword' ? '关键词检索' : '通用知识'
      }`,
    });

    // 来源页面
    if (outline.sourcePages.length > 0) {
      const sourcesArea = wrap.createDiv({ cls: 'express-outline-sources' });
      sourcesArea.createEl('span', { cls: 'express-sources-label', text: '📎 引用来源：' });
      for (const page of outline.sourcePages.slice(0, 5)) {
        const tag   = sourcesArea.createEl('span', {
          cls:  'express-source-tag',
          text: page.split('/').pop() ?? page,
        });
        tag.title = page;
      }
      if (outline.sourcePages.length > 5) {
        sourcesArea.createEl('span', {
          cls:  'express-source-more',
          text: `+${outline.sourcePages.length - 5} 个`,
        });
      }
    }

    wrap.createEl('hr', { cls: 'express-divider' });

    // 章节列表
    const sectionList = wrap.createDiv({ cls: 'express-section-list' });
    sectionList.createEl('h3', { cls: 'express-section-list-title', text: '📋 文章大纲' });

    for (let i = 0; i < outline.sections.length; i++) {
      this.renderOutlineSection(sectionList, outline, i);
    }

    // 添加章节
    const addBtn = wrap.createEl('button', {
      cls:  'express-btn express-btn-ghost express-btn-sm',
      text: '+ 添加章节',
    });
    addBtn.addEventListener('click', () => {
      outline.sections.push({
        id:             `s${Date.now()}`,
        level:          1,
        title:          '新章节',
        keyPoints:      ['要点一', '要点二'],
        estimatedWords: 300,
      });
      this.renderComposeContent();
    });

    wrap.createEl('hr', { cls: 'express-divider' });

    const footer    = wrap.createDiv({ cls: 'express-step-footer' });
    const regenBtn  = footer.createEl('button', {
      cls:  'express-btn express-btn-ghost',
      text: '🔄 重新生成大纲',
    });
    regenBtn.addEventListener('click', () => {
      this.currentStep = 'input';
      this.renderComposeContent();
    });

    const continueBtn = footer.createEl('button', {
      cls:  'express-btn express-btn-primary express-btn-lg',
      text: '✅ 确认大纲，开始生成正文',
    });
    continueBtn.addEventListener('click', () => this.handleGenerateArticle());
  }

  private renderOutlineSection(
    parent:  HTMLElement,
    outline: ArticleOutline,
    index:   number
  ): void {
    const section   = outline.sections[index];
    const card      = parent.createDiv({ cls: 'express-outline-section-card' });
    const cardHeader = card.createDiv({ cls: 'express-outline-section-header' });

    cardHeader.createEl('span', {
      cls:  'express-section-num',
      text: String(index + 1),
    });

    const titleEl = cardHeader.createEl('span', {
      cls:  'express-section-title-edit',
      text: section.title,
    });
    titleEl.contentEditable = 'true';
    titleEl.addEventListener('blur', () => {
      section.title = titleEl.textContent?.trim() ?? section.title;
    });
    titleEl.addEventListener('mousedown', (e) => e.stopPropagation());

    cardHeader.createEl('span', {
      cls:  'express-section-words',
      text: `~${section.estimatedWords}字`,
    });

    const delBtn = cardHeader.createEl('button', { cls: 'express-section-del' });
    setIcon(delBtn, 'x');
    delBtn.addEventListener('click', () => {
      outline.sections.splice(index, 1);
      this.renderComposeContent();
    });

    if (section.keyPoints.length > 0) {
      const kpList = card.createEl('ul', { cls: 'express-keypoints' });
      for (const kp of section.keyPoints) {
        kpList.createEl('li', { text: kp });
      }
    }
  }

  // ================================================================
  // Step 3：生成中
  // ================================================================

  private renderStepGenerating(parent: HTMLElement): void {
    const wrap = parent.createDiv({ cls: 'express-step-generating' });

    const { completed, total } = this.generationProgress;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    wrap.createEl('h2', { cls: 'express-gen-title', text: '✨ 正在生成文章...' });

    const progressWrap = wrap.createDiv({ cls: 'express-progress-wrap' });
    const progressBar  = progressWrap.createDiv({ cls: 'express-progress-bar' });
    const progressFill = progressBar.createDiv({ cls: 'express-progress-fill' });
    progressFill.style.width = `${percent}%`;
    progressWrap.createEl('span', {
      cls:  'express-progress-label',
      text: total > 0 ? `第 ${completed} / ${total} 节（${percent}%）` : '正在准备...',
    });

    const preview = wrap.createDiv({ cls: 'express-gen-preview' });
    if (this.generatingContent) {
      preview.createEl('pre', {
        cls:  'express-gen-preview-text',
        text: this.generatingContent.slice(-800),
      });
    } else {
      const loading = preview.createDiv({ cls: 'express-gen-loading' });
      loading.createEl('span', { cls: 'express-loading-dot' });
      loading.createEl('span', { cls: 'express-loading-dot' });
      loading.createEl('span', { cls: 'express-loading-dot' });
    }

    const abortBtn = wrap.createEl('button', {
      cls:  'express-btn express-btn-danger express-btn-sm',
      text: '⏹ 停止生成',
    });
    abortBtn.addEventListener('click', () => {
      this.contentAbort?.abort();
      if (this.currentDraft && this.generatingContent) {
        this.currentDraft   = ArticleStore.applyContent(this.currentDraft, this.generatingContent);
        this.editingContent = this.generatingContent;
        this.store.saveDraft(this.currentDraft);
        this.currentStep         = 'editor';
        this.isGeneratingContent = false;
        this.renderComposeContent();
      }
    });
  }

  // ================================================================
  // Step 4：编辑器
  // ================================================================

  private renderStepEditor(parent: HTMLElement): void {
    if (!this.currentDraft) return;
    const draft = this.currentDraft;

    const wrap    = parent.createDiv({ cls: 'express-step-editor' });
    const toolbar = wrap.createDiv({ cls: 'express-editor-toolbar' });

    toolbar.createEl('h3', {
      cls:  'express-editor-title',
      text: draft.outline?.title ?? draft.topic,
    });

    const toolbarRight  = toolbar.createDiv({ cls: 'express-toolbar-right' });
    const wordCountEl   = toolbarRight.createEl('span', {
      cls:  'express-word-count',
      text: `${draft.wordCount} 字`,
    });

    const copyBtn = toolbarRight.createEl('button', {
      cls:  'express-btn express-btn-sm express-btn-ghost',
      text: '📋 复制',
    });
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(this.editingContent);
      new Notice('✅ 已复制到剪贴板');
    });

    const previewBtn = toolbarRight.createEl('button', {
      cls:  'express-btn express-btn-sm express-btn-ghost',
      text: '👁 预览',
    });
    previewBtn.addEventListener('click', () => {
      this.currentPage = 'preview';
      this.render();
    });

    const exportBtn = toolbarRight.createEl('button', {
      cls:  'express-btn express-btn-sm express-btn-primary',
      text: '📤 导出到 Wiki',
    });
    exportBtn.addEventListener('click', () => this.handleExportToWiki());

    // 双栏：左编辑器 + 右重写面板
    const editorBody  = wrap.createDiv({ cls: 'express-editor-body' });
    const editorLeft  = editorBody.createDiv({ cls: 'express-editor-left' });
    const textarea    = editorLeft.createEl('textarea', { cls: 'express-main-editor' });
    textarea.value    = this.editingContent;
    textarea.addEventListener('input', () => {
      this.editingContent = textarea.value;
      const wc = textarea.value
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
        .split(/\s+/).filter(Boolean).length;
      wordCountEl.textContent = `${wc} 字`;
    });
    textarea.addEventListener('mousedown', (e) => e.stopPropagation());

    const editorRight = editorBody.createDiv({ cls: 'express-editor-right' });
    this.renderRewritePanel(editorRight, textarea);

    const editorFooter = wrap.createDiv({ cls: 'express-editor-footer' });
    const saveBtn = editorFooter.createEl('button', {
      cls:  'express-btn express-btn-primary',
      text: '💾 保存草稿',
    });
    saveBtn.addEventListener('click', async () => {
      if (!this.currentDraft) return;
      this.currentDraft = ArticleStore.applyContent(this.currentDraft, this.editingContent);
      await this.store.saveDraft(this.currentDraft);
      new Notice('✅ 草稿已保存');
    });
  }

  private renderRewritePanel(parent: HTMLElement, editorTextarea: HTMLTextAreaElement): void {
    const panel = parent.createDiv({ cls: 'express-rewrite-panel' });
    panel.createEl('h4', { cls: 'express-rewrite-title', text: '✨ AI 重写助手' });
    panel.createEl('p',  {
      cls:  'express-rewrite-desc',
      text: '在左侧编辑器中选中文字，然后选择重写方式。',
    });

    const presets = [
      { label: '更简洁',   instruction: '将选中文字改写得更简洁，去除冗余，保留核心信息。' },
      { label: '更通俗',   instruction: '将选中文字改写得更通俗易懂，减少术语，用类比解释。' },
      { label: '更专业',   instruction: '将选中文字改写得更专业严谨，增加必要技术细节。' },
      { label: '更有力',   instruction: '将选中文字改写得更有力量感，加强语气，更有说服力。' },
      { label: '扩展内容', instruction: '将选中文字展开扩写，增加更多细节、例子或数据支撑。' },
      { label: '精简内容', instruction: '将选中文字精简，只保留最核心的内容，压缩到原来的一半。' },
    ];

    const presetGrid = panel.createDiv({ cls: 'express-rewrite-presets' });
    for (const preset of presets) {
      const btn = presetGrid.createEl('button', {
        cls:  'express-rewrite-preset-btn',
        text: preset.label,
      });
      btn.addEventListener('click', () => {
        customInstructionEl.value = preset.instruction;
        this.handleRewrite(editorTextarea, preset.instruction);
      });
    }

    panel.createEl('label', { cls: 'express-label express-label-sm', text: '或自定义指令：' });
    const customInstructionEl = panel.createEl('textarea', {
      cls:         'express-textarea express-textarea-sm',
      placeholder: '例如：改成适合朋友圈分享的风格...',
    });
    (customInstructionEl as HTMLTextAreaElement).rows = 3;
    customInstructionEl.addEventListener('mousedown', (e) => e.stopPropagation());

    const rewriteBtn = panel.createEl('button', {
      cls:  'express-btn express-btn-primary express-btn-full',
      text: this.isRewriting ? '⏳ 重写中...' : '🪄 执行重写',
    });
    if (this.isRewriting) (rewriteBtn as HTMLButtonElement).disabled = true;

    rewriteBtn.addEventListener('click', () => {
      const instruction = customInstructionEl.value.trim();
      if (!instruction) { new Notice('请输入重写指令'); return; }
      this.handleRewrite(editorTextarea, instruction);
    });

    // 重写结果区
    const resultArea = panel.createDiv({ cls: 'express-rewrite-result' });
    resultArea.id = 'express-rewrite-result';
  }

  // ================================================================
  // Preview 页
  // ================================================================

  private renderPreview(parent: HTMLElement): void {
    if (!this.currentDraft) return;
    const draft   = this.currentDraft;
    const outline = draft.outline;

    const wrap   = parent.createDiv({ cls: 'express-preview-wrap' });
    const header = wrap.createDiv({ cls: 'express-preview-header' });

    // outline 可能为 null，安全取值
    const title    = outline != null ? outline.title    : draft.topic;
    const oneLiner = outline != null ? outline.oneLiner : '';

    header.createEl('h1', { cls: 'express-preview-title',    text: title });
    if (oneLiner) {
      header.createEl('p', { cls: 'express-preview-oneliner', text: oneLiner });
    }

    const meta = header.createDiv({ cls: 'express-preview-meta' });
    const tpl  = getStyleTemplate(draft.style);
    meta.createEl('span', { text: `${tpl.icon} ${tpl.label}` });
    if (draft.wordCount > 0) {
      meta.createEl('span', { text: `${draft.wordCount} 字` });
    }
    meta.createEl('span', {
      text: new Date(draft.updatedAt).toLocaleDateString('zh-CN'),
    });

    wrap.createEl('hr', { cls: 'express-divider' });

    // Markdown 渲染
    const mdBody = wrap.createDiv({ cls: 'express-preview-body' });
    MarkdownRenderer.renderMarkdown(
      draft.content || '*（暂无正文）*',
      mdBody,
      '',
      this
    );

    // 来源引用
    if (draft.sourcePages.length > 0) {
      wrap.createEl('hr', { cls: 'express-divider' });
      const sourcesSec = wrap.createDiv({ cls: 'express-preview-sources' });
      sourcesSec.createEl('h4', { text: '📚 知识来源' });
      const sourcesList = sourcesSec.createEl('ul');
      for (const page of draft.sourcePages) {
        sourcesList.createEl('li', { text: page });
      }
    }

    const footer  = wrap.createDiv({ cls: 'express-preview-footer' });
    const editBtn = footer.createEl('button', {
      cls:  'express-btn express-btn-ghost',
      text: '← 返回编辑',
    });
    editBtn.addEventListener('click', () => {
      this.currentPage = 'compose';
      this.currentStep = 'editor';
      this.render();
    });

    const exportBtn = footer.createEl('button', {
      cls:  'express-btn express-btn-primary',
      text: '📤 导出到 Wiki',
    });
    exportBtn.addEventListener('click', () => this.handleExportToWiki());
  }

  // ================================================================
  // 业务逻辑
  // ================================================================

  private startNewCompose(): void {
    this.currentDraft       = null;
    this.currentPage        = 'compose';
    this.currentStep        = 'input';
    this.inputTopic         = '';
    this.inputInstruction   = '';
    this.generatingContent  = '';
    this.editingContent     = '';
    this.generationProgress = { completed: 0, total: 0 };
    this.render();
  }

  // ---- 生成大纲 ------------------------------------------------

  private async handleGenerateOutline(): Promise<void> {
    const topic = this.inputTopic.trim();
    if (!topic) { new Notice('请输入文章主题'); return; }

    this.isGeneratingOutline = true;
    this.outlineAbort        = new AbortController();

    const options: ExpressGenerateOptions = {
      topic,
      style:            this.inputStyle,
      lengthHint:       this.inputLength,
      extraInstruction: this.inputInstruction.trim() || undefined,
      useWikiContext:   this.inputUseWiki,
    };

    const draft = ArticleStore.createDraft(topic, this.inputStyle);
    this.currentDraft = draft;

    // 显示加载状态
    if (this.composeBodyEl) {
      this.composeBodyEl.empty();
      const loading = this.composeBodyEl.createDiv({ cls: 'express-loading-center' });
      loading.createEl('p', { text: '🪄 正在生成大纲...' });
      const dotsWrap = loading.createDiv({ cls: 'express-loading-dots' });
      dotsWrap.createEl('span', { cls: 'express-loading-dot' });
      dotsWrap.createEl('span', { cls: 'express-loading-dot' });
      dotsWrap.createEl('span', { cls: 'express-loading-dot' });
    }

    try {
      const outline = await this.builder.buildOutline(
        draft,
        options,
        this.outlineAbort.signal
      );
      this.currentDraft = ArticleStore.applyOutline(draft, outline);
      await this.store.saveDraft(this.currentDraft);
      this.currentStep = 'outline';
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      new Notice(`大纲生成失败：${err instanceof Error ? err.message : String(err)}`);
      this.currentStep = 'input';
    } finally {
      this.isGeneratingOutline = false;
    }

    this.renderComposeContent();
  }

  // ---- 生成正文 ------------------------------------------------

private async handleGenerateArticle(): Promise<void> {
    // 先把两个变量都提取出来，再统一做 null 检查
    // TypeScript 能正确收窄两者的类型
    const draft   = this.currentDraft;
    const outline = draft?.outline ?? null;
    if (!draft || !outline) return;
    // 此行之后 draft 是 ArticleDraft，outline 是 ArticleOutline（非 null）
    
    this.isGeneratingContent = true;
    this.contentAbort        = new AbortController();
    this.generatingContent   = '';
    this.generationProgress  = { completed: 0, total: outline.sections.length };
    this.currentStep         = 'generating';
    this.renderComposeContent();

    try {
      const fullContent = await this.generator.generateArticle(
        draft,
        outline,
        // onSectionProgress
        (_idx, _title, content, _isComplete) => {
          this.generatingContent = content;
          const previewEl = this.composeBodyEl?.querySelector('.express-gen-preview-text');
          if (previewEl) previewEl.textContent = content.slice(-800);
        },
        // onOverallProgress
        (completed, total, accumulated) => {
          this.generationProgress = { completed, total };
          this.generatingContent  = accumulated;
          const fillEl  = this.composeBodyEl?.querySelector('.express-progress-fill') as HTMLElement | null;
          const labelEl = this.composeBodyEl?.querySelector('.express-progress-label');
          if (fillEl) {
            const pct = Math.round((completed / total) * 100);
            fillEl.style.width = `${pct}%`;
            if (labelEl) labelEl.textContent = `第 ${completed} / ${total} 节（${pct}%）`;
          }
        },
        this.contentAbort.signal
      );

      this.currentDraft   = ArticleStore.applyContent(draft, fullContent);
      this.editingContent = fullContent;
      await this.store.saveDraft(this.currentDraft);
      await this.loadDrafts();
      this.currentStep = 'editor';
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      new Notice(`正文生成失败：${err instanceof Error ? err.message : String(err)}`);
      this.currentStep = 'outline';
    } finally {
      this.isGeneratingContent = false;
    }

    this.renderComposeContent();
  }

  // ---- 段落重写 ------------------------------------------------

  private async handleRewrite(
    textarea:    HTMLTextAreaElement,
    instruction: string
  ): Promise<void> {
    const selected = textarea.value.substring(
      textarea.selectionStart,
      textarea.selectionEnd
    );
    if (!selected.trim()) {
      new Notice('请先在编辑器中选中要重写的文字');
      return;
    }

    const start    = textarea.selectionStart;
    const end      = textarea.selectionEnd;
    this.isRewriting = true;

    const resultEl = this.composeBodyEl?.querySelector('#express-rewrite-result') as HTMLElement | null;
    if (resultEl) {
      resultEl.empty();
      resultEl.createEl('p', { cls: 'express-rewrite-streaming', text: '✨ 重写中...' });
    }

    let rewriteResult = '';

    try {
      const style = getStyleTemplate(this.currentDraft?.style ?? 'tech-blog').stylePrompt;
      await this.generator.rewriteParagraph(
        selected,
        instruction,
        style,
        (token) => {
          rewriteResult += token;
          if (resultEl) {
            const streamEl = resultEl.querySelector('.express-rewrite-streaming');
            if (streamEl) streamEl.textContent = rewriteResult;
          }
        }
      );

      if (resultEl) {
        resultEl.empty();
        resultEl.createEl('div', { cls: 'express-rewrite-result-text', text: rewriteResult });

        const acceptBtn = resultEl.createEl('button', {
          cls:  'express-btn express-btn-primary express-btn-sm',
          text: '✅ 采用',
        });
        const discardBtn = resultEl.createEl('button', {
          cls:  'express-btn express-btn-ghost express-btn-sm',
          text: '✗ 放弃',
        });

        acceptBtn.addEventListener('click', () => {
          const before       = textarea.value.substring(0, start);
          const after        = textarea.value.substring(end);
          textarea.value     = before + rewriteResult + after;
          this.editingContent = textarea.value;
          resultEl.empty();
          resultEl.createEl('p', { cls: 'express-rewrite-done', text: '✅ 已采用重写结果' });
        });
        discardBtn.addEventListener('click', () => { resultEl.empty(); });
      }
    } catch (err: unknown) {
      new Notice(`重写失败：${err instanceof Error ? err.message : String(err)}`);
      if (resultEl) resultEl.empty();
    } finally {
      this.isRewriting = false;
    }
  }

  // ---- 导出到 Wiki --------------------------------------------

  private async handleExportToWiki(): Promise<void> {
    if (!this.currentDraft) return;

    // 保存最新编辑内容
    this.currentDraft = ArticleStore.applyContent(
      this.currentDraft,
      this.editingContent || this.currentDraft.content
    );

    try {
      const settings        = (this.plugin as any).settings;
      const baseFolder      = (settings?.baseFolder as string) || '';
      const wikiArticlesDir = `${baseFolder}/wiki/articles`;

      const adapter = this.plugin.app.vault.adapter;
      if (!(await adapter.exists(wikiArticlesDir))) {
        await adapter.mkdir(wikiArticlesDir);
      }

      const filePath = await this.store.exportToWiki(
        this.currentDraft,
        wikiArticlesDir
      );

      this.currentDraft = {
        ...this.currentDraft,
        status:       'exported',
        exportedPath: filePath,
      };
      await this.store.saveDraft(this.currentDraft);
      await this.loadDrafts();

      new Notice(`✅ 已导出到 Wiki：${filePath.split('/').pop()}`);

      // 在 Obsidian 中打开导出文件
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file) {
        await this.plugin.app.workspace.openLinkText(filePath, '', true);
      }
    } catch (err: unknown) {
      new Notice(`导出失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}