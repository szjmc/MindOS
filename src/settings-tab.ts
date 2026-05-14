import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type AIPromptCollectorPlugin from "../main";
import { MaturityStatus } from "./types";

export class AIPromptCollectorSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AIPromptCollectorPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "AI Prompt Collector - LLM Wiki" });

    containerEl.createEl("h3", { text: "📁 知识库" });

    new Setting(containerEl)
      .setName("根目录")
      .setDesc("所有 raw / wiki / schema 都在此目录下")
      .addText((t) =>
        t.setPlaceholder("Knowledge Base")
          .setValue(this.plugin.settings.baseFolder)
          .onChange(async (v) => {
            this.plugin.settings.baseFolder = v.trim() || "Knowledge Base";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("初始化目录结构")
      .addButton((b) => b.setButtonText("立即初始化").onClick(async () => {
        await this.plugin.initializeStructure();
        new Notice("✅ 已初始化 LLM Wiki 三层结构");
      }));

    new Setting(containerEl)
      .setName("从旧目录迁移")
      .addButton((b) => b.setButtonText("一键迁移").onClick(async () => {
        const r = await this.plugin.migrateOldStructure();
        new Notice(`迁移完成：${r.moved} 个文件${r.errors.length > 0 ? `，${r.errors.length} 个错误` : ""}`);
      }));

    containerEl.createEl("h3", { text: "🎛 行为" });

    new Setting(containerEl)
      .setName("审核模式")
      .setDesc("AI 输出 actions 后先审核再执行")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.reviewMode).onChange(async (v) => {
          this.plugin.settings.reviewMode = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("注入 CLAUDE.md")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.injectClaudeMd).onChange(async (v) => {
          this.plugin.settings.injectClaudeMd = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("注入 INDEX.md")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.injectIndexMd).onChange(async (v) => {
          this.plugin.settings.injectIndexMd = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("保存后自动打开")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.openAfterSave).onChange(async (v) => {
          this.plugin.settings.openAfterSave = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("默认成熟度")
      .addDropdown((d) => {
        d.addOption("🌱seedling", "🌱 seedling")
          .addOption("🌿budding", "🌿 budding")
          .addOption("🌲evergreen", "🌲 evergreen")
          .setValue(this.plugin.settings.defaultMaturity)
          .onChange(async (v) => {
            this.plugin.settings.defaultMaturity = v as MaturityStatus;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("INDEX 全量重建阈值")
      .addText((t) =>
        t.setPlaceholder("10")
          .setValue(String(this.plugin.settings.indexAutoRebuildAfterN))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.indexAutoRebuildAfterN = Number.isFinite(n) && n > 0 ? n : 10;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("brief 最大长度")
      .addText((t) =>
        t.setPlaceholder("30")
          .setValue(String(this.plugin.settings.briefMaxLength))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.briefMaxLength = Number.isFinite(n) && n > 0 ? n : 30;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("候选页面 Top N")
      .setDesc("差异比对阶段，从现有 Wiki 中筛出 Top N 候选给 AI")
      .addText((t) =>
        t.setPlaceholder("5")
          .setValue(String(this.plugin.settings.candidateTopN))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.candidateTopN = Number.isFinite(n) && n >= 1 ? n : 5;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("h3", { text: "🤖 模型接口" });

    new Setting(containerEl).setName("API Base URL").addText((t) =>
      t.setPlaceholder("https://api.openai.com/v1")
        .setValue(this.plugin.settings.apiBaseUrl)
        .onChange(async (v) => { this.plugin.settings.apiBaseUrl = v.trim(); await this.plugin.saveSettings(); })
    );

    new Setting(containerEl).setName("API Key").addText((t) => {
      t.setPlaceholder("sk-...")
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (v) => { this.plugin.settings.apiKey = v.trim(); await this.plugin.saveSettings(); });
      t.inputEl.type = "password";
    });

    new Setting(containerEl).setName("Model").addText((t) =>
      t.setPlaceholder("gpt-4o-mini")
        .setValue(this.plugin.settings.model)
        .onChange(async (v) => { this.plugin.settings.model = v.trim(); await this.plugin.saveSettings(); })
    );

    new Setting(containerEl).setName("Temperature").addText((t) =>
      t.setPlaceholder("0.1")
        .setValue(String(this.plugin.settings.temperature))
        .onChange(async (v) => {
          const n = Number(v);
          this.plugin.settings.temperature = Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 0.1;
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl).setName("超时（毫秒）").addText((t) =>
      t.setPlaceholder("60000")
        .setValue(String(this.plugin.settings.timeoutMs))
        .onChange(async (v) => {
          const n = Number(v);
          this.plugin.settings.timeoutMs = Number.isFinite(n) && n > 0 ? n : 60000;
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl).setName("失败重试").addText((t) =>
      t.setPlaceholder("2")
        .setValue(String(this.plugin.settings.maxRetries))
        .onChange(async (v) => {
          const n = parseInt(v);
          this.plugin.settings.maxRetries = Number.isFinite(n) && n >= 0 ? n : 2;
          await this.plugin.saveSettings();
        })
    );

    new Setting(containerEl).setName("并发").addText((t) =>
      t.setPlaceholder("2")
        .setValue(String(this.plugin.settings.concurrency))
        .onChange(async (v) => {
          const n = parseInt(v);
          this.plugin.settings.concurrency = Number.isFinite(n) && n >= 1 ? Math.min(5, n) : 2;
          await this.plugin.saveSettings();
        })
    );
  }
}