import { ChunkMeta, PageType } from "../../core/types";
import { simpleHash, normalizeText } from "../../core/utils";
import { TokenEstimator } from "./token-estimator";

export interface ChunkInput {
  path: string;
  fileTitle: string;
  fileType: PageType | "raw";
  content: string;       // 完整 Markdown 正文（不含 frontmatter）
  fileMtime: number;
}

export interface ChunkOutput {
  id: string;
  path: string;
  fileTitle: string;
  fileType: PageType | "raw";
  section: string;
  sectionIndex: number;
  text: string;
  hash: string;
  tokens: number;
  fileMtime: number;
}

export class Chunker {
  constructor(
    private maxChars: number = 800,
    private minChars: number = 100,
  ) {}

  /**
   * 智能切片：以章节为主，超长再细分
   */
  chunk(input: ChunkInput): ChunkOutput[] {
    const text = normalizeText(input.content);
    if (!text) return [];

    // 1. 按章节切（## 二级标题）
    const sections = this.splitByHeadings(text);

    // 2. 对每个章节：太长就细分，太短就合并
    const chunks: ChunkOutput[] = [];
    let buffer: { heading: string; content: string } | null = null;
    let sectionIdx = 0;

    for (const sec of sections) {
      if (sec.content.length > this.maxChars) {
        // 超长：先把 buffer 输出，再细分
        if (buffer) {
          chunks.push(this.makeChunk(input, buffer.heading, buffer.content, sectionIdx++));
          buffer = null;
        }
        const subs = this.splitLongContent(sec.heading, sec.content);
        for (const sub of subs) {
          chunks.push(this.makeChunk(input, sec.heading, sub, sectionIdx++));
        }
      } else if (sec.content.length < this.minChars && buffer) {
        // 太短：合并到 buffer
        buffer.content += `\n\n${sec.heading}\n${sec.content}`;
        if (buffer.content.length >= this.minChars) {
          chunks.push(this.makeChunk(input, buffer.heading, buffer.content, sectionIdx++));
          buffer = null;
        }
      } else if (sec.content.length < this.minChars) {
        // 太短且无 buffer：开始 buffer
        buffer = { heading: sec.heading, content: sec.content };
      } else {
        // 正常长度：先把 buffer 输出
        if (buffer) {
          chunks.push(this.makeChunk(input, buffer.heading, buffer.content, sectionIdx++));
          buffer = null;
        }
        chunks.push(this.makeChunk(input, sec.heading, sec.content, sectionIdx++));
      }
    }

    // 收尾 buffer
    if (buffer && buffer.content.length > 30) {
      chunks.push(this.makeChunk(input, buffer.heading, buffer.content, sectionIdx++));
    }

    return chunks;
  }

  /**
   * 按 ## 标题切分
   */
  private splitByHeadings(text: string): Array<{ heading: string; content: string }> {
    const result: Array<{ heading: string; content: string }> = [];
    const lines = text.split("\n");
    let currentHeading = "## 引言";
    let currentContent: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch && headingMatch[1].length <= 3) {
        // 遇到标题，输出之前的
        if (currentContent.length > 0) {
          const content = currentContent.join("\n").trim();
          if (content) {
            result.push({ heading: currentHeading, content });
          }
        }
        currentHeading = line.trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    // 收尾
    if (currentContent.length > 0) {
      const content = currentContent.join("\n").trim();
      if (content) {
        result.push({ heading: currentHeading, content });
      }
    }

    return result;
  }

  /**
   * 长内容细分（按段落切）
   */
  private splitLongContent(heading: string, content: string): string[] {
    const paragraphs = content.split(/\n{2,}/);
    const result: string[] = [];
    let buffer = "";

    for (const p of paragraphs) {
      if (!p.trim()) continue;

      if ((buffer + "\n\n" + p).length <= this.maxChars) {
        buffer = buffer ? `${buffer}\n\n${p}` : p;
      } else {
        if (buffer) result.push(buffer);
        // 单段还是超长：硬切
        if (p.length > this.maxChars) {
          for (let i = 0; i < p.length; i += this.maxChars) {
            result.push(p.substring(i, i + this.maxChars));
          }
          buffer = "";
        } else {
          buffer = p;
        }
      }
    }

    if (buffer) result.push(buffer);
    return result;
  }

  private makeChunk(
    input: ChunkInput,
    heading: string,
    content: string,
    sectionIndex: number,
  ): ChunkOutput {
    const text = `${heading}\n${content}`.trim();
    const hash = simpleHash(text);
    const id = `${input.path}#${sectionIndex}#${hash}`;

    return {
      id,
      path: input.path,
      fileTitle: input.fileTitle,
      fileType: input.fileType,
      section: heading,
      sectionIndex,
      text,
      hash,
      tokens: TokenEstimator.estimate(text),
      fileMtime: input.fileMtime,
    };
  }
}