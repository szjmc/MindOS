import { App, Modal, Notice, setIcon } from "obsidian";
import {
  SupportedLanguage,
  PhraseEntry,
} from "../../core/types";
import {
  SUPPORTED_LANGUAGES,
  PHRASE_DEFAULT_CATEGORIES,
} from "../../core/constants";
import { RecallConceptGenerator } from "./recall-concept-generator";
import { RecallPhraseGenerator } from "./recall-phrase-generator";

// ════════════════════════════════════════════════════════════
// 概念生成弹窗
// ════════════════════════════════════════════════════════════

export class ConceptGenerateModal extends Modal {
  constructor(
    app: App,
    private generator: RecallConceptGenerator,
    private onDone: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-concept-gen-modal");

    contentEl.createEl("h2", { text: "💡 生成概念定义卡片" });

    // 模式选择
    const modeWrap = contentEl.createDiv({ cls: "mindos-cp-mode-tabs" });
    let activeMode: "wiki" | "manual" = "wiki";

    const wikiTab = modeWrap.createDiv({ cls: "mindos-cp-mode-tab is-active" });
    setIcon(wikiTab.createSpan(), "book-open");
    wikiTab.createSpan({ text: " 从 Wiki 概念页生成" });

    const manualTab = modeWrap.createDiv({ cls: "mindos-cp-mode-tab" });
    setIcon(manualTab.createSpan(), "plus-circle");
    manualTab.createSpan({ text: " 手动指定概念" });

    const wikiPane = contentEl.createDiv({ cls: "mindos-cp-pane" });
    const manualPane = contentEl.createDiv({ cls: "mindos-cp-pane" });
    manualPane.style.display = "none";

    const switchTo = (mode: "wiki" | "manual") => {
      activeMode = mode;
      wikiTab.toggleClass("is-active", mode === "wiki");
      manualTab.toggleClass("is-active", mode === "manual");
      wikiPane.style.display = mode === "wiki" ? "" : "none";
      manualPane.style.display = mode === "manual" ? "" : "none";
    };
    wikiTab.onclick = () => switchTo("wiki");
    manualTab.onclick = () => switchTo("manual");

    // ── Wiki 模式 ──
    this.renderWikiPane(wikiPane);

    // ── Manual 模式 ──
    this.renderManualPane(manualPane);
  }

