import { App, Modal, Notice, setIcon } from "obsidian";
import {
  CustomScenario,
  CustomFieldDef,
  CustomFieldType,
} from "../../core/types";
import {
  CUSTOM_FIELD_TYPE_LABELS,
  CUSTOM_SCENARIO_TEMPLATES,
} from "../../core/constants";
import { CustomScenarioStore } from "./custom-scenario-store";
import { RecallCardStore } from "./recall-card-store";
import { AICardGenerator } from "./ai-card-generator";

// ════════════════════════════════════════════════════════════
// 场景管理弹窗（列表 + 新建/编辑入口）
// ════════════════════════════════════════════════════════════

export class CustomScenarioListModal extends Modal {
  constructor(
    app: App,
    private store: CustomScenarioStore,
    private cardStore: RecallCardStore,
    private aiGenerator: AICardGenerator,
    private onChange: () => void,
  ) {
    super(app);
  }

  async onOpen() {
    await this.refresh();
  }

  private async refresh() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-custom-list-modal");

    contentEl.createEl("h2", { text: "🎲 自定义场景管理" });

    // 工具栏
    const toolbar = contentEl.createDiv({ cls: "mindos-custom-toolbar" });

    const newBtn = toolbar.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(newBtn.createSpan(), "plus");
    newBtn.createSpan({ text: " 从零创建" });
    newBtn.onclick = () => {
      this.openEditor(null, () => this.refresh());
    };

    const tplBtn = toolbar.createEl("button", { cls: "mindos-btn" });
    setIcon(tplBtn.createSpan(), "layers");
    tplBtn.createSpan({ text: " 使用模板创建" });
    tplBtn.onclick = () => this.showTemplatePicker();

    // 已有场景列表
    const scenarios = await this.store.getAll();

    if (scenarios.length === 0) {
      const empty = contentEl.createDiv({ cls: "mindos-custom-empty" });
      empty.createDiv({
        cls: "mindos-custom-empty-icon",
        text: "🎲",
      });
      empty.createDiv({
        cls: "mindos-custom-empty-title",
        text: "暂无自定义场景",
      });
      empty.createDiv({
        cls: "mindos-custom-empty-desc",
        text: "点击「使用模板创建」快速创建一个，或「从零创建」自定义",
      });
      return;
    }

