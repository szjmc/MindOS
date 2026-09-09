import { App, Notice, Modal, setIcon, loadPdfJs, normalizePath, TFolder, TFile } from "obsidian";
import { MindOSSettings } from "../../core/types";
import { QuickNoteService } from "./quick-note";

export interface CaptureMethod {
  id: string;
  icon: string;
  label: string;
  description: string;
  color: string;
  beta?: boolean;
  disabled?: boolean;
  category?: 'capture' | 'analysis';
  featured?: boolean;
}

export class CaptureService {
  /** PDF 提取后暂存的页面图片名列表，供 pipeline 完成后追加到知识笔记 */
  private _pendingPdfImages: string[] = [];

  private captureMethods: CaptureMethod[] = [
    {
      id: "web_clipper",
      icon: "globe",
      label: "网页剪藏",
      description: "使用浏览器扩展一键采集 AI 对话",
      color: "#3b82f6",
      category: 'capture',
    },
    {
      id: "clipboard",
      icon: "clipboard-paste",
      label: "剪贴板粘贴",
      description: "手动粘贴文本或链接到输入框",
      color: "#7c3aed",
      category: 'capture',
    },
    {
      id: "quick_note",
      icon: "lightbulb",
      label: "闪念笔记",
      description: "快速记录想法，自动存入 Inbox",
      color: "#f59e0b",
      category: 'capture',
    },
    {
      id: "file_upload",
      icon: "folder-open",
      label: "PDF/文件上传",
      description: "上传 PDF、TXT、MD 文件提取内容",
      color: "#10b981",
      beta: true,
      category: 'capture',
    },
    {
      id: "audio_transcribe",
      icon: "mic",
      label: "音频转录",
      description: "选择音频文件，Whisper AI 自动转录",
      color: "#ec4899",
      beta: true,
      category: 'capture',
    },
    {
      id: "screen_ocr",
      icon: "scissors",
      label: "截图 OCR",
      description: "识别剪贴板截图或本地图片中的文字",
      color: "#f97316",
      beta: true,
      category: 'capture',
    },
  ];

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private quickNoteService: QuickNoteService,
    /** 处理完成后返回创建/修改的文件路径列表，供后处理使用 */
    private onTextCapture: (text: string, source: string, title?: string) => Promise<string[]>,
    private onContextAware: () => void = () => {},
    private onKnowledgeGaps: () => void = () => {},
  ) {}

  getCaptureMethods(): CaptureMethod[] {
    return this.captureMethods;
  }

  getCaptureMethodsByCategory(category: 'capture' | 'analysis'): CaptureMethod[] {
    return this.captureMethods.filter(m => m.category === category);
  }

  async executeCapture(methodId: string): Promise<void> {
    switch (methodId) {
      case "web_clipper":
        this.showWebClipperInfo();
        break;
      case "clipboard":
        this.showClipboardModal();
        break;
      case "quick_note":
        this.quickNoteService.showQuickNoteModal();
        break;
      case "file_upload":
        this.showFileUploadModal();
        break;
      case "context_aware":
        this.onContextAware();
        break;
      case "knowledge_gaps":
        this.onKnowledgeGaps();
        break;
      case "audio_transcribe":
        this.showAudioTranscribeModal();
        break;
      case "screen_ocr":
        this.showScreenOCRModal();
        break;
      default:
        new Notice("功能开发中...");
    }
  }

  // ── 剪贴板粘贴 ──────────────────────────────────────────────

  private showClipboardModal() {
    const modal = new ClipboardModal(this.app, async (text) => {
      if (text && text.trim()) {
        await this.onTextCapture(text.trim(), "clipboard");
      }
    });
    modal.open();
  }

  // ── PDF / 文件上传 ──────────────────────────────────────────

  private async showFileUploadModal() {
    const modal = new FileUploadModal(this.app, async (file) => {
      const loadingNotice = new Notice(`⏳ 正在读取 ${file.name}…`, 0);
      try {
        const result = await this.readFileAsText(file);
        loadingNotice.hide();
        if (!result.text || !result.text.trim()) {
          new Notice("⚠️ 文件内容为空，无法处理");
          return;
        }
        // 检查是否是错误提示（无 API Key 的扫描版 PDF）
        if (result.text.startsWith("[PDF ") && result.text.includes("配置 API Key")) {
          new Notice(result.text.replace(/^\[PDF /, "⚠️ ").replace(/\]$/, ""));
          return;
        }

        // PDF 提取后暂存图片列表
        this._pendingPdfImages = result.savedImages ?? [];
        const imageCount = this._pendingPdfImages.length;

        new Notice(`📄 已读取 ${file.name}（${result.text.length} 字符${imageCount > 0 ? `，${imageCount} 页截图` : ""}），开始整理…`);

        // processConversation 完成后返回创建的文件路径
        const createdPaths = await this.onTextCapture(result.text.trim(), "file_upload", file.name);

        // pipeline 完成后，将 PDF 页面图片追加到生成的知识笔记
        if (imageCount > 0 && this._pendingPdfImages.length > 0) {
          let appended = false;

          // 策略 1：用回调返回的路径直接追加（adapter 直查文件系统，无需等待 vault 索引）
          if (createdPaths && createdPaths.length > 0) {
            appended = await this.appendPdfImagesToWikiNote(createdPaths, file.name);
          }

          // 策略 2：兜底——搜索知识库目录中最近修改的笔记
          if (!appended) {
            appended = await this.findAndAppendPdfImages(file.name);
          }

          // 策略 3：再等 2 秒后重试一次（极端情况下 adapter 也可能有延迟）
          if (!appended) {
            console.log("[MindOS] PDF 图片追加第一次失败，2秒后重试...");
            await new Promise(r => setTimeout(r, 2000));
            appended = await this.findAndAppendPdfImages(file.name);
          }

          if (appended) {
            this._pendingPdfImages = [];
          } else {
            new Notice(`⚠️ PDF ${imageCount} 页截图已保存到 attachments/，但未能自动追加到笔记。可手动在笔记末尾添加 ![[图片名]] 引用。`);
          }
        }
      } catch (err) {
        loadingNotice.hide();
        new Notice(`❌ 读取文件失败：${err instanceof Error ? err.message : "未知错误"}`);
      }
    });
    modal.open();
  }

  /**
   * 用 pipeline 返回的文件路径直接追加 PDF 页面截图。
   * 使用 vault.modify() 确保Obsidian预览模式能正确刷新显示图片。
   * @returns 是否成功追加了图片
   */
  private async appendPdfImagesToWikiNote(createdPaths: string[], pdfFilename: string): Promise<boolean> {
    try {
      let appended = false;
      for (const filePath of createdPaths) {
        // 通过 vault API 获取 TFile（带重试，pipeline 完成后索引通常已就绪）
        const file = await this.retryGetTFile(filePath);
        if (!file) {
          console.warn("[MindOS] appendPdfImages target not found:", filePath);
          continue;
        }

        const content = await this.app.vault.read(file);

        // 检查是否已有 "原文截图" 板块（避免重复追加）
        if (content.includes("## 📎 PDF 原文截图")) {
          continue;
        }

        // 构建图片板块
        const imageLines = this._pendingPdfImages.map(name => `![[${name}]]`);
        const imageSection = `\n\n---\n\n## 📎 PDF 原文截图\n\n> 以下为 **${pdfFilename}** 各页截图，可对照原文查看操作界面。\n\n${imageLines.join("\n\n")}`;

        // 使用 vault.modify() 而非 adapter.write()，确保Obsidian变更检测系统正常工作
        await this.app.vault.modify(file, content.trimEnd() + imageSection);
        new Notice(`✅ 已将 ${this._pendingPdfImages.length} 页截图追加到知识笔记`);
        appended = true;
      }
      return appended;
    } catch (err) {
      console.warn("[MindOS] appendPdfImagesToWikiNote failed", err);
      return false;
    }
  }

  /**
   * 兜底策略：当回调返回的路径列表为空或追加失败时，
   * 直接搜索知识库目录中最近修改的 md 文件，找到后追加图片。
   *
   * 这个方法在 pipeline 完成后才调用，所以文件已经创建好了。
   * 使用 vault.modify() 确保Obsidian预览能正确刷新显示。
   * @returns 是否成功追加了图片
   */
  private async findAndAppendPdfImages(pdfFilename: string): Promise<boolean> {
    try {
      const settings = this.getSettings();
      const baseFolder = settings.baseFolder || "AI Prompts";

      // 搜索知识库的所有子目录
      const wikiDirs = [
        normalizePath(`${baseFolder}/知识库/主题`),
        normalizePath(`${baseFolder}/知识库/概念`),
        normalizePath(`${baseFolder}/知识库/实体`),
        normalizePath(`${baseFolder}/知识库/对比`),
        normalizePath(`${baseFolder}/知识库/概述`),
      ];

      const now = Date.now();
      let bestCandidate: { file: TFile; mtime: number } | null = null;

      for (const dir of wikiDirs) {
        const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(dir + "/"));

        for (const f of files) {
          const stat = await this.app.vault.adapter.stat(f.path);
          if (stat && stat.mtime) {
            // 找最近 10 分钟内修改的文件
            const ageMs = now - stat.mtime;
            if (ageMs < 10 * 60 * 1000) {
              if (!bestCandidate || stat.mtime > bestCandidate.mtime) {
                bestCandidate = { file: f, mtime: stat.mtime };
              }
            }
          }
        }
      }

      if (!bestCandidate) {
        console.log("[MindOS] findAndAppendPdfImages: 未找到最近修改的知识笔记");
        return false;
      }

      // 用 vault API 读取（确保缓存一致性）
      const content = await this.app.vault.read(bestCandidate.file);

      // 去重检查
      if (content.includes("## 📎 PDF 原文截图")) {
        console.log("[MindOS] findAndAppendPdfImages: 笔记已有截图板块，跳过");
        return false;
      }

      // 构建图片板块
      const imageLines = this._pendingPdfImages.map(name => `![[${name}]]`);
      const imageSection = `\n\n---\n\n## 📎 PDF 原文截图\n\n> 以下为 **${pdfFilename}** 各页截图，可对照原文查看操作界面。\n\n${imageLines.join("\n\n")}`;

      // 使用 vault.modify() 而非 adapter.write()，确保Obsidian变更检测系统正常工作
      await this.app.vault.modify(bestCandidate.file, content.trimEnd() + imageSection);
      new Notice(`✅ 已将 ${this._pendingPdfImages.length} 页截图追加到「${bestCandidate.file.basename}」`);
      return true;
    } catch (err) {
      console.warn("[MindOS] findAndAppendPdfImages failed", err);
      return false;
    }
  }

  /**
   * 通过路径获取 TFile，带重试机制。
   * pipeline 完成后 vault 索引可能需要一点时间同步，
   * 所以最多重试 3 次，每次间隔 500ms。
   */
  private async retryGetTFile(filePath: string, retries = 3): Promise<TFile | null> {
    for (let i = 0; i < retries; i++) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        return file;
      }
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }
    return null;
  }

  /** 文件读取结果：文本内容 + 可选的已保存图片名列表（PDF 时使用） */
  private readFileAsText(file: File): Promise<{ text: string; savedImages?: string[] }> {
    return new Promise((resolve, reject) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

      // PDF：使用 Obsidian 内置 PDF.js 提取文本+保存页面图片，扫描版 fallback 到 Vision OCR
      if (ext === "pdf") {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            // ⚠️ 必须 slice() 复制一份，否则 ArrayBuffer 会在异步操作中 detached
            const raw = e.target!.result as ArrayBuffer;
            const arrayBuffer = raw.slice(0);
            const result = await extractPDFText(arrayBuffer, file.name, this.getSettings(), this.app);
            resolve(result);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error("FileReader 读取失败"));
        reader.readAsArrayBuffer(file);
      } else {
        // txt / md
        const reader = new FileReader();
        reader.onload = (e) => resolve({ text: String(e.target!.result ?? "") });
        reader.onerror = () => reject(new Error("FileReader 读取失败"));
        reader.readAsText(file, "utf-8");
      }
    });
  }

  // ── 音频转录 ────────────────────────────────────────────────

  private showAudioTranscribeModal() {
    const settings = this.getSettings();
    if (!settings.apiKey && !settings.embeddingApiKey) {
      new Notice("⚠️ 请先在设置中配置 API Key（音频转录需要 OpenAI Whisper API）");
      return;
    }
    const modal = new AudioTranscribeModal(this.app, async (file) => {
      const loadingNotice = new Notice(`🎙️ 正在转录 ${file.name}…`, 0);
      try {
        const text = await transcribeAudioFile(file, settings);
        loadingNotice.hide();
        if (!text || !text.trim()) {
          new Notice("⚠️ 转录结果为空");
          return;
        }
        new Notice(`✅ 转录完成（${text.length} 字符）`);
        await this.onTextCapture(text.trim(), "audio_transcribe", file.name);
      } catch (err) {
        loadingNotice.hide();
        new Notice(`❌ 转录失败：${err instanceof Error ? err.message : "未知错误"}`);
      }
    });
    modal.open();
  }

  // ── 截图 OCR ────────────────────────────────────────────────

  private showScreenOCRModal() {
    const settings = this.getSettings();
    if (!settings.apiKey && !settings.embeddingApiKey) {
      new Notice("⚠️ 请先在设置中配置 API Key（截图 OCR 需要 GPT-4o Vision API）");
      return;
    }
    const modal = new ScreenOCRModal(this.app, async (source) => {
      const loadingNotice = new Notice("🔍 正在识别图片文字…", 0);
      try {
        const text = await ocrImageSource(source, settings);
        loadingNotice.hide();
        if (!text || !text.trim()) {
          new Notice("⚠️ OCR 未识别到文字");
          return;
        }
        new Notice(`✅ OCR 完成（${text.length} 字符）`);
        await this.onTextCapture(text.trim(), "screen_ocr", "截图 OCR");
      } catch (err) {
        loadingNotice.hide();
        new Notice(`❌ OCR 失败：${err instanceof Error ? err.message : "未知错误"}`);
      }
    });
    modal.open();
  }

  // ── 网页剪藏说明 ────────────────────────────────────────────

  private showWebClipperInfo() {
    const modal = new InfoModal(this.app, {
      title: "🌐 网页剪藏（浏览器扩展）",
      content: `
        <div style="text-align: center; margin-bottom: 20px;">
          <div style="font-size: 48px; margin-bottom: 8px;">💬</div>
          <div style="font-size: 18px; font-weight: 600; color: var(--text-normal);">MindOS 浏览器扩展</div>
        </div>

        <div style="background: var(--background-secondary); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600;">🚀 支持的平台</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 8px;">
            <span style="background: rgba(124, 58, 237, 0.1); color: #7c3aed; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;">豆包</span>
            <span style="background: rgba(16, 185, 129, 0.1); color: #059669; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;">ChatGPT</span>
            <span style="background: rgba(59, 130, 246, 0.1); color: #2563eb; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;">Kimi</span>
            <span style="background: rgba(245, 158, 11, 0.1); color: #d97706; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;">Claude</span>
            <span style="background: rgba(236, 72, 153, 0.1); color: #db2777; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;">DeepSeek</span>
            <span style="background: rgba(139, 92, 246, 0.1); color: #7c3aed; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;">Gemini</span>
            <span style="background: rgba(107, 114, 128, 0.1); color: #4b5563; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500;">+ 14 个更多</span>
          </div>
        </div>

        <h4 style="margin: 16px 0 8px 0; font-size: 14px; font-weight: 600;">📥 安装步骤</h4>
        <ol style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;">
          <li>在 Chrome/Edge 浏览器中打开 <code>chrome://extensions</code></li>
          <li>开启右上角的「开发者模式」</li>
          <li>点击「加载已解压的扩展程序」</li>
          <li>选择插件目录下的 <code>浏览器插件</code> 文件夹</li>
        </ol>

        <h4 style="margin: 16px 0 8px 0; font-size: 14px; font-weight: 600;">🎯 使用方式</h4>
        <ol style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.8;">
          <li>打开豆包、ChatGPT、Kimi 等任意 AI 网站</li>
          <li>点击页面右下角的「💬 MindOS」按钮</li>
          <li>选择要采集的对话回合</li>
          <li>点击「📤 发送到 Obsidian」</li>
        </ol>

        <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--background-modifier-border); text-align: center;">
          <p style="font-size: 12px; color: var(--text-muted); margin: 0;">
            💡 浏览器扩展已预置，无需额外下载
          </p>
        </div>
      `,
    });
    modal.open();
  }
}