  private renderWikiPane(parent: HTMLElement) {
    parent.createDiv({
      cls: "mindos-cp-tip",
      text: "💡 自动扫描 Wiki 中所有 concept 类型的页面，提取核心概念生成定义卡片",
    });

    // 选项
    const opts = parent.createDiv({ cls: "mindos-cp-opts" });

    const maxRow = opts.createDiv({ cls: "mindos-cp-opt-row" });
    maxRow.createSpan({ text: "每页最多生成：" });
    const maxSelect = maxRow.createEl("select", { cls: "mindos-cp-select" });
    [1, 2, 3, 5].forEach((n) => {
      const opt = maxSelect.createEl("option", { value: String(n), text: `${n} 张` });
      if (n === 2) opt.selected = true;
    });

    const onlyNewRow = opts.createDiv({ cls: "mindos-cp-opt-row" });
    onlyNewRow.createSpan({ text: "跳过已生成的页面：" });
    const onlyNewCheck = onlyNewRow.createEl("input");
    onlyNewCheck.type = "checkbox";
    onlyNewCheck.checked = true;

    // 进度
    const progressWrap = parent.createDiv({ cls: "mindos-cp-progress" });
    progressWrap.style.display = "none";
    const progressBar = progressWrap.createDiv({ cls: "mindos-vp-bar" });
    const progressFill = progressBar.createDiv({ cls: "mindos-vp-bar-fill" });
    const progressText = progressWrap.createDiv({ cls: "mindos-vp-text" });

    // 按钮
    const btnRow = parent.createDiv({ cls: "mindos-cp-btn-row" });
    const genBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: " 开始生成" });
    genBtn.onclick = async () => {
      genBtn.disabled = true;
      progressWrap.style.display = "block";

      try {
        const result = await this.generator.generate(
          {
            source: "wiki",
            maxCardsPerPage: parseInt(maxSelect.value),
            onlyNewPages: onlyNewCheck.checked,
          },
          (p) => {
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            progressFill.style.width = `${pct}%`;
            progressText.setText(`${p.done}/${p.total} 页面 · 已生成 ${p.newCards} 张`);
          },
        );

        new Notice(`✅ 生成完成：${result.newCards} 张概念卡片`);
        this.onDone();
        this.close();
      } catch (e) {
        new Notice(`❌ 失败：${e instanceof Error ? e.message : String(e)}`);
        genBtn.disabled = false;
      }
    };
  }

  private renderManualPane(parent: HTMLElement) {
    parent.createDiv({
      cls: "mindos-cp-tip",
      text: "💡 输入概念名，AI 自动生成完整的定义卡片",
    });

    const opts = parent.createDiv({ cls: "mindos-cp-opts" });

    // 概念名
    const nameRow = opts.createDiv({ cls: "mindos-cp-field" });
    nameRow.createDiv({ cls: "mindos-cp-label", text: "概念名 *" });
    const nameInput = nameRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    nameInput.placeholder = "例如：递归、SOLID 原则、依赖注入";

    // 领域
    const domainRow = opts.createDiv({ cls: "mindos-cp-field" });
    domainRow.createDiv({ cls: "mindos-cp-label", text: "所属领域（可选）" });
    const domainInput = domainRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    domainInput.placeholder = "例如：算法、设计模式、数据库";

    // 按钮
    const btnRow = parent.createDiv({ cls: "mindos-cp-btn-row" });
    const genBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: " AI 生成" });
    genBtn.onclick = async () => {
      const name = nameInput.value.trim();
      if (!name) { new Notice("⚠️ 请输入概念名"); return; }

      genBtn.disabled = true;
      const notice = new Notice(`AI 生成中：${name}...`, 0);

      try {
        const result = await this.generator.generate({
          source: "manual",
          conceptName: name,
          domain: domainInput.value.trim() || undefined,
        });

        notice.hide();
        if (result.newCards > 0) {
          new Notice(`✅ 已创建概念卡片：${name}`);
          this.onDone();
          // 不关闭，方便连续添加
          nameInput.value = "";
          nameInput.focus();
        } else {
          new Notice(`❌ 生成失败：${result.errors.join("; ")}`);
        }
        genBtn.disabled = false;
      } catch (e) {
        notice.hide();
        new Notice(`❌ ${e instanceof Error ? e.message : String(e)}`);
        genBtn.disabled = false;
      }
    };

    setTimeout(() => nameInput.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════
// 多语言短语生成弹窗
// ════════════════════════════════════════════════════════════

export class PhraseGenerateModal extends Modal {
  constructor(
    app: App,
    private generator: RecallPhraseGenerator,
    private onDone: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-phrase-gen-modal");

    contentEl.createEl("h2", { text: "🌐 生成多语言短语卡片" });

    // 通用：语言选择
    const langWrap = contentEl.createDiv({ cls: "mindos-cp-field" });
    langWrap.createDiv({ cls: "mindos-cp-label", text: "选择语言" });
    const langSelect = langWrap.createEl("select", { cls: "mindos-cp-select" });
    for (const l of SUPPORTED_LANGUAGES) {
      const opt = langSelect.createEl("option", {
        value: l.code,
        text: `${l.flag} ${l.name}`,
      });
      if (l.code === "ja") opt.selected = true;  // 默认日语
    }

    // 自定义语言名输入框（仅 custom 时显示）
    const customLangWrap = contentEl.createDiv({ cls: "mindos-cp-field" });
    customLangWrap.style.display = "none";
    customLangWrap.createDiv({ cls: "mindos-cp-label", text: "自定义语言名" });
    const customLangInput = customLangWrap.createEl("input", { type: "text", cls: "mindos-cp-input" });
    customLangInput.placeholder = "例如：荷兰语";

    langSelect.onchange = () => {
      customLangWrap.style.display = langSelect.value === "custom" ? "" : "none";
    };

    // 模式 Tab
    const modeWrap = contentEl.createDiv({ cls: "mindos-cp-mode-tabs" });

    const aiTab = modeWrap.createDiv({ cls: "mindos-cp-mode-tab is-active" });
    setIcon(aiTab.createSpan(), "sparkles");
    aiTab.createSpan({ text: " AI 按主题生成" });

    const manualTab = modeWrap.createDiv({ cls: "mindos-cp-mode-tab" });
    setIcon(manualTab.createSpan(), "edit-3");
    manualTab.createSpan({ text: " 手动添加单条" });

    const aiPane = contentEl.createDiv({ cls: "mindos-cp-pane" });
    const manualPane = contentEl.createDiv({ cls: "mindos-cp-pane" });
    manualPane.style.display = "none";

    const switchTo = (mode: "ai" | "manual") => {
      aiTab.toggleClass("is-active", mode === "ai");
      manualTab.toggleClass("is-active", mode === "manual");
      aiPane.style.display = mode === "ai" ? "" : "none";
      manualPane.style.display = mode === "manual" ? "" : "none";
    };
    aiTab.onclick = () => switchTo("ai");
    manualTab.onclick = () => switchTo("manual");

    // ── AI 模式 ──
    this.renderAIPane(aiPane, langSelect, customLangInput);

    // ── Manual 模式 ──
    this.renderManualPane(manualPane, langSelect, customLangInput);
  }

  private renderAIPane(
    parent: HTMLElement,
    langSelect: HTMLSelectElement,
    customLangInput: HTMLInputElement,
  ) {
    // 主题
    const topicRow = parent.createDiv({ cls: "mindos-cp-field" });
    topicRow.createDiv({ cls: "mindos-cp-label", text: "主题 *" });
    const topicSelect = topicRow.createEl("select", { cls: "mindos-cp-select" });
    for (const cat of PHRASE_DEFAULT_CATEGORIES) {
      topicSelect.createEl("option", { value: cat, text: cat });
    }
    topicSelect.createEl("option", { value: "__custom__", text: "✏️ 自定义主题..." });

    const customTopicInput = topicRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    customTopicInput.style.display = "none";
    customTopicInput.style.marginTop = "6px";
    customTopicInput.placeholder = "例如：火车站对话、点餐用语";
    topicSelect.onchange = () => {
      customTopicInput.style.display = topicSelect.value === "__custom__" ? "" : "none";
    };

    // 数量
    const countRow = parent.createDiv({ cls: "mindos-cp-field" });
    countRow.createDiv({ cls: "mindos-cp-label", text: "生成数量" });
    const countInput = countRow.createEl("input", { type: "number", cls: "mindos-cp-input" });
    countInput.value = "10";
    countInput.min = "1";
    countInput.max = "30";

    // 难度
    const levelRow = parent.createDiv({ cls: "mindos-cp-field" });
    levelRow.createDiv({ cls: "mindos-cp-label", text: "难度（可选）" });
    const levelInput = levelRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    levelInput.placeholder = "例如：N5（日语）/ A1（西法等）";

    // 进度
    const progressWrap = parent.createDiv({ cls: "mindos-cp-progress" });
    progressWrap.style.display = "none";
    const progressBar = progressWrap.createDiv({ cls: "mindos-vp-bar" });
    const progressFill = progressBar.createDiv({ cls: "mindos-vp-bar-fill" });
    const progressText = progressWrap.createDiv({ cls: "mindos-vp-text" });

    // 按钮
    const btnRow = parent.createDiv({ cls: "mindos-cp-btn-row" });
    const genBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: " 生成" });
    genBtn.onclick = async () => {
      const lang = langSelect.value as SupportedLanguage;
      const customLang = customLangInput.value.trim();
      if (lang === "custom" && !customLang) {
        new Notice("⚠️ 请输入自定义语言名"); return;
      }

      const topic = topicSelect.value === "__custom__"
        ? customTopicInput.value.trim()
        : topicSelect.value;
      if (!topic) { new Notice("⚠️ 请选择或输入主题"); return; }

      const count = parseInt(countInput.value);
      if (!Number.isFinite(count) || count <= 0) {
        new Notice("⚠️ 生成数量无效"); return;
      }

      genBtn.disabled = true;
      progressWrap.style.display = "block";

      try {
        const result = await this.generator.generate(
          {
            source: "ai_topic",
            language: lang,
            customLanguage: customLang || undefined,
            topic,
            count,
            level: levelInput.value.trim() || undefined,
          },
          (p) => {
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            progressFill.style.width = `${pct}%`;
            progressText.setText(`${p.done}/${p.total} · ${p.currentPhrase}`);
          },
        );

        new Notice(`✅ 生成 ${result.newCards} 张短语卡片`);
        this.onDone();
        this.close();
      } catch (e) {
        new Notice(`❌ ${e instanceof Error ? e.message : String(e)}`);
        genBtn.disabled = false;
      }
    };
  }

  private renderManualPane(
    parent: HTMLElement,
    langSelect: HTMLSelectElement,
    customLangInput: HTMLInputElement,
  ) {
    // 短语
    const phraseRow = parent.createDiv({ cls: "mindos-cp-field" });
    phraseRow.createDiv({ cls: "mindos-cp-label", text: "短语 *" });
    const phraseInput = phraseRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    phraseInput.placeholder = "例如：おはようございます";

    // 翻译
    const transRow = parent.createDiv({ cls: "mindos-cp-field" });
    transRow.createDiv({ cls: "mindos-cp-label", text: "中文翻译 *" });
    const transInput = transRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    transInput.placeholder = "例如：早上好（敬语）";

    // 罗马音
    const romaRow = parent.createDiv({ cls: "mindos-cp-field" });
    romaRow.createDiv({ cls: "mindos-cp-label", text: "发音/罗马音（可选）" });
    const romaInput = romaRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    romaInput.placeholder = "例如：ohayou gozaimasu";

    // 类别
    const catRow = parent.createDiv({ cls: "mindos-cp-field" });
    catRow.createDiv({ cls: "mindos-cp-label", text: "类别（可选）" });
    const catSelect = catRow.createEl("select", { cls: "mindos-cp-select" });
    catSelect.createEl("option", { value: "", text: "（无类别）" });
    for (const c of PHRASE_DEFAULT_CATEGORIES) {
      catSelect.createEl("option", { value: c, text: c });
    }

    // 难度
    const levelRow = parent.createDiv({ cls: "mindos-cp-field" });
    levelRow.createDiv({ cls: "mindos-cp-label", text: "难度（可选）" });
    const levelInput = levelRow.createEl("input", { type: "text", cls: "mindos-cp-input" });
    levelInput.placeholder = "例如：N5";

    // 备注
    const notesRow = parent.createDiv({ cls: "mindos-cp-field" });
    notesRow.createDiv({ cls: "mindos-cp-label", text: "用法说明（可选）" });
    const notesInput = notesRow.createEl("textarea", { cls: "mindos-cp-textarea" });
    notesInput.placeholder = "例如：正式场合使用，对长辈/上级";
    notesInput.rows = 2;

    // 例句
    const exRow = parent.createDiv({ cls: "mindos-cp-field" });
    exRow.createDiv({ cls: "mindos-cp-label", text: "例句（每行一条，可选）" });
    const exInput = exRow.createEl("textarea", { cls: "mindos-cp-textarea" });
    exInput.placeholder = "例如：先生、おはようございます。";
    exInput.rows = 2;

    // 按钮
    const btnRow = parent.createDiv({ cls: "mindos-cp-btn-row" });
    const saveBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(saveBtn.createSpan(), "save");
    saveBtn.createSpan({ text: " 保存" });
    saveBtn.onclick = async () => {
      const phrase = phraseInput.value.trim();
      const translation = transInput.value.trim();
      if (!phrase || !translation) {
        new Notice("⚠️ 请填写短语和翻译"); return;
      }

      const lang = langSelect.value as SupportedLanguage;
      const customLang = customLangInput.value.trim();
      if (lang === "custom" && !customLang) {
        new Notice("⚠️ 请输入自定义语言名"); return;
      }

      const entry: PhraseEntry = {
        phrase,
        translation,
        romanization: romaInput.value.trim() || undefined,
        category: catSelect.value || undefined,
        level: levelInput.value.trim() || undefined,
        notes: notesInput.value.trim() || undefined,
        examples: exInput.value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      try {
        await this.generator.generate({
          source: "manual",
          language: lang,
          customLanguage: customLang || undefined,
          manualEntry: entry,
        });

        new Notice("✅ 短语卡片已创建");
        this.onDone();

        // 清空表单，方便连续添加
        phraseInput.value = "";
        transInput.value = "";
        romaInput.value = "";
        notesInput.value = "";
        exInput.value = "";
        phraseInput.focus();
      } catch (e) {
        new Notice(`❌ ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    setTimeout(() => phraseInput.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}