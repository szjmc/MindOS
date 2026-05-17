import type {
  ArticleDraft,
  ArticleOutline,
  OutlineSection
} from '../../core/types';
import { buildArticleSystemPrompt, getStyleTemplate } from './style-templates';
import type { AIClientLike } from './outline-builder';

// ----------------------------------------------------------------
// 流式回调类型
// ----------------------------------------------------------------

/** 每次生成一个章节时触发 */
export type SectionProgressCallback = (
  sectionIndex: number,
  sectionTitle: string,
  sectionContent: string,
  isComplete: boolean
) => void;

/** 整体进度回调 */
export type GenerationProgressCallback = (
  completedSections: number,
  totalSections:     number,
  accumulatedContent: string
) => void;

// ----------------------------------------------------------------
// StreamAIClientLike（支持流式输出的 AI 接口）
// ----------------------------------------------------------------

export interface StreamAIClientLike extends AIClientLike {
  /**
   * 流式 chat，每次收到 token 回调 onToken
   * 返回完整内容
   */
  chatStream(
    systemPrompt:  string,
    userMessage:   string,
    onToken:       (token: string) => void,
    signal?:       AbortSignal
  ): Promise<string>;
}

// ----------------------------------------------------------------
// ArticleGenerator
// ----------------------------------------------------------------

export class ArticleGenerator {
  private aiClient: StreamAIClientLike;

  constructor(aiClient: StreamAIClientLike) {
    this.aiClient = aiClient;
  }

  // ---- 公开入口 ------------------------------------------------

  /**
   * 逐节生成文章正文（流式输出）
   *
   * 策略：
   * - 每个 OutlineSection 单独请求 AI，减少单次 token 压力
   * - 上一节完整内容作为后续节的上下文（滚动窗口）
   * - 生成完所有节后合并为完整文章
   */
  async generateArticle(
    draft: ArticleDraft,
    outline: ArticleOutline,
    onSectionProgress: SectionProgressCallback,
    onOverallProgress: GenerationProgressCallback,
    signal?: AbortSignal
  ): Promise<string> {

    const systemPrompt = buildArticleSystemPrompt(outline.style);
    const sections     = outline.sections;
    const total        = sections.length;

    // 已生成的节内容（用于给后续节作为上下文）
    const generatedSections: { title: string; content: string }[] = [];

    for (let i = 0; i < sections.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const section = sections[i];
      const userMsg = this.buildSectionUserMessage(
        outline,
        section,
        i,
        generatedSections
      );

      let sectionContent = '';

      // 流式输出本节
      const fullContent = await this.aiClient.chatStream(
        systemPrompt,
        userMsg,
        (token) => {
          sectionContent += token;
          onSectionProgress(i, section.title, sectionContent, false);
        },
        signal
      );

      sectionContent = fullContent;

      // 记录已生成节
      generatedSections.push({ title: section.title, content: sectionContent });

      // 通知本节完成
      onSectionProgress(i, section.title, sectionContent, true);

      // 通知整体进度
      const accumulated = this.assembleArticle(outline, generatedSections);
      onOverallProgress(i + 1, total, accumulated);
    }

    // 最终合并
    return this.assembleArticle(outline, generatedSections);
  }

  // ---- 单节 Prompt 构建 ----------------------------------------