/**
 * 清理图片文件名，确保在 Obsidian ![[引用]] 中能正确渲染。
 * 去除特殊字符、空格→连字符、限制长度。
 */
function sanitizeImageFileName(rawName: string): string {
  let name = rawName
    .replace(/[\[\]#\|\\]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 70);

  if (!name || name.length < 2) {
    name = `pdf-${Date.now().toString(36)}`;
  }

  return name;
}

// ════════════════════════════════════════════════════════════════
// PDF 文本+图片提取（Obsidian 内置 PDF.js + Vision API 兜底）
// ════════════════════════════════════════════════════════════════

/** PDF 提取结果 */
interface PDFExtractResult {
  text: string;
  /** 已保存到 vault 的图片文件名列表（如 ["07云数据库RDS的操作实践-p1.png"]） */
  savedImages: string[];
}

/**
 * 使用 Obsidian 内置的 PDF.js（loadPdfJs）加载文档并提取文本 + 页面图片。
 *
 * 策略：
 *   1. loadPdfJs() → getTextContent() → 文字型 PDF（最常见）
 *   2. 每页渲染为 canvas 图片，保存到 vault 附件目录
 *   3. 图片名通过 savedImages 返回，由调用方在 pipeline 完成后追加到知识笔记
 *   4. 若提取文本太少 → 视为扫描/图片 PDF → 调 GPT-4o Vision OCR
 *   5. 若无 API Key → 返回提示信息
 *
 * 注意：不再将 ![[image]] 引用嵌入文本中，
 * 因为 AI pipeline 会重组内容并丢弃这些引用。
 * 图片追加通过后处理步骤完成。
 */
async function extractPDFText(
  buffer: ArrayBuffer,
  filename: string,
  settings?: MindOSSettings,
  app?: App,
): Promise<PDFExtractResult> {
  const savedImages: string[] = [];

  // ── 策略 1：Obsidian 内置 PDF.js 提取文字 + 页面图片 ──────────
  try {
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    // 准备图片保存目录
    const imageFolder = app
      ? await ensureAttachmentFolder(app, filename)
      : null;

    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // 按 y 坐标排序以保持阅读顺序，然后拼接文本
      const sortedItems = content.items.sort((a: any, b: any) => {
        const dy = (b.transform?.[5] ?? 0) - (a.transform?.[5] ?? 0);
        if (Math.abs(dy) > 2) return dy;
        return (a.transform?.[4] ?? 0) - (a.transform?.[4] ?? 0);
      });
      const pageText = sortedItems.map((item: any) => item.str).join("");

      // 渲染页面为图片并保存到 vault（与文本分开处理）
      if (imageFolder && app) {
        const baseName = filename.replace(/\.pdf$/i, "");
        const safeName = sanitizeImageFileName(baseName);
        const imageName = `${safeName}-p${i}.png`;
        const imagePath = normalizePath(`${imageFolder}/${imageName}`);

        const scale = 2; // 高清渲染
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx as any, viewport }).promise;

        // canvas → binary PNG
        const blob = await new Promise<Blob>((resolve) =>
          canvas.toBlob((b) => resolve(b!), "image/png", 0.92)
        );
        const arrayBuf = await blob.arrayBuffer();

        // 保存到 vault（如已存在则覆盖）
        if (await app.vault.adapter.exists(imagePath)) {
          const existingFile = app.vault.getAbstractFileByPath(imagePath);
          if (existingFile) await app.vault.delete(existingFile);
        }
        await app.vault.createBinary(imagePath, new Uint8Array(arrayBuf));
        savedImages.push(imageName);
      }

      // 文本单独收集，不再嵌入 ![[image]]（AI pipeline 会丢弃它们）
      pages.push(pageText);
    }

    const fullText = pages.join("\n\n");

    // 判断是否提取到了有效文本（平均每页 > 15 个字符）
    const avgCharsPerPage = fullText.length / Math.max(pdf.numPages, 1);
    if (avgCharsPerPage > 15 && /[\u4e00-\u9fa5a-zA-Z0-9]/.test(fullText)) {
      return { text: fullText, savedImages };
    }

    // 文本太少 → 可能是扫描版 PDF，进入策略 2
    if (!settings?.apiKey && !settings?.embeddingApiKey) {
      if (savedImages.length > 0) {
        // 扫描版但有图片，返回文本+提示（图片会通过后处理追加）
        return { text: fullText + `\n\n> ⚠️ 此 PDF 为扫描版，文字内容较少。下方图片为各页截图。`, savedImages };
      }
      return { text: `[PDF "${filename}" 似乎是扫描版图片文档，无法提取文字。\n提示：请在设置中配置 API Key 以启用 AI OCR 功能。]`, savedImages };
    }
  } catch (err) {
    if (!settings?.apiKey && !settings?.embeddingApiKey) {
      return { text: `[PDF 解析失败：${filename}\n原因：${err instanceof Error ? err.message : "未知错误"}\n提示：请在设置中配置 API Key 以启用 AI OCR 功能。]`, savedImages };
    }
  }

  // ── 策略 2：GPT-4o Vision OCR（扫描版 / 图片 PDF）──────────────
  const visionText = await extractPDFViaVision(buffer, filename, settings!);
  return { text: visionText, savedImages };
}

