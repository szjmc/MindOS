import { App, normalizePath } from 'obsidian';
import type { ArticleDraft, ArticleStyle, ArticleOutline } from '../../core/types';
import {
  EXPRESS_DRAFTS_DIR,
  EXPRESS_STORAGE_DIR,
  EXPRESS_MAX_DRAFTS
} from '../../core/constants';

// ----------------------------------------------------------------
// ArticleStore — 草稿的持久化存取
// ----------------------------------------------------------------

export class ArticleStore {
  private app: App;
  private getVaultRoot: () => string;

  constructor(app: App, getVaultRoot: () => string) {
    this.app = app;
    this.getVaultRoot = getVaultRoot;
  }

  // ---- 路径工具 ------------------------------------------------

  private get vaultRoot(): string {
    return this.getVaultRoot();
  }

  // ---- 路径工具 ------------------------------------------------

  private systemDir(): string {
    return normalizePath(`${this.vaultRoot}/${EXPRESS_STORAGE_DIR}`);
  }

  private draftsDir(): string {
    return normalizePath(`${this.vaultRoot}/${EXPRESS_DRAFTS_DIR}`);
  }

  private draftPath(id: string): string {
    return normalizePath(`${this.draftsDir()}/draft_${id}.json`);
  }

  // ---- 初始化 --------------------------------------------------

  async ensureDirs(): Promise<void> {
    const adapter = this.app.vault.adapter;
    for (const dir of [this.systemDir(), this.draftsDir()]) {
      if (!(await adapter.exists(dir))) {
        try {
          await adapter.mkdir(dir);
        } catch (e: any) {
          // 并发竞态：目录在 check 和 mkdir 之间被创建
          if (!e?.message?.includes?.('already exists')) throw e;
        }
      }
    }
  }

  // ---- CRUD ----------------------------------------------------

  /** 保存草稿（新建或更新） */
  async saveDraft(draft: ArticleDraft): Promise<void> {
    await this.ensureDirs();
    const updated: ArticleDraft = {
      ...draft,
      updatedAt: Date.now()
    };
    await this.app.vault.adapter.write(
      this.draftPath(draft.id),
      JSON.stringify(updated, null, 2)
    );
  }

  /** 读取单个草稿 */
  async loadDraft(id: string): Promise<ArticleDraft | null> {
    const path = this.draftPath(id);
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null;
      const raw = await this.app.vault.adapter.read(path);
      return JSON.parse(raw) as ArticleDraft;
    } catch {
      return null;
    }
  }

  /** 读取所有草稿（按更新时间倒序） */
  async loadAllDrafts(): Promise<ArticleDraft[]> {
    await this.ensureDirs();
    const adapter = this.app.vault.adapter;
    const dir = this.draftsDir();

    try {
      const listed = await adapter.list(dir);
      const files = listed.files.filter(f => f.endsWith('.json'));

      const drafts: ArticleDraft[] = [];
      for (const file of files) {
        try {
          const raw = await adapter.read(file);
          drafts.push(JSON.parse(raw) as ArticleDraft);
        } catch {
          // 忽略损坏文件
        }
      }

      return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /** 删除草稿 */
  async deleteDraft(id: string): Promise<void> {
    const path = this.draftPath(id);
    if (await this.app.vault.adapter.exists(path)) {
      await this.app.vault.adapter.remove(path);
    }
  }

  /** 清理超出上限的旧草稿（保留最新 EXPRESS_MAX_DRAFTS 个） */
  async pruneOldDrafts(): Promise<void> {
    const drafts = await this.loadAllDrafts();
    if (drafts.length <= EXPRESS_MAX_DRAFTS) return;

    const toDelete = drafts.slice(EXPRESS_MAX_DRAFTS);
    for (const d of toDelete) {
      await this.deleteDraft(d.id);
    }
  }

  // ---- 工厂方法 ------------------------------------------------

  /** 创建新草稿对象（未保存） */
  static createDraft(
    topic: string,
    style: ArticleStyle
  ): ArticleDraft {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return {
      id,
      topic,
      style,
      outline: null,
      content: '',
      status: 'outline',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourcePages: [],
      tags: [],
      wordCount: 0
    };
  }

  /** 将大纲合并到草稿 */
  static applyOutline(
    draft: ArticleDraft,
    outline: ArticleOutline
  ): ArticleDraft {
    return {
      ...draft,
      outline,
      sourcePages: outline.sourcePages,
      status: 'outline',
      updatedAt: Date.now()
    };
  }

  /** 将生成的正文合并到草稿 */
  static applyContent(
    draft: ArticleDraft,
    content: string
  ): ArticleDraft {
    const wordCount = content
      .replace(/```[\s\S]*?```/g, '') // 去掉代码块
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;

    return {
      ...draft,
      content,
      wordCount,
      status: 'draft',
      updatedAt: Date.now()
    };
  }

  // ---- 导出工具 ------------------------------------------------

  /**
   * 将草稿导出为 Wiki Markdown 文件
   * @returns 导出后的文件路径
   */
  async exportToWiki(
    draft: ArticleDraft,
    wikiDir: string
  ): Promise<string> {
    const { outline, content, topic, style, sourcePages, tags } = draft;
    const title = outline?.title || topic;
    const now   = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');

    // 构建 frontmatter
    const fm = [
      '---',
      `title: "${title}"`,
      `category: express`,
      `style: ${style}`,
      `topic: "${topic}"`,
      `created: ${now.toISOString()}`,
      `wordcount: ${draft.wordCount}`,
      sourcePages.length
        ? `references:\n${sourcePages.map(p => `  - "[[${p}]]"`).join('\n')}`
        : `references: []`,
      tags.length
        ? `tags:\n${tags.map(t => `  - ${t}`).join('\n')}`
        : `tags: []`,
      '---',
      ''
    ].join('\n');

    // 构建正文（加一级标题）
    const body = `# ${title}\n\n${content}`;

    // 来源引用尾注
    const refSection = sourcePages.length
      ? [
          '',
          '---',
          '',
          '## 📚 知识来源',
          '',
          ...sourcePages.map(p => `- [[${p}]]`),
          ''
        ].join('\n')
      : '';

    const fullContent = fm + body + refSection;

    // 安全文件名
    const safeName = title
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 60);
    const fileName = `${dateStr}-${safeName}.md`;
    const filePath = normalizePath(`${wikiDir}/${fileName}`);

    await this.app.vault.adapter.write(filePath, fullContent);

    return filePath;
  }
}