    const list = contentEl.createDiv({ cls: "mindos-custom-list" });
    for (const sc of scenarios) {
      await this.renderScenarioItem(list, sc);
    }
  }

  private async renderScenarioItem(parent: HTMLElement, sc: CustomScenario) {
    const item = parent.createDiv({ cls: "mindos-custom-item" });

    // 头部
    const head = item.createDiv({ cls: "mindos-custom-item-head" });

    const cover = head.createDiv({ cls: "mindos-custom-item-cover" });
    cover.setText(sc.cover ?? "🎲");

    const titleWrap = head.createDiv({ cls: "mindos-custom-item-title-wrap" });
    titleWrap.createDiv({ cls: "mindos-custom-item-name", text: sc.name });
    if (sc.description) {
      titleWrap.createDiv({ cls: "mindos-custom-item-desc", text: sc.description });
    }

    // 卡片数量
    const allCards = await this.cardStore.getAllCards("custom" as any);
    const cardsForThis = allCards.filter((c: any) => c.metadata?.scenarioId === sc.id);
    const countEl = head.createDiv({ cls: "mindos-custom-item-count" });
    countEl.createSpan({ text: `${cardsForThis.length}` });
    countEl.createSpan({ cls: "mindos-custom-item-count-label", text: "张卡片" });

    // 字段预览
    if (sc.fields.length > 0) {
      const fieldsEl = item.createDiv({ cls: "mindos-custom-item-fields" });
      for (const f of sc.fields.slice(0, 5)) {
        fieldsEl.createSpan({
          cls: "mindos-custom-item-field-tag",
          text: f.label,
        });
      }
      if (sc.fields.length > 5) {
        fieldsEl.createSpan({
          cls: "mindos-custom-item-field-more",
          text: `+${sc.fields.length - 5}`,
        });
      }
    }

    // 操作按钮
    const ops = item.createDiv({ cls: "mindos-custom-item-ops" });

    const addCardBtn = ops.createEl("button", { cls: "mindos-btn is-primary" });
    setIcon(addCardBtn.createSpan(), "plus-circle");
    addCardBtn.createSpan({ text: " 添加卡片" });
    addCardBtn.onclick = () => {
      this.openCardCreator(sc, () => this.refresh());
    };

    if (sc.aiEnabled) {
      const aiBtn = ops.createEl("button", { cls: "mindos-btn" });
      setIcon(aiBtn.createSpan(), "sparkles");
      aiBtn.createSpan({ text: " AI 批量生成" });
      aiBtn.onclick = () => {
        this.openAIGenerator(sc, () => this.refresh());
      };
    }

    const editBtn = ops.createEl("button", { cls: "mindos-btn" });
    setIcon(editBtn.createSpan(), "pencil");
    editBtn.createSpan({ text: " 编辑场景" });
    editBtn.onclick = () => {
      this.openEditor(sc, () => this.refresh());
    };

    const delBtn = ops.createEl("button", { cls: "mindos-btn is-danger-text" });
    setIcon(delBtn.createSpan(), "trash-2");
    delBtn.createSpan({ text: " 删除" });
    delBtn.onclick = async () => {
      if (!confirm(`确定删除场景「${sc.name}」？现有卡片不会删除。`)) return;
      await this.store.delete(sc.id);
      this.onChange();
      await this.refresh();
    };
  }

  private showTemplatePicker() {
    const modal = new TemplatePickerModal(this.app, async (presetKey) => {
      try {
        const sc = await this.store.createFromTemplate(presetKey);
        new Notice(`✅ 已创建场景：${sc.name}`);
        this.onChange();
        await this.refresh();
      } catch (e) {
        new Notice(`❌ 创建失败：${e instanceof Error ? e.message : String(e)}`);
      }
    });
    modal.open();
  }

  private openEditor(scenario: CustomScenario | null, onSaved: () => void) {
    const modal = new CustomScenarioEditorModal(
      this.app,
      this.store,
      scenario,
      () => {
        this.onChange();
        onSaved();
      },
    );
    modal.open();
  }

  private openCardCreator(scenario: CustomScenario, onSaved: () => void) {
    const modal = new CustomCardCreatorModal(
      this.app,
      scenario,
      this.store,
      this.cardStore,
      () => {
        this.onChange();
        onSaved();
      },
    );
    modal.open();
  }

  private openAIGenerator(scenario: CustomScenario, onSaved: () => void) {
    const modal = new CustomAIGeneratorModal(
      this.app,
      scenario,
      this.store,
      this.cardStore,
      this.aiGenerator,
      () => {
        this.onChange();
        onSaved();
      },
    );
    modal.open();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════
// 模板选择弹窗
// ════════════════════════════════════════════════════════════

class TemplatePickerModal extends Modal {
  constructor(app: App, private onPick: (presetKey: string) => void) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-custom-tpl-modal");

    contentEl.createEl("h2", { text: "📋 选择模板" });
    contentEl.createDiv({
      cls: "mindos-cp-tip",
      text: "选择一个预设模板，快速创建场景。所有字段和模板都可以后续编辑。",
    });

    const grid = contentEl.createDiv({ cls: "mindos-custom-tpl-grid" });

    for (const tpl of CUSTOM_SCENARIO_TEMPLATES) {
      const card = grid.createDiv({ cls: "mindos-custom-tpl-card" });
      card.createDiv({ cls: "mindos-custom-tpl-cover", text: tpl.cover ?? "🎲" });
      card.createDiv({ cls: "mindos-custom-tpl-name", text: tpl.name ?? "" });
      card.createDiv({ cls: "mindos-custom-tpl-desc", text: tpl.description ?? "" });

      // 字段预览
      if (tpl.fields && tpl.fields.length > 0) {
        const fieldsEl = card.createDiv({ cls: "mindos-custom-tpl-fields" });
        for (const f of tpl.fields.slice(0, 4)) {
          fieldsEl.createSpan({
            cls: "mindos-custom-tpl-field",
            text: f.label,
          });
        }
        if (tpl.fields.length > 4) {
          fieldsEl.createSpan({
            cls: "mindos-custom-tpl-field-more",
            text: `+${tpl.fields.length - 4}`,
          });
        }
      }

      card.onclick = () => {
        this.onPick(tpl.presetKey);
        this.close();
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════
// 场景编辑器弹窗（新建/编辑场景配置）
// ════════════════════════════════════════════════════════════

class CustomScenarioEditorModal extends Modal {
  private scenario: CustomScenario;
  private isNew: boolean;

  constructor(
    app: App,
    private store: CustomScenarioStore,
    existing: CustomScenario | null,
    private onSaved: () => void,
  ) {
    super(app);
    this.isNew = existing === null;
    if (existing) {
      this.scenario = JSON.parse(JSON.stringify(existing));
    } else {
      this.scenario = {
        id: "",
        name: "",
        description: "",
        cover: "🎲",
        fields: [
          { key: "front", label: "正面", type: "text", required: true },
          { key: "back", label: "背面", type: "textarea", required: true },
        ],
        frontTemplate: "{{front}}",
        backTemplate: "{{back}}",
        aiEnabled: false,
        tags: [],
        createdAt: "",
        updatedAt: "",
      };
    }
  }

  onOpen() {
    this.refresh();
  }

  private refresh() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-custom-editor-modal");

    contentEl.createEl("h2", {
      text: this.isNew ? "✨ 创建自定义场景" : `✏️ 编辑：${this.scenario.name}`,
    });

    // 基本信息区
    const basicGroup = contentEl.createDiv({ cls: "mindos-custom-editor-group" });
    basicGroup.createEl("h3", { text: "📌 基本信息" });

    this.makeFieldInput(basicGroup, "封面 emoji", () => this.scenario.cover ?? "", (v) => this.scenario.cover = v, { width: "60px", placeholder: "🎲" });
    this.makeFieldInput(basicGroup, "场景名 *", () => this.scenario.name, (v) => this.scenario.name = v, { placeholder: "如：古诗词记忆" });
    this.makeFieldInput(basicGroup, "描述", () => this.scenario.description ?? "", (v) => this.scenario.description = v, { placeholder: "可选" });
    this.makeFieldInput(basicGroup, "标签（逗号分隔）", () => this.scenario.tags.join(", "), (v) => this.scenario.tags = v.split(/[,，]/).map((s) => s.trim()).filter(Boolean));

    // 字段定义区
    const fieldsGroup = contentEl.createDiv({ cls: "mindos-custom-editor-group" });
    const fieldsHead = fieldsGroup.createDiv({ cls: "mindos-custom-editor-group-head" });
    fieldsHead.createEl("h3", { text: "📋 字段定义" });
    const addFieldBtn = fieldsHead.createEl("button", { cls: "mindos-btn" });
    setIcon(addFieldBtn.createSpan(), "plus");
    addFieldBtn.createSpan({ text: " 添加字段" });
    addFieldBtn.onclick = () => {
      this.scenario.fields.push({
        key: `field_${this.scenario.fields.length + 1}`,
        label: "新字段",
        type: "text",
      });
      this.refresh();
    };

    fieldsGroup.createDiv({
      cls: "mindos-cp-tip",
      text: "字段是卡片的数据来源，每个字段都可以在卡片模板中通过 {{字段key}} 引用",
    });

    const fieldsList = fieldsGroup.createDiv({ cls: "mindos-custom-fields-list" });
    for (let i = 0; i < this.scenario.fields.length; i++) {
      this.renderFieldEditor(fieldsList, i);
    }

    // 模板区
    const tplGroup = contentEl.createDiv({ cls: "mindos-custom-editor-group" });
    tplGroup.createEl("h3", { text: "🎨 卡片模板" });

    tplGroup.createDiv({
      cls: "mindos-cp-tip",
      text: "用 {{字段key}} 占位符引用字段值。支持 Markdown 语法。",
    });

    this.makeFieldTextarea(
      tplGroup,
      "正面模板 *",
      () => this.scenario.frontTemplate,
      (v) => this.scenario.frontTemplate = v,
      { rows: 3, placeholder: "如：**{{title}}**\n\n{{question}}" },
    );

    this.makeFieldTextarea(
      tplGroup,
      "背面模板 *",
      () => this.scenario.backTemplate,
      (v) => this.scenario.backTemplate = v,
      { rows: 5, placeholder: "如：## {{title}}\n\n{{answer}}\n\n*{{notes}}*" },
    );

    this.makeFieldTextarea(
      tplGroup,
      "提示模板（可选）",
      () => this.scenario.hintsTemplate ?? "",
      (v) => this.scenario.hintsTemplate = v || undefined,
      { rows: 1, placeholder: "如：首字母：{{answer.slice(0,1)}}" },
    );

    // AI 配置区（折叠）
    const aiGroup = contentEl.createDiv({ cls: "mindos-custom-editor-group" });
    aiGroup.createEl("h3", { text: "🤖 AI 生成配置（可选）" });

    const aiToggleRow = aiGroup.createDiv({ cls: "mindos-custom-ai-toggle" });
    const aiCheck = aiToggleRow.createEl("input");
    aiCheck.type = "checkbox";
    aiCheck.id = "ai-enabled-toggle";
    aiCheck.checked = this.scenario.aiEnabled;
    const aiLabel = aiToggleRow.createEl("label");
    aiLabel.htmlFor = "ai-enabled-toggle";
    aiLabel.setText(" 启用 AI 批量生成");

    const aiPromptArea = aiGroup.createDiv({ cls: "mindos-custom-ai-prompt-area" });
    aiPromptArea.style.display = this.scenario.aiEnabled ? "" : "none";

    aiCheck.onchange = () => {
      this.scenario.aiEnabled = aiCheck.checked;
      aiPromptArea.style.display = aiCheck.checked ? "" : "none";
    };

    aiPromptArea.createDiv({
      cls: "mindos-cp-tip",
      text: "配置 AI 系统提示和用户提示模板。AI 输出必须是 JSON 数组，每个对象的字段对应上面定义的字段 key。",
    });

    this.makeFieldTextarea(
      aiPromptArea,
      "AI 系统提示",
      () => this.scenario.aiSystemPrompt ?? "",
      (v) => this.scenario.aiSystemPrompt = v,
      { rows: 4, placeholder: "如：你是古诗词专家。请生成对联记忆卡片。输出 JSON: [{\"title\":\"\",\"upperLine\":\"\",\"lowerLine\":\"\"}]" },
    );

    this.makeFieldTextarea(
      aiPromptArea,
      "用户提示模板",
      () => this.scenario.aiUserPromptTemplate ?? "",
      (v) => this.scenario.aiUserPromptTemplate = v,
      { rows: 2, placeholder: "如：请生成 {{count}} 首关于「{{topic}}」的诗词" },
    );

    // 预览区
    const previewGroup = contentEl.createDiv({ cls: "mindos-custom-editor-group" });
    previewGroup.createEl("h3", { text: "👁 模板预览" });
    this.renderTemplatePreview(previewGroup);

    // 按钮
    const btnRow = contentEl.createDiv({ cls: "mindos-cp-btn-row" });

    const cancelBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    cancelBtn.setText("取消");
    cancelBtn.onclick = () => this.close();

    const saveBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(saveBtn.createSpan(), "save");
    saveBtn.createSpan({ text: this.isNew ? " 创建场景" : " 保存修改" });
    saveBtn.onclick = () => this.handleSave();
  }

  // ─── 字段输入构造器 ───
  private makeFieldInput(
    parent: HTMLElement,
    label: string,
    getter: () => string,
    setter: (v: string) => void,
    opts: { width?: string; placeholder?: string } = {},
  ) {
    const row = parent.createDiv({ cls: "mindos-cp-field" });
    row.createDiv({ cls: "mindos-cp-label", text: label });
    const input = row.createEl("input", { type: "text", cls: "mindos-cp-input" });
    input.value = getter();
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.width) input.style.width = opts.width;
    input.oninput = () => setter(input.value);
  }

  private makeFieldTextarea(
    parent: HTMLElement,
    label: string,
    getter: () => string,
    setter: (v: string) => void,
    opts: { rows?: number; placeholder?: string } = {},
  ) {
    const row = parent.createDiv({ cls: "mindos-cp-field" });
    row.createDiv({ cls: "mindos-cp-label", text: label });
    const ta = row.createEl("textarea", { cls: "mindos-cp-textarea" });
    ta.value = getter();
    ta.rows = opts.rows ?? 3;
    if (opts.placeholder) ta.placeholder = opts.placeholder;
    if (label.includes("模板") || label.includes("提示")) {
      ta.style.fontFamily = "var(--font-monospace)";
      ta.style.fontSize = "12px";
    }
    ta.oninput = () => setter(ta.value);
  }

  // ─── 字段编辑器 ───
  private renderFieldEditor(parent: HTMLElement, index: number) {
    const field = this.scenario.fields[index];
    const item = parent.createDiv({ cls: "mindos-custom-field-editor" });

    const row1 = item.createDiv({ cls: "mindos-custom-field-row" });

    // key
    const keyInput = row1.createEl("input", { type: "text", cls: "mindos-cp-input" });
    keyInput.placeholder = "字段 key（英文）";
    keyInput.value = field.key;
    keyInput.style.maxWidth = "150px";
    keyInput.oninput = () => { field.key = keyInput.value.trim(); };

    // label
    const labelInput = row1.createEl("input", { type: "text", cls: "mindos-cp-input" });
    labelInput.placeholder = "显示名";
    labelInput.value = field.label;
    labelInput.oninput = () => { field.label = labelInput.value; };

    // type
    const typeSelect = row1.createEl("select", { cls: "mindos-cp-select" });
    for (const [v, l] of Object.entries(CUSTOM_FIELD_TYPE_LABELS)) {
      const opt = typeSelect.createEl("option", { value: v, text: l });
      if (field.type === v) opt.selected = true;
    }
    typeSelect.style.maxWidth = "130px";
    typeSelect.onchange = () => { field.type = typeSelect.value as CustomFieldType; };

    // required + delete
    const reqLabel = row1.createEl("label");
    reqLabel.style.display = "flex";
    reqLabel.style.alignItems = "center";
    reqLabel.style.gap = "4px";
    reqLabel.style.fontSize = "11px";
    reqLabel.style.color = "var(--text-muted)";
    const reqCheck = reqLabel.createEl("input");
    reqCheck.type = "checkbox";
    reqCheck.checked = field.required ?? false;
    reqCheck.onchange = () => { field.required = reqCheck.checked; };
    reqLabel.createSpan({ text: "必填" });

    const delBtn = row1.createEl("button", { cls: "mindos-mini-btn is-danger" });
    setIcon(delBtn, "x");
    delBtn.setAttribute("title", "删除字段");
    delBtn.onclick = () => {
      this.scenario.fields.splice(index, 1);
      this.refresh();
    };

    // 排序按钮
    if (index > 0) {
      const upBtn = row1.createEl("button", { cls: "mindos-mini-btn" });
      setIcon(upBtn, "chevron-up");
      upBtn.setAttribute("title", "上移");
      upBtn.onclick = () => {
        [this.scenario.fields[index - 1], this.scenario.fields[index]] =
          [this.scenario.fields[index], this.scenario.fields[index - 1]];
        this.refresh();
      };
    }

    // placeholder
    const row2 = item.createDiv({ cls: "mindos-custom-field-row" });
    const phInput = row2.createEl("input", { type: "text", cls: "mindos-cp-input" });
    phInput.placeholder = "占位提示（可选）";
    phInput.value = field.placeholder ?? "";
    phInput.oninput = () => { field.placeholder = phInput.value || undefined; };

    // select 选项
    if (field.type === "select") {
      const optsInput = row2.createEl("input", { type: "text", cls: "mindos-cp-input" });
      optsInput.placeholder = "可选项（逗号分隔）";
      optsInput.value = (field.options ?? []).join(", ");
      optsInput.oninput = () => {
        field.options = optsInput.value
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
      };
    }
  }

  // ─── 模板预览 ───
  private renderTemplatePreview(parent: HTMLElement) {
    parent.createDiv({
      cls: "mindos-cp-tip",
      text: "用占位符示例值实时预览模板效果",
    });

    // 占位值
    const sampleValues: Record<string, any> = {};
    for (const f of this.scenario.fields) {
      sampleValues[f.key] = f.placeholder || `[${f.label}]`;
    }

    const previewWrap = parent.createDiv({ cls: "mindos-custom-preview" });

    const front = previewWrap.createDiv({ cls: "mindos-custom-preview-side" });
    front.createDiv({ cls: "mindos-custom-preview-label", text: "🎯 正面" });
    const frontContent = front.createDiv({ cls: "mindos-custom-preview-content" });
    try {
      frontContent.setText(this.store.renderTemplate(this.scenario.frontTemplate, sampleValues));
    } catch {
      frontContent.setText("（模板错误）");
    }

    const back = previewWrap.createDiv({ cls: "mindos-custom-preview-side" });
    back.createDiv({ cls: "mindos-custom-preview-label", text: "✅ 背面" });
    const backContent = back.createDiv({ cls: "mindos-custom-preview-content" });
    try {
      backContent.setText(this.store.renderTemplate(this.scenario.backTemplate, sampleValues));
    } catch {
      backContent.setText("（模板错误）");
    }
  }

  // ─── 保存 ───
  private async handleSave() {
    if (!this.scenario.name.trim()) {
      new Notice("⚠️ 请填写场景名");
      return;
    }
    if (this.scenario.fields.length === 0) {
      new Notice("⚠️ 至少需要一个字段");
      return;
    }
    if (!this.scenario.frontTemplate.trim() || !this.scenario.backTemplate.trim()) {
      new Notice("⚠️ 正面和背面模板必填");
      return;
    }

    // 校验 key 唯一
    const keys = this.scenario.fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      new Notice("⚠️ 字段 key 不能重复");
      return;
    }

    try {
      if (this.isNew) {
        await this.store.create(this.scenario);
        new Notice(`✅ 已创建场景：${this.scenario.name}`);
      } else {
        await this.store.update(this.scenario);
        new Notice(`✅ 已保存修改`);
      }
      this.onSaved();
      this.close();
    } catch (e) {
      new Notice(`❌ 保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════
// 卡片创建弹窗
// ════════════════════════════════════════════════════════════

class CustomCardCreatorModal extends Modal {
  private values: Record<string, any> = {};

  constructor(
    app: App,
    private scenario: CustomScenario,
    private store: CustomScenarioStore,
    private cardStore: RecallCardStore,
    private onSaved: () => void,
  ) {
    super(app);
    // 初始化默认值
    for (const f of scenario.fields) {
      this.values[f.key] = f.defaultValue ?? "";
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-custom-card-create-modal");

    contentEl.createEl("h2", {
      text: `${this.scenario.cover ?? "🎲"} ${this.scenario.name} - 添加卡片`,
    });

    if (this.scenario.description) {
      contentEl.createDiv({
        cls: "mindos-cp-tip",
        text: this.scenario.description,
      });
    }

    // 字段表单
    const form = contentEl.createDiv({ cls: "mindos-custom-card-form" });
    for (const field of this.scenario.fields) {
      this.renderFieldInput(form, field);
    }

    // 按钮
    const btnRow = contentEl.createDiv({ cls: "mindos-cp-btn-row" });
    const cancelBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    cancelBtn.setText("取消");
    cancelBtn.onclick = () => this.close();

    const saveAddBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    setIcon(saveAddBtn.createSpan(), "save");
    saveAddBtn.createSpan({ text: " 保存并继续添加" });
    saveAddBtn.onclick = () => this.handleSave(true);

    const saveBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(saveBtn.createSpan(), "check");
    saveBtn.createSpan({ text: " 保存" });
    saveBtn.onclick = () => this.handleSave(false);

    // 自动聚焦第一个字段
    setTimeout(() => {
      const firstInput = contentEl.querySelector(".mindos-cp-input, .mindos-cp-textarea") as HTMLElement;
      firstInput?.focus();
    }, 50);
  }

  private renderFieldInput(parent: HTMLElement, field: CustomFieldDef) {
    const row = parent.createDiv({ cls: "mindos-cp-field" });

    const labelEl = row.createDiv({ cls: "mindos-cp-label" });
    labelEl.createSpan({ text: field.label });
    if (field.required) {
      labelEl.createSpan({ cls: "mindos-editor-required", text: " *" });
    }

    if (field.type === "text" || field.type === "number") {
      const input = row.createEl("input", {
        type: field.type === "number" ? "number" : "text",
        cls: "mindos-cp-input",
      });
      if (field.placeholder) input.placeholder = field.placeholder;
      input.value = this.values[field.key] ?? "";
      input.oninput = () => {
        this.values[field.key] = field.type === "number"
          ? parseFloat(input.value) || 0
          : input.value;
      };
    } else if (field.type === "textarea" || field.type === "markdown") {
      const ta = row.createEl("textarea", { cls: "mindos-cp-textarea" });
      if (field.placeholder) ta.placeholder = field.placeholder;
      ta.value = this.values[field.key] ?? "";
      ta.rows = field.type === "markdown" ? 5 : 3;
      if (field.type === "markdown") {
        ta.style.fontFamily = "var(--font-monospace)";
        ta.style.fontSize = "12px";
      }
      ta.oninput = () => { this.values[field.key] = ta.value; };
    } else if (field.type === "select") {
      const select = row.createEl("select", { cls: "mindos-cp-select" });
      for (const opt of (field.options ?? [])) {
        const o = select.createEl("option", { value: opt, text: opt });
        if (this.values[field.key] === opt) o.selected = true;
      }
      select.onchange = () => { this.values[field.key] = select.value; };
      if (!this.values[field.key] && field.options?.length) {
        this.values[field.key] = field.options[0];
      }
    } else if (field.type === "tags") {
      const input = row.createEl("input", { type: "text", cls: "mindos-cp-input" });
      input.placeholder = field.placeholder ?? "用逗号分隔";
      input.value = Array.isArray(this.values[field.key])
        ? this.values[field.key].join(", ")
        : (this.values[field.key] ?? "");
      input.oninput = () => {
        this.values[field.key] = input.value
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
      };
    }
  }

  private async handleSave(continueAdding: boolean) {
    const validation = this.store.validateFieldValues(this.scenario, this.values);
    if (!validation.valid) {
      new Notice(`⚠️ ${validation.errors[0]}`);
      return;
    }

    try {
      const card = this.store.buildCard(this.scenario, this.values);
      await this.cardStore.saveCard(card);
      this.cardStore.invalidateCache("custom" as any);

      new Notice("✅ 卡片已创建");
      this.onSaved();

      if (continueAdding) {
        // 重置表单（保留 select 和 number 的值，文本字段清空）
        for (const f of this.scenario.fields) {
          if (f.type === "text" || f.type === "textarea" || f.type === "markdown" || f.type === "tags") {
            this.values[f.key] = "";
          }
        }
        this.onOpen();
      } else {
        this.close();
      }
    } catch (e) {
      new Notice(`❌ 保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ════════════════════════════════════════════════════════════
// AI 批量生成弹窗
// ════════════════════════════════════════════════════════════

class CustomAIGeneratorModal extends Modal {
  private extraValues: Record<string, string> = {};

  constructor(
    app: App,
    private scenario: CustomScenario,
    private store: CustomScenarioStore,
    private cardStore: RecallCardStore,
    private aiGenerator: AICardGenerator,
    private onSaved: () => void,
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mindos-custom-ai-modal");

    contentEl.createEl("h2", {
      text: `🤖 AI 生成 - ${this.scenario.name}`,
    });

    contentEl.createDiv({
      cls: "mindos-cp-tip",
      text: "AI 会根据下方参数批量生成卡片。卡片预览前先确认。",
    });

    // 提取 AI 模板里的占位符 → 让用户填入
    const aiTemplate = this.scenario.aiUserPromptTemplate ?? "";
    const placeholders = this.extractPlaceholders(aiTemplate);

    if (placeholders.length > 0) {
      const tplGroup = contentEl.createDiv({ cls: "mindos-custom-editor-group" });
      tplGroup.createEl("h3", { text: "📝 提示参数" });

      for (const ph of placeholders) {
        const row = tplGroup.createDiv({ cls: "mindos-cp-field" });
        row.createDiv({ cls: "mindos-cp-label", text: ph });
        const input = row.createEl("input", { type: "text", cls: "mindos-cp-input" });
        input.placeholder = `请输入「${ph}」的值`;
        input.value = ph === "count" ? "5" : "";
        this.extraValues[ph] = input.value;
        input.oninput = () => { this.extraValues[ph] = input.value; };
      }
    } else {
      contentEl.createDiv({
        cls: "mindos-cp-tip",
        text: "⚠️ AI 用户提示模板中没有占位符。请在场景编辑中补充。",
      });
    }

    // 操作按钮
    const btnRow = contentEl.createDiv({ cls: "mindos-cp-btn-row" });
    const cancelBtn = btnRow.createEl("button", { cls: "mindos-btn" });
    cancelBtn.setText("取消");
    cancelBtn.onclick = () => this.close();

    const genBtn = btnRow.createEl("button", { cls: "mindos-btn-large is-primary" });
    setIcon(genBtn.createSpan(), "sparkles");
    genBtn.createSpan({ text: " 生成" });
    genBtn.onclick = () => this.handleGenerate();
  }

  private extractPlaceholders(template: string): string[] {
    const set = new Set<string>();
    const regex = /\{\{(\w+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(template)) !== null) {
      set.add(m[1]);
    }
    return Array.from(set);
  }

  private async handleGenerate() {
    if (!this.scenario.aiSystemPrompt || !this.scenario.aiUserPromptTemplate) {
      new Notice("⚠️ 该场景未配置完整的 AI 提示");
      return;
    }

    // 检查参数都填了
    for (const [key, val] of Object.entries(this.extraValues)) {
      if (!val.trim()) {
        new Notice(`⚠️ 参数「${key}」未填写`);
        return;
      }
    }

    const userPrompt = this.store.renderTemplate(
      this.scenario.aiUserPromptTemplate,
      this.extraValues,
    );

    const notice = new Notice("AI 生成中...", 0);

    try {
      const items = await this.aiGenerator.generateSimple<any>(
        this.scenario.aiSystemPrompt,
        userPrompt,
        0.4,
      );

      if (!items || items.length === 0) {
        notice.hide();
        new Notice("❌ AI 未生成任何数据");
        return;
      }

      // 验证 + 转为卡片
      let savedCount = 0;
      const cards = [];
      for (const item of items) {
        // 用 item 作为字段值
        const validation = this.store.validateFieldValues(this.scenario, item);
        if (!validation.valid) continue;

        const card = this.store.buildCard(this.scenario, item);
        cards.push(card);
        savedCount++;
      }

      if (cards.length === 0) {
        notice.hide();
        new Notice("❌ AI 返回的数据缺少必需字段，无法生成卡片");
        return;
      }

      await this.cardStore.saveCards(cards);
      this.cardStore.invalidateCache("custom" as any);

      notice.hide();
      new Notice(`✅ 已生成 ${savedCount} 张卡片`);
      this.onSaved();
      this.close();
    } catch (e) {
      notice.hide();
      new Notice(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}