/**
 * 确保 vault 中存在附件文件夹，返回路径。
 * 使用 Obsidian 的附件文件夹配置，或默认在当前笔记目录下创建。
 */
async function ensureAttachmentFolder(app: App, filename: string): Promise<string> {
  // 使用 Obsidian 配置的附件文件夹路径
  const attachmentConfig = (app.vault as any).config?.attachmentFolderPath;
  let folderPath: string;

  if (attachmentConfig && attachmentConfig !== "/" && attachmentConfig !== "") {
    // 用户配置了专门的附件文件夹
    folderPath = normalizePath(attachmentConfig);
  } else {
    // 默认：在 vault 根目录下创建 "attachments" 文件夹
    folderPath = normalizePath("attachments");
  }

  // 确保文件夹存在
  const existing = app.vault.getAbstractFileByPath(folderPath);
  if (!existing) {
    await app.vault.createFolder(folderPath);
  }

  return folderPath;
}

/**
 * 将 PDF 每页渲染为 canvas 图片，再送 GPT-4o Vision 提取文字。
 * 适用于扫描版、图片型 PDF。
 */
async function extractPDFViaVision(
  buffer: ArrayBuffer,
  filename: string,
  settings: MindOSSettings,
): Promise<string> {
  const apiKey = settings.apiKey || settings.embeddingApiKey;
  if (!apiKey) throw new Error("未配置 API Key");

  const apiBase = (settings.apiBase || "https://api.openai.com").replace(/\/$/, "");
  const url = `${apiBase}/v1/chat/completions`;

  // 用 Obsidian 内置 PDF.js 将每页渲染为图片
  const pdfjsLib = await loadPdfJs();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const allPageTexts: string[] = [];
  const MAX_PAGES = 30; // 限制最大页数避免费用爆炸

  for (let i = 1; i <= Math.min(pdf.numPages, MAX_PAGES); i++) {
    const page = await pdf.getPage(i);
    const scale = 1.5; // 渲染倍率，越高识别越准但越慢
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx as any, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/png", 0.9);

    // 单页 OCR
    const body = {
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
            {
              type: "text",
              text:
                "这是 PDF 第 " +
                i +
                "/" +
                pdf.numPages +
                " 页。请完整提取页面中的所有文字内容，保持原有格式和段落结构。不要添加任何解释或评论，直接输出提取的文字。",
            },
          ],
        },
      ],
      max_tokens: 4096,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(`Vision API 返回 ${resp.status}（第 ${i} 页）：${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const pageText = data.choices?.[0]?.message?.content?.trim() ?? "";
    allPageTexts.push(`--- 第 ${i} 页 ---\n${pageText}`);
  }

  if (pdf.numPages > MAX_PAGES) {
    allPageTexts.push(`\n[注：PDF 共 ${pdf.numPages} 页，仅处理前 ${MAX_PAGES} 页]`);
  }

  return allPageTexts.join("\n\n");
}

// ════════════════════════════════════════════════════════════════
// Whisper 音频转录
// ════════════════════════════════════════════════════════════════

async function transcribeAudioFile(file: File, settings: MindOSSettings): Promise<string> {
  const apiKey = settings.apiKey || settings.embeddingApiKey;
  if (!apiKey) throw new Error("未配置 API Key");

  const apiBase = (settings.apiBase || "https://api.openai.com").replace(/\/$/, "");
  const url = `${apiBase}/v1/audio/transcriptions`;

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("model", "whisper-1");
  formData.append("response_format", "text");
  formData.append("language", "zh"); // 优先中文，如混合语言可移除此行

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Whisper API 返回 ${response.status}：${errText.slice(0, 200)}`);
  }

  const result = await response.text();
  return result.trim();
}