  private buildSectionUserMessage(
    outline:    ArticleOutline,
    section:    OutlineSection,
    index:      number,
    prevSections: { title: string; content: string }[]
  ): string {
    const tpl   = getStyleTemplate(outline.style);
    const parts: string[] = [];

    // 1. 文章信息
    parts.push(`## 文章信息`);
    parts.push(`- 标题：${outline.title}`);
    parts.push(`- 摘要：${outline.oneLiner}`);
    parts.push(`- 目标读者：${outline.targetAudience}`);
    parts.push(`- 风格：${tpl.label}`);
    parts.push('');

    // 2. 完整大纲（让 AI 知道全局结构）
    parts.push(`## 文章完整大纲`);
    outline.sections.forEach((s, i) => {
      const marker = i === index ? '👉 ' : '   ';
      parts.push(`${marker}${i + 1}. ${s.title}（约 ${s.estimatedWords} 字）`);
      s.keyPoints.forEach(kp => parts.push(`      - ${kp}`));
    });
    parts.push('');

    // 3. 已生成内容（滚动窗口，最近 2 节避免 token 过长）
    const contextSections = prevSections.slice(-2);
    if (contextSections.length > 0) {
      parts.push(`## 已生成内容（供参考，保持风格连贯）`);
      contextSections.forEach(s => {
        parts.push(`### ${s.title}`);
        // 只取前 400 字作为上下文
        parts.push(s.content.slice(0, 400) + (s.content.length > 400 ? '...' : ''));
        parts.push('');
      });
    }

    // 4. 当前任务
    parts.push(`## 当前任务`);
    parts.push(
      index === 0
        ? `请撰写文章的**第一节**内容，注意开篇要有吸引力。`
        : index === outline.sections.length - 1
        ? `请撰写文章的**最后一节**内容，注意结尾要有力量感，给读者留下印象。`
        : `请撰写文章的**第 ${index + 1} 节**内容。`
    );
    parts.push('');
    parts.push(`**章节标题**：${section.title}`);
    parts.push(`**目标字数**：约 ${section.estimatedWords} 字`);
    parts.push('');
    parts.push(`**本节要涵盖的要点**：`);
    section.keyPoints.forEach(kp => parts.push(`- ${kp}`));
    parts.push('');
    parts.push(`## 输出格式`);
    parts.push(`- 直接以 \`## ${section.title}\` 开头（不要重复文章总标题）`);
    parts.push(`- 只输出本节内容，不要输出其他章节`);
    parts.push(`- 保持与已生成内容一致的风格和语气`);

    return parts.join('\n');
  }

  // ---- 内容组装 ------------------------------------------------

  /**
   * 将所有节拼合为完整 Markdown 正文
   */
  private assembleArticle(
    outline:    ArticleOutline,
    sections:   { title: string; content: string }[]
  ): string {
    const parts: string[] = [];

    // 摘要 callout（如果有 oneLiner）
    if (outline.oneLiner) {
      parts.push(`> 💡 **摘要**：${outline.oneLiner}`);
      parts.push('');
    }

    // 拼接各节正文
    for (const sec of sections) {
      parts.push(sec.content.trim());
      parts.push('');
    }

    return parts.join('\n').trim();
  }

  // ---- 便捷方法：生成文章引言（可选，放最前面） -----------------

  /**
   * 可选：在正式逐节生成前，先生成一段引言（200字左右）
   * 让文章结构更完整，作为整篇的"导语"
   */
  async generateIntro(
    outline:  ArticleOutline,
    onToken:  (token: string) => void,
    signal?:  AbortSignal
  ): Promise<string> {
    const systemPrompt = buildArticleSystemPrompt(outline.style);
    const userMsg = [
      `## 文章信息`,
      `- 标题：${outline.title}`,
      `- 摘要：${outline.oneLiner}`,
      `- 目标读者：${outline.targetAudience}`,
      '',
      `## 文章大纲`,
      ...outline.sections.map((s, i) => `${i + 1}. ${s.title}`),
      '',
      `## 任务`,
      `请为这篇文章写一段**引言**（约 150-200 字）。`,
      `引言需要：`,
      `1. 点明文章要解决的核心问题`,
      `2. 说明读完本文能获得什么`,
      `3. 语气与文章整体风格一致`,
      '',
      `直接输出引言文字，不加任何标题。`
    ].join('\n');

    return await this.aiClient.chatStream(
      systemPrompt,
      userMsg,
      onToken,
      signal
    );
  }

  // ---- 便捷方法：重写单段落 ------------------------------------

  /**
   * 对已有段落进行重写（改风格/改长度/改角度）
   */
  async rewriteParagraph(
    paragraph:       string,
    instruction:     string,
    style:           string,
    onToken:         (token: string) => void,
    signal?:         AbortSignal
  ): Promise<string> {
    const systemPrompt = `你是一位专业的文字编辑，擅长段落重写与优化。保持语言流畅自然。`;
    const userMsg = [
      `## 原始段落`,
      paragraph,
      '',
      `## 重写要求`,
      instruction,
      '',
      `## 风格参考`,
      style,
      '',
      `请直接输出重写后的段落，不要加任何说明。`
    ].join('\n');

    return await this.aiClient.chatStream(
      systemPrompt,
      userMsg,
      onToken,
      signal
    );
  }
}