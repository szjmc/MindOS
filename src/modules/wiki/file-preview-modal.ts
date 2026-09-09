import { Modal, Notice, TFile, parseYaml } from "obsidian";
import type MindOSPlugin from "../../../main";
import { PageVersion } from "../../core/types";

export class FilePreviewModal extends Modal {
  private plugin: MindOSPlugin;
  private version: PageVersion;
  private filePath: string;
  private isSidebarCollapsed = false;
  private isCompareMode = false;
  private compareViewMode: "side-by-side" | "inline" = "side-by-side";
  private compareVersion: PageVersion | null = null;
  private zoomLevel = 1;

  constructor(
    plugin: MindOSPlugin,
    version: PageVersion,
    filePath: string,
    compareVersion?: PageVersion
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.version = version;
    this.filePath = filePath;
    this.compareVersion = compareVersion || null;
    this.isCompareMode = !!compareVersion;
    
    this.modalEl.addClass("mindos-file-preview-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    // 整体布局
    const layout = contentEl.createDiv({ cls: "mindos-preview-layout" });
    
    // 顶部标题栏
    this.renderHeader(layout);
    
    // 主体区域
    const body = layout.createDiv({ cls: "mindos-preview-body" });
    
    // 侧边元数据栏
    this.renderSidebar(body);
    
    // 主内容区
    this.renderContent(body);
  }

  private renderHeader(parent: HTMLElement) {
    const header = parent.createDiv({ cls: "mindos-preview-header" });
    
    // 左侧：面包屑路径
    const breadcrumbs = header.createDiv({ cls: "mindos-preview-breadcrumbs" });
    const pathParts = this.filePath.split("/");
    pathParts.forEach((part, index) => {
      const isLast = index === pathParts.length - 1;
      const crumb = breadcrumbs.createEl("span", { 
        cls: `mindos-breadcrumb-item ${isLast ? "is-active" : ""}`,
        text: part.replace(".md", "")
      });
      crumb.style.cursor = isLast ? "default" : "pointer";
      if (!isLast) {
        breadcrumbs.createEl("span", { cls: "mindos-breadcrumb-separator", text: " / " });
      }
    });
    
    // 中间：模块标题
    const title = header.createDiv({ cls: "mindos-preview-title" });
    title.createSpan({ cls: "mindos-preview-icon", text: "📄" });
    title.createSpan({ cls: "mindos-preview-label", text: this.isCompareMode ? "版本对比" : "文件预览" });
    
    // 右侧：操作按钮
    const actions = header.createDiv({ cls: "mindos-preview-actions" });
    
    if (!this.isCompareMode) {
      // 缩放
      const zoomOutBtn = actions.createEl("button", { cls: "mindos-preview-btn mindos-preview-btn-zoom", text: "−" });
      zoomOutBtn.onclick = () => this.adjustZoom(-0.1);
      
      const zoomInBtn = actions.createEl("button", { cls: "mindos-preview-btn mindos-preview-btn-zoom", text: "+" });
      zoomInBtn.onclick = () => this.adjustZoom(0.1);
      
      // 复制
      const copyBtn = actions.createEl("button", { cls: "mindos-preview-btn mindos-preview-btn-copy", text: "📋 复制" });
      copyBtn.onclick = () => this.copyContent();
      
      // 导出
      const exportBtn = actions.createEl("button", { cls: "mindos-preview-btn mindos-preview-btn-export", text: "📤 导出" });
      exportBtn.onclick = () => this.exportContent();
    } else {
      // 对比视图切换
      const viewModeBtn = actions.createEl("button", { 
        cls: "mindos-preview-btn mindos-preview-btn-view-mode", 
        text: this.compareViewMode === "side-by-side" ? "📑 并排" : "📜 行内" 
      });
      viewModeBtn.onclick = () => this.toggleViewMode();
    }
    
    // 对比按钮
    const compareBtn = actions.createEl("button", { 
      cls: `mindos-preview-btn mindos-preview-btn-compare ${this.isCompareMode ? "is-active" : ""}`, 
      text: "🔄 对比" 
    });
    compareBtn.onclick = () => this.toggleCompareMode();
    
    // 关闭按钮
    const closeBtn = actions.createEl("button", { cls: "mindos-preview-btn mindos-preview-btn-close", text: "✕" });
    closeBtn.onclick = () => this.close();
  }

  private renderSidebar(parent: HTMLElement) {
    const sidebar = parent.createDiv({ cls: `mindos-preview-sidebar ${this.isSidebarCollapsed ? "is-collapsed" : ""}` });
    
    const toggleBtn = sidebar.createEl("button", { cls: "mindos-sidebar-toggle", text: this.isSidebarCollapsed ? "▶" : "◀" });
    toggleBtn.onclick = () => this.toggleSidebar();
    
    if (!this.isSidebarCollapsed) {
      const sidebarContent = sidebar.createDiv({ cls: "mindos-sidebar-content" });
      
      // 来源信息卡片
      const sourceCard = sidebarContent.createDiv({ cls: "mindos-meta-card" });
      const sourceTitle = sourceCard.createDiv({ cls: "mindos-meta-card-title" });
      sourceTitle.createSpan({ cls: "mindos-meta-icon", text: "🔗" });
      sourceTitle.createSpan({ text: "来源信息" });
      
      const sourceUrl = this.extractUrl(this.version.content);
      this.renderMetaItem(sourceCard, "平台", this.extractSource(this.version.content) || "未知");
      this.renderMetaItem(sourceCard, "链接", sourceUrl || "-", true, sourceUrl);
      this.renderMetaItem(sourceCard, "采集时间", this.extractTime(this.version.content) || "-");
      
      // 基础信息卡片
      const infoCard = sidebarContent.createDiv({ cls: "mindos-meta-card" });
      const infoTitle = infoCard.createDiv({ cls: "mindos-meta-card-title" });
      infoTitle.createSpan({ cls: "mindos-meta-icon", text: "📋" });
      infoTitle.createSpan({ text: "基础信息" });
      
      this.renderMetaItem(infoCard, "回合数", this.extractRounds(this.version.content) || "-");
      this.renderMetaItem(infoCard, "标签", this.extractTags(this.version.content) || "-", false, null, true);
      this.renderMetaItem(infoCard, "格式", "Markdown");
      
      // 版本信息卡片
      const versionCard = sidebarContent.createDiv({ cls: "mindos-meta-card" });
      const versionTitle = versionCard.createDiv({ cls: "mindos-meta-card-title" });
      versionTitle.createSpan({ cls: "mindos-meta-icon", text: "📜" });
      versionTitle.createSpan({ text: "版本信息" });
      
      this.renderMetaItem(versionCard, "版本号", this.version.id || "current");
      this.renderMetaItem(versionCard, "修改时间", this.formatTime(this.version.timestamp));
      this.renderMetaItem(versionCard, "字数", `${this.version.wordCount || this.version.content.length} 字`);
    }
  }

  private renderMetaItem(parent: HTMLElement, label: string, value: string, isLink = false, linkUrl: string | null = null, isEditable = false) {
    const item = parent.createDiv({ cls: "mindos-meta-item" });
    item.createSpan({ cls: "mindos-meta-label", text: label });
    
    const valueSpan = item.createSpan({ cls: "mindos-meta-value" });
    
    if (isLink && linkUrl) {
      const link = valueSpan.createEl("a", { cls: "mindos-meta-link", text: value.length > 40 ? value.substring(0, 40) + "..." : value, attr: { href: linkUrl, target: "_blank" } });
      const copyIcon = valueSpan.createSpan({ cls: "mindos-meta-action-icon", text: "📋", title: "复制链接" });
      copyIcon.style.cursor = "pointer";
      copyIcon.onclick = () => {
        navigator.clipboard.writeText(linkUrl);
        new Notice("链接已复制");
      };
    } else if (isEditable) {
      valueSpan.setText(value);
      const editIcon = valueSpan.createSpan({ cls: "mindos-meta-action-icon", text: "✏️", title: "编辑标签" });
      editIcon.style.cursor = "pointer";
    } else {
      valueSpan.setText(value.length > 40 ? value.substring(0, 40) + "..." : value);
    }
  }

  private renderContent(parent: HTMLElement) {
    const contentArea = parent.createDiv({ cls: "mindos-preview-content" });
    contentArea.style.zoom = `${this.zoomLevel}`;
    
    if (this.isCompareMode && this.compareVersion) {
      this.renderCompareMode(contentArea);
    } else {
      this.renderPreviewMode(contentArea);
    }
  }

  private renderPreviewMode(parent: HTMLElement) {
    const content = this.version.content;
    
    // 解析YAML frontmatter
    let bodyContent = content;
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (yamlMatch) {
      bodyContent = content.substring(yamlMatch[0].length);
    }
    
    const preview = parent.createDiv({ cls: "mindos-markdown-preview" });
    preview.innerHTML = this.markdownToHtml(bodyContent);
    
    // 添加代码块复制按钮
    this.addCopyButtons(preview);
  }

  private renderCompareMode(parent: HTMLElement) {
    if (!this.compareVersion) return;
    
    const compareArea = parent.createDiv({ cls: "mindos-compare-area" });
    
    if (this.compareViewMode === "side-by-side") {
      // 并排对比
      const oldVersion = this.compareVersion;
      const newVersion = this.version;
      
      const oldPanel = compareArea.createDiv({ cls: "mindos-compare-panel mindos-compare-old" });
      const oldHeader = oldPanel.createDiv({ cls: "mindos-compare-header" });
      oldHeader.createSpan({ cls: "mindos-compare-icon", text: "📜" });
      oldHeader.createSpan({ cls: "mindos-compare-title", text: "旧版本" });
      oldHeader.createSpan({ cls: "mindos-compare-time", text: this.formatTime(oldVersion.timestamp) });
      
      const oldContent = oldPanel.createDiv({ cls: "mindos-compare-content mindos-markdown-preview" });
      oldContent.innerHTML = this.markdownToHtml(oldVersion.content);
      
      const newPanel = compareArea.createDiv({ cls: "mindos-compare-panel mindos-compare-new" });
      const newHeader = newPanel.createDiv({ cls: "mindos-compare-header" });
      newHeader.createSpan({ cls: "mindos-compare-icon", text: "📄" });
      newHeader.createSpan({ cls: "mindos-compare-title", text: "新版本" });
      newHeader.createSpan({ cls: "mindos-compare-time", text: this.formatTime(newVersion.timestamp) });
      
      const newContent = newPanel.createDiv({ cls: "mindos-compare-content mindos-markdown-preview" });
      newContent.innerHTML = this.markdownToHtml(newVersion.content);
      
      this.addCopyButtons(oldContent);
      this.addCopyButtons(newContent);
    } else {
      // 行内对比 - 简化实现
      const unifiedArea = compareArea.createDiv({ cls: "mindos-unified-area" });
      
      // 差异统计
      const diffStats = unifiedArea.createDiv({ cls: "mindos-diff-stats" });
      diffStats.createSpan({ cls: "mindos-diff-add", text: "新增 0 行" });
      diffStats.createSpan({ cls: "mindos-diff-del", text: "删除 0 行" });
      
      // 内容区
      const unifiedContent = unifiedArea.createDiv({ cls: "mindos-unified-content mindos-markdown-preview" });
      unifiedContent.innerHTML = this.markdownToHtml(this.version.content);
      this.addCopyButtons(unifiedContent);
    }
  }

  private markdownToHtml(markdown: string): string {
    let text = markdown;

    // 1. 去掉 YAML frontmatter
    text = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

    // 2. 提取代码块，用占位符替换，避免后续规则污染代码内容
    const codeBlocks: string[] = [];
    text = text.replace(/^```([\w-]*)\r?\n([\s\S]*?)^```[ \t]*$/gm, (_, lang, code) => {
      const language = lang.trim() || 'text';
      const placeholder = `\x00CODE${codeBlocks.length}\x00`;
      codeBlocks.push(
        `<div class="mindos-markdown-code-block">` +
          `<div class="mindos-markdown-code-header">` +
            `<span class="mindos-markdown-code-lang">${language}</span>` +
            `<button class="mindos-copy-btn">📋</button>` +
          `</div>` +
          `<pre class="mindos-markdown-pre"><code class="mindos-markdown-codeblock language-${language}">${this.escapeHtml(code.replace(/\r?\n$/, ''))}</code></pre>` +
        `</div>`
      );
      return placeholder;
    });

    // 3. 逐行处理（标题、列表、引用、段落）
    const lines = text.split('\n');
    const output: string[] = [];
    let listBuffer: string[] = [];

    const flushList = () => {
      if (listBuffer.length > 0) {
        output.push(`<ul class="mindos-markdown-list">${listBuffer.join('')}</ul>`);
        listBuffer = [];
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, '');

      // 代码块占位符直接输出
      if (/^\x00CODE\d+\x00$/.test(line.trim())) {
        flushList();
        output.push(line.trim());
        continue;
      }

      // 标题
      const h3 = line.match(/^### (.+)/);
      const h2 = line.match(/^## (.+)/);
      const h1 = line.match(/^# (.+)/);
      if (h3) { flushList(); output.push(`<h3 class="mindos-markdown-h3">${this.inlineFormat(h3[1])}</h3>`); continue; }
      if (h2) { flushList(); output.push(`<h2 class="mindos-markdown-h2">${this.inlineFormat(h2[1])}</h2>`); continue; }
      if (h1) { flushList(); output.push(`<h1 class="mindos-markdown-h1">${this.inlineFormat(h1[1])}</h1>`); continue; }

      // 水平线
      if (/^---+$/.test(line.trim())) {
        flushList();
        output.push('<hr class="mindos-markdown-hr"/>');
        continue;
      }

      // 引用
      const quote = line.match(/^> (.+)/);
      if (quote) {
        flushList();
        output.push(`<blockquote class="mindos-markdown-quote"><span class="mindos-markdown-quote-bar"></span><span class="mindos-markdown-quote-content">${this.inlineFormat(quote[1])}</span></blockquote>`);
        continue;
      }

      // 无序列表
      const li = line.match(/^[-*] (.+)/);
      if (li) {
        listBuffer.push(`<li class="mindos-markdown-list-item">${this.inlineFormat(li[1])}</li>`);
        continue;
      }

      // 有序列表
      const oli = line.match(/^\d+\. (.+)/);
      if (oli) {
        listBuffer.push(`<li class="mindos-markdown-list-item">${this.inlineFormat(oli[1])}</li>`);
        continue;
      }

      // 空行：flush 列表，输出空行占位
      if (!line.trim()) {
        flushList();
        output.push('');
        continue;
      }

      // 普通段落
      flushList();
      output.push(`<p class="mindos-markdown-p">${this.inlineFormat(line)}</p>`);
    }
    flushList();

    // 4. 还原代码块占位符
    let html = output.join('\n');
    codeBlocks.forEach((block, i) => {
      html = html.replace(`\x00CODE${i}\x00`, block);
    });

    return html;
  }

  /** 处理行内格式：粗体、斜体、行内代码、链接 */
  private inlineFormat(text: string): string {
    // 行内代码（最先处理，避免被粗/斜体正则干扰）
    text = text.replace(/`([^`]+)`/g, '<code class="mindos-markdown-code">$1</code>');
    // 粗体
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong class="mindos-markdown-bold">$1</strong>');
    text = text.replace(/__(.+?)__/g, '<strong class="mindos-markdown-bold">$1</strong>');
    // 斜体
    text = text.replace(/\*(.+?)\*/g, '<em class="mindos-markdown-italic">$1</em>');
    text = text.replace(/_(.+?)_/g, '<em class="mindos-markdown-italic">$1</em>');
    // 链接
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="mindos-markdown-link" target="_blank" rel="noopener">$1</a>');
    return text;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private addCopyButtons(container: HTMLElement) {
    const codeBlocks = container.querySelectorAll(".mindos-markdown-code-block");
    codeBlocks.forEach((block) => {
      const copyBtn = block.querySelector(".mindos-copy-btn") as HTMLButtonElement;
      if (copyBtn) {
        copyBtn.onclick = () => {
          const code = block.querySelector(".mindos-markdown-codeblock")?.textContent || "";
          navigator.clipboard.writeText(code);
          copyBtn.textContent = "✅";
          setTimeout(() => copyBtn.textContent = "📋", 1500);
        };
      }
    });
  }

  private copyContent() {
    navigator.clipboard.writeText(this.version.content);
    new Notice("已复制到剪贴板");
  }

  private exportContent() {
    const blob = new Blob([this.version.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this.filePath.split("/").pop() || "export.md";
    a.click();
    URL.revokeObjectURL(url);
    new Notice("导出成功");
  }

  private toggleCompareMode() {
    this.close();
    new Notice("对比模式开发中...");
  }

  private toggleViewMode() {
    this.compareViewMode = this.compareViewMode === "side-by-side" ? "inline" : "side-by-side";
    this.onOpen();
  }

  private toggleSidebar() {
    this.isSidebarCollapsed = !this.isSidebarCollapsed;
    this.onOpen();
  }

  private adjustZoom(delta: number) {
    const newZoom = Math.max(0.5, Math.min(2, this.zoomLevel + delta));
    if (newZoom !== this.zoomLevel) {
      this.zoomLevel = newZoom;
      const contentArea = document.querySelector<HTMLElement>(".mindos-preview-content");
      if (contentArea) {
        contentArea.style.zoom = `${this.zoomLevel}`;
      }
    }
  }

  private extractSource(content: string): string | null {
    try {
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (yamlMatch) {
        const yaml = parseYaml(yamlMatch[1]);
        return yaml.source || yaml.provider || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private extractUrl(content: string): string | null {
    try {
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (yamlMatch) {
        const yaml = parseYaml(yamlMatch[1]);
        return yaml.url || yaml.source_url || yaml.url1 || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private extractTime(content: string): string | null {
    try {
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (yamlMatch) {
        const yaml = parseYaml(yamlMatch[1]);
        return yaml.collected_at || yaml.created_at || yaml.updated_at || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private extractRounds(content: string): string | null {
    try {
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (yamlMatch) {
        const yaml = parseYaml(yamlMatch[1]);
        return yaml.total_rounds || yaml.rounds || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private extractTags(content: string): string | null {
    try {
      const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (yamlMatch) {
        const yaml = parseYaml(yamlMatch[1]);
        if (Array.isArray(yaml.tags)) {
          return yaml.tags.join(", ");
        }
        return yaml.tags || null;
      }
    } catch {
      return null;
    }
    return null;
  }

  private formatTime(iso: string): string {
    const d = new Date(iso.replace(" ", "T"));
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