// ════════════════════════════════════════════════════════════════
// GPT-4o Vision OCR
// ════════════════════════════════════════════════════════════════

/** OCR 图片来源：base64 data URL 或 File 对象 */
type ImageSource = { type: "base64"; dataUrl: string } | { type: "file"; file: File };

async function ocrImageSource(source: ImageSource, settings: MindOSSettings): Promise<string> {
  const apiKey = settings.apiKey || settings.embeddingApiKey;
  if (!apiKey) throw new Error("未配置 API Key");

  const apiBase = (settings.apiBase || "https://api.openai.com").replace(/\/$/, "");
  const url = `${apiBase}/v1/chat/completions`;

  let dataUrl: string;
  if (source.type === "base64") {
    dataUrl = source.dataUrl;
  } else {
    dataUrl = await fileToDataUrl(source.file);
  }

  const body = {
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
          {
            type: "text",
            text: "请提取图片中所有可见的文字内容，保持原有格式和段落结构，不要添加任何解释或评论，直接输出文字。",
          },
        ],
      },
    ],
    max_tokens: 4096,
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`Vision API 返回 ${response.status}：${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target!.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

/** 从 Electron 剪贴板读取图片并转换为 data URL */
function readClipboardImage(): string | null {
  try {
    const { clipboard } = require("electron");
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    return img.toDataURL();
  } catch {
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// Modal：剪贴板粘贴
// ════════════════════════════════════════════════════════════════

class ClipboardModal extends Modal {
  private textarea: HTMLTextAreaElement;

  constructor(
    app: App,
    private onSubmit: (text: string) => Promise<void>,
  ) {
    super(app);
    this.titleEl.setText("📋 剪贴板粘贴");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-clipboard-modal");

    contentEl.createEl("p", {
      cls: "mindos-clipboard-desc",
      text: "粘贴任意文本或对话内容，AI 将帮您智能整理",
    });

    const inputArea = contentEl.createDiv({ cls: "mindos-clipboard-input" });

    const quickActions = inputArea.createDiv({ cls: "mindos-clipboard-quick-actions" });
    const pasteBtn = quickActions.createEl("button", {
      cls: "mindos-clipboard-quick-btn",
      text: "📋 从剪贴板粘贴",
    });
    pasteBtn.onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          this.textarea.value = text;
          this.textarea.dispatchEvent(new Event("input"));
          new Notice("已从剪贴板粘贴内容");
        }
      } catch {
        new Notice("无法读取剪贴板，请手动粘贴");
      }
    };

    const clearBtn = quickActions.createEl("button", {
      cls: "mindos-clipboard-quick-btn",
      text: "清空",
    });
    clearBtn.onclick = () => { this.textarea.value = ""; };

    this.textarea = inputArea.createEl("textarea", {
      cls: "mindos-clipboard-textarea",
      placeholder: "在此粘贴文本、对话、文章...",
    });
    this.textarea.rows = 10;

    const tips = inputArea.createDiv({ cls: "mindos-clipboard-tips" });
    tips.createEl("h4", { text: "💡 使用提示" });
    const list = tips.createEl("ul");
    list.createEl("li", { text: "粘贴 AI 对话内容（支持豆包、ChatGPT、Kimi 等格式）" });
    list.createEl("li", { text: "粘贴网页文章或文字片段" });
    list.createEl("li", { text: "粘贴任意需要整理的文本内容" });

    const actions = contentEl.createDiv({ cls: "mindos-clipboard-actions" });
    const cancelBtn = actions.createEl("button", {
      cls: "mindos-btn mindos-btn-md mindos-btn-ghost",
      text: "取消",
    });
    cancelBtn.onclick = () => this.close();

    const submitBtn = actions.createEl("button", {
      cls: "mindos-btn mindos-btn-md mindos-btn-primary",
      text: "开始整理",
    });
    submitBtn.onclick = async () => {
      const text = this.textarea.value.trim();
      if (!text) { new Notice("请先输入内容"); return; }
      this.close();
      await this.onSubmit(text);
    };

    // Ctrl/Cmd + Enter 快捷提交
    this.textarea.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const text = this.textarea.value.trim();
        if (text) { this.close(); await this.onSubmit(text); }
      }
    });

    // 自动聚焦
    requestAnimationFrame(() => this.textarea.focus());
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════════
// Modal：文件上传
// ════════════════════════════════════════════════════════════════

class FileUploadModal extends Modal {
  private fileInput: HTMLInputElement;
  private selectedFilesEl: HTMLElement;

  constructor(
    app: App,
    private onSubmit: (file: File) => Promise<void>,
  ) {
    super(app);
    this.titleEl.setText("📁 文件上传");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-upload-modal");

    contentEl.createEl("p", {
      cls: "mindos-upload-desc",
      text: "上传 PDF、TXT、MD 文档，AI 将自动提取并整理内容",
    });

    const uploadArea = contentEl.createDiv({ cls: "mindos-upload-area" });

    this.fileInput = uploadArea.createEl("input", {
      type: "file",
      accept: ".pdf,.txt,.md",
    });
    this.fileInput.style.display = "none";

    const dropZone = uploadArea.createDiv({ cls: "mindos-upload-dropzone" });
    const iconWrap = dropZone.createDiv({ cls: "mindos-upload-icon" });
    setIcon(iconWrap, "upload-cloud");
    dropZone.createEl("p", { cls: "mindos-upload-text", text: "拖拽文件到这里" });
    dropZone.createEl("p", {
      cls: "mindos-upload-subtext",
      text: "支持 PDF / TXT / Markdown，或点击选择",
    });

    dropZone.onclick = () => this.fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.addClass("is-dragging"); };
    dropZone.ondragleave = () => dropZone.removeClass("is-dragging");
    dropZone.ondrop = async (e) => {
      e.preventDefault();
      dropZone.removeClass("is-dragging");
      const file = e.dataTransfer?.files?.[0];
      if (file) await this.handleFile(file);
    };

    this.fileInput.onchange = async () => {
      const file = this.fileInput.files?.[0];
      if (file) await this.handleFile(file);
    };

    this.selectedFilesEl = contentEl.createDiv({ cls: "mindos-upload-selected" });
    this.selectedFilesEl.style.display = "none";

    const actions = contentEl.createDiv({ cls: "mindos-upload-actions" });
    const cancelBtn = actions.createEl("button", {
      cls: "mindos-btn mindos-btn-ghost",
      text: "取消",
    });
    cancelBtn.onclick = () => this.close();
  }

  private async handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const allowed = ["pdf", "txt", "md"];
    if (!allowed.includes(ext)) {
      new Notice(`⚠️ 不支持的文件类型：.${ext}（仅支持 PDF / TXT / MD）`);
      return;
    }
    // 显示选中文件信息
    this.selectedFilesEl.style.display = "block";
    this.selectedFilesEl.empty();
    const item = this.selectedFilesEl.createDiv({ cls: "mindos-upload-file-item" });
    const ic = item.createSpan({ cls: "mindos-upload-file-icon" });
    setIcon(ic, ext === "pdf" ? "file-text" : "file");
    item.createSpan({ cls: "mindos-upload-file-name", text: file.name });
    item.createSpan({
      cls: "mindos-upload-file-size",
      text: formatFileSize(file.size),
    });
    this.close();
    await this.onSubmit(file);
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════════
// Modal：音频转录
// ════════════════════════════════════════════════════════════════

class AudioTranscribeModal extends Modal {
  constructor(
    app: App,
    private onSubmit: (file: File) => Promise<void>,
  ) {
    super(app);
    this.titleEl.setText("🎙️ 音频转录");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-audio-modal");

    contentEl.createEl("p", {
      cls: "mindos-audio-desc",
      text: "选择音频文件，MindOS 将使用 Whisper AI 自动转录为文字",
    });

    // 格式说明
    const formatInfo = contentEl.createDiv({ cls: "mindos-audio-format-info" });
    formatInfo.createEl("span", { text: "支持格式：" });
    ["mp3", "mp4", "m4a", "wav", "ogg", "webm"].forEach(fmt => {
      formatInfo.createEl("code", { cls: "mindos-audio-format-tag", text: fmt });
    });

    // 文件选择区域
    const fileInput = contentEl.createEl("input", {
      type: "file",
      accept: ".mp3,.mp4,.m4a,.wav,.ogg,.webm",
    });
    fileInput.style.display = "none";

    const dropZone = contentEl.createDiv({ cls: "mindos-upload-dropzone" });
    const iconWrap = dropZone.createDiv({ cls: "mindos-upload-icon" });
    setIcon(iconWrap, "mic");
    dropZone.createEl("p", { cls: "mindos-upload-text", text: "拖拽音频文件到这里" });
    dropZone.createEl("p", { cls: "mindos-upload-subtext", text: "或点击选择文件（最大 25 MB）" });

    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.addClass("is-dragging"); };
    dropZone.ondragleave = () => dropZone.removeClass("is-dragging");
    dropZone.ondrop = async (e) => {
      e.preventDefault();
      dropZone.removeClass("is-dragging");
      const file = e.dataTransfer?.files?.[0];
      if (file) { this.close(); await this.onSubmit(file); }
    };

    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (file) { this.close(); await this.onSubmit(file); }
    };

    // 注意事项
    const note = contentEl.createDiv({ cls: "mindos-audio-note" });
    const ni = note.createSpan({ cls: "mindos-audio-note-icon" });
    setIcon(ni, "info");
    note.createSpan({
      text: "转录使用 OpenAI Whisper API，文件大小上限为 25 MB，费用约 $0.006/分钟",
    });

    const actions = contentEl.createDiv({ cls: "mindos-upload-actions" });
    const cancelBtn = actions.createEl("button", {
      cls: "mindos-btn mindos-btn-ghost",
      text: "取消",
    });
    cancelBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════════
// Modal：截图 OCR
// ════════════════════════════════════════════════════════════════

class ScreenOCRModal extends Modal {
  constructor(
    app: App,
    private onSubmit: (source: ImageSource) => Promise<void>,
  ) {
    super(app);
    this.titleEl.setText("🔍 截图 OCR");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-ocr-modal");

    contentEl.createEl("p", {
      cls: "mindos-ocr-desc",
      text: "识别图片中的文字，支持从剪贴板读取截图或选择本地图片文件",
    });

    // 方式一：从剪贴板读取
    const clipboardSection = contentEl.createDiv({ cls: "mindos-ocr-section" });
    const clipboardLabel = clipboardSection.createDiv({ cls: "mindos-ocr-section-label" });
    const lIcon = clipboardLabel.createSpan();
    setIcon(lIcon, "clipboard");
    clipboardLabel.createSpan({ text: "方式一：读取剪贴板截图" });

    const clipboardBtn = clipboardSection.createEl("button", {
      cls: "mindos-btn mindos-btn-primary mindos-btn-md mindos-ocr-btn",
      text: "📋 从剪贴板读取截图",
    });
    clipboardBtn.onclick = async () => {
      // 优先使用 Electron clipboard（支持图片）
      const dataUrl = readClipboardImage();
      if (dataUrl) {
        this.close();
        await this.onSubmit({ type: "base64", dataUrl });
        return;
      }
      // fallback：尝试用 Web Clipboard API 读取图片
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith("image/"));
          if (imgType) {
            const blob = await item.getType(imgType);
            const dataUrl2 = await blobToDataUrl(blob);
            this.close();
            await this.onSubmit({ type: "base64", dataUrl: dataUrl2 });
            return;
          }
        }
        new Notice("⚠️ 剪贴板中没有图片，请先截图（Win: Win+Shift+S，Mac: Cmd+Ctrl+Shift+4）");
      } catch {
        new Notice("⚠️ 无法读取剪贴板图片，请使用「选择图片文件」方式");
      }
    };

    // 分割线
    const divider = contentEl.createDiv({ cls: "mindos-ocr-divider" });
    divider.createSpan({ text: "或" });

    // 方式二：选择本地图片
    const fileSection = contentEl.createDiv({ cls: "mindos-ocr-section" });
    const fileLabel = fileSection.createDiv({ cls: "mindos-ocr-section-label" });
    const fIcon = fileLabel.createSpan();
    setIcon(fIcon, "image");
    fileLabel.createSpan({ text: "方式二：选择本地图片文件" });

    const fileInput = contentEl.createEl("input", {
      type: "file",
      accept: "image/*",
    });
    fileInput.style.display = "none";

    const dropZone = fileSection.createDiv({ cls: "mindos-upload-dropzone mindos-ocr-dropzone" });
    const iconWrap = dropZone.createDiv({ cls: "mindos-upload-icon" });
    setIcon(iconWrap, "image");
    dropZone.createEl("p", { cls: "mindos-upload-text", text: "拖拽图片到这里，或点击选择" });
    dropZone.createEl("p", { cls: "mindos-upload-subtext", text: "支持 PNG / JPG / WEBP / GIF" });

    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.addClass("is-dragging"); };
    dropZone.ondragleave = () => dropZone.removeClass("is-dragging");
    dropZone.ondrop = async (e) => {
      e.preventDefault();
      dropZone.removeClass("is-dragging");
      const file = e.dataTransfer?.files?.[0];
      if (file) { this.close(); await this.onSubmit({ type: "file", file }); }
    };

    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      if (file) { this.close(); await this.onSubmit({ type: "file", file }); }
    };

    const actions = contentEl.createDiv({ cls: "mindos-upload-actions" });
    const cancelBtn = actions.createEl("button", {
      cls: "mindos-btn mindos-btn-ghost",
      text: "取消",
    });
    cancelBtn.onclick = () => this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════════
// Modal：信息展示（网页剪藏说明等）
// ════════════════════════════════════════════════════════════════

class InfoModal extends Modal {
  constructor(
    app: App,
    private options: { title: string; content: string },
  ) {
    super(app);
    this.titleEl.setText(options.title);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mindos-info-modal");
    contentEl.innerHTML = this.options.content;
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(String(e.target!.result));
    reader.onerror = () => reject(new Error("Blob 读取失败"));
    reader.readAsDataURL(blob);
  });
}
