import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type MindOSPlugin from "../../main";
import { MaturityStatus, EmbeddingProvider } from "../core/types";
import { PLUGIN_NAME, PLUGIN_SLOGAN } from "../core/constants";

export class MindOSSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MindOSPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: PLUGIN_NAME });
    const sloganEl = containerEl.createEl("p", { text: PLUGIN_SLOGAN });
    sloganEl.style.cssText = "color: var(--text-muted); margin-top: -8px; font-style: italic;";

    // ── 知识库 ──
    containerEl.createEl("h3", { text: "📁 知识库" });

    new Setting(containerEl)
      .setName("根目录")
      .setDesc("所有 原始素材 / 知识库 / 规则 都在此目录下")
      .addText((t) =>
        t.setPlaceholder("知识基地")
          .setValue(this.plugin.settings.baseFolder)
          .onChange(async (v) => {
            this.plugin.settings.baseFolder = v.trim() || "知识基地";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("初始化目录结构")
      .setDesc("创建 原始素材 / 知识库 / 规则 三层目录及默认规则文件")
      .addButton((b) => b.setButtonText("立即初始化").onClick(async () => {
        await this.plugin.initializeStructure();
        new Notice("✅ 已初始化 MindOS 三层结构");
      }));

    new Setting(containerEl)
      .setName("从旧版本迁移")
      .setDesc("把旧的 00-Inbox / 40-Atlas / 50-Sources 迁移到新结构")
      .addButton((b) => b.setButtonText("一键迁移").onClick(async () => {
        const r = await this.plugin.migrateOldStructure();
        new Notice(`迁移完成：${r.moved} 个文件${r.errors.length > 0 ? `，${r.errors.length} 个错误` : ""}`);
      }));

    new Setting(containerEl)
      .setName("迁移到中文文件夹")
      .setDesc("将英文文件夹名（raw/wiki/schema/_system）迁移到中文（原始素材/知识库/规则/_系统数据）")
      .addButton((b) => b.setButtonText("开始迁移").onClick(async () => {
        new Notice("开始迁移...");
        const r = await this.plugin.migrator.migrateToChinesePaths();
        if (r.moved > 0) {
          new Notice(`✅ 成功迁移 ${r.moved} 个文件`);
        } else {
          new Notice("没有需要迁移的文件");
        }
        if (r.errors.length > 0) {
          new Notice(`⚠️ ${r.errors.length} 个迁移错误，请查看控制台`);
          console.warn("[MindOS] 迁移错误：", r.errors);
        }
      }));

    // ── 行为 ──
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
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("10")
          .setValue(String(this.plugin.settings.indexAutoRebuildAfterN))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.indexAutoRebuildAfterN = Number.isFinite(n) && n > 0 ? n : 10;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("brief 最大长度")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("30")
          .setValue(String(this.plugin.settings.briefMaxLength))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.briefMaxLength = Number.isFinite(n) && n > 0 ? n : 30;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("候选页面 Top N")
      .setDesc("差异比对阶段，从现有 Wiki 中筛出 Top N 候选给 AI")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("5")
          .setValue(String(this.plugin.settings.candidateTopN))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.candidateTopN = Number.isFinite(n) && n >= 1 ? n : 5;
            await this.plugin.saveSettings();
          });
      });

    // ── Chat 模型 ──
    containerEl.createEl("h3", { text: "🤖 Chat 模型" });

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

    new Setting(containerEl).setName("超时（毫秒）").addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("60000")
          .setValue(String(this.plugin.settings.timeoutMs))
          .onChange(async (v) => {
            const n = Number(v);
            this.plugin.settings.timeoutMs = Number.isFinite(n) && n > 0 ? n : 60000;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("失败重试").addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "0";
        t.setPlaceholder("2")
          .setValue(String(this.plugin.settings.maxRetries))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.maxRetries = Number.isFinite(n) && n >= 0 ? n : 2;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("并发").addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.inputEl.max = "5";
        t.setPlaceholder("2")
          .setValue(String(this.plugin.settings.concurrency))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.concurrency = Number.isFinite(n) && n >= 1 ? Math.min(5, n) : 2;
            await this.plugin.saveSettings();
          });
      });

    // ── v0.5 Embedding ──
    containerEl.createEl("h3", { text: "🧠 Embedding (检索核心)" });

    new Setting(containerEl)
      .setName("Provider")
      .addDropdown((d) => {
        d.addOption("openai", "OpenAI");
        d.addOption("zhipu", "智谱 AI");
        d.addOption("aliyun", "阿里云");
        d.addOption("custom", "自定义");
        d.setValue(this.plugin.settings.embeddingProvider);
        d.onChange(async (v) => {
          this.plugin.settings.embeddingProvider = v as EmbeddingProvider;
          if (v === "openai") {
            this.plugin.settings.embeddingApiBaseUrl = "https://api.openai.com/v1";
            this.plugin.settings.embeddingModel = "text-embedding-3-small";
            this.plugin.settings.embeddingDim = 0;
            this.plugin.settings.costPerMillionTokensEmbedding = 0.15;
          } else if (v === "zhipu") {
            this.plugin.settings.embeddingApiBaseUrl = "https://open.bigmodel.cn/api/paas/v4";
            this.plugin.settings.embeddingModel = "embedding-3";
            this.plugin.settings.embeddingDim = 2048;
            this.plugin.settings.costPerMillionTokensEmbedding = 0.5;
          } else if (v === "aliyun") {
            this.plugin.settings.embeddingApiBaseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
            this.plugin.settings.embeddingModel = "text-embedding-v3";
            this.plugin.settings.embeddingDim = 1024;
            this.plugin.settings.costPerMillionTokensEmbedding = 0.7;
          }
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl).setName("Embedding API Base URL").addText((t) =>
      t.setPlaceholder("https://api.openai.com/v1")
        .setValue(this.plugin.settings.embeddingApiBaseUrl)
        .onChange(async (v) => { this.plugin.settings.embeddingApiBaseUrl = v.trim(); await this.plugin.saveSettings(); })
    );

    new Setting(containerEl).setName("Embedding API Key").addText((t) => {
      t.setPlaceholder("sk-...")
        .setValue(this.plugin.settings.embeddingApiKey)
        .onChange(async (v) => { this.plugin.settings.embeddingApiKey = v.trim(); await this.plugin.saveSettings(); });
      t.inputEl.type = "password";
    });

    new Setting(containerEl).setName("Embedding Model").addText((t) =>
      t.setPlaceholder("text-embedding-3-small")
        .setValue(this.plugin.settings.embeddingModel)
        .onChange(async (v) => { this.plugin.settings.embeddingModel = v.trim(); await this.plugin.saveSettings(); })
    );

    new Setting(containerEl)
      .setName("向量维度")
      .setDesc("0 表示使用模型默认。OpenAI text-embedding-3 系列支持自定义维度（如 512/1024）")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "0";
        t.setPlaceholder("0")
          .setValue(String(this.plugin.settings.embeddingDim))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.embeddingDim = Number.isFinite(n) && n >= 0 ? n : 0;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("批次大小")
      .setDesc("每次 API 请求嵌入多少个文本片段（阿里云建议 25）")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("50")
          .setValue(String(this.plugin.settings.embeddingBatchSize))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.embeddingBatchSize = Number.isFinite(n) && n > 0 ? n : 50;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("切片最大字符数")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("800")
          .setValue(String(this.plugin.settings.embeddingChunkMaxChars))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.embeddingChunkMaxChars = Number.isFinite(n) && n > 0 ? n : 800;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("切片最小字符数")
      .setDesc("低于此长度的章节会被合并到前一个章节")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("100")
          .setValue(String(this.plugin.settings.embeddingChunkMinChars))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.embeddingChunkMinChars = Number.isFinite(n) && n > 0 ? n : 100;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc("发送一个测试请求，验证 Embedding API 可用")
      .addButton((b) => b.setButtonText("测试").onClick(async () => {
        const r = await this.plugin.embeddingClient.test();
        new Notice(r.message);
        if (r.success && r.dim && this.plugin.settings.embeddingDim === 0) {
          this.plugin.settings.embeddingDim = r.dim;
          await this.plugin.saveSettings();
          this.display();
        }
      }));

    const autoVectorizeSetting = new Setting(containerEl)
      .setName("自动向量化")
      .setDesc("⚠️ 警告：开启后，每次修改 Wiki 页面会自动调用 API 进行向量化，会产生费用消耗。建议手动点击「全量索引」进行向量化。")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoVectorize).onChange(async (v) => {
          if (v && !confirm("⚠️ 确定要开启自动向量化吗？此功能会在每次修改页面时调用 API，可能产生意外费用消耗。")) {
            return;
          }
          this.plugin.settings.autoVectorize = v;
          await this.plugin.saveSettings();
        })
      );

    // 给警告设置添加红色样式
    autoVectorizeSetting.descEl.style.color = "var(--text-error)";
    autoVectorizeSetting.descEl.style.fontWeight = "500";

    new Setting(containerEl)
      .setName("批量触发阈值")
      .setDesc("积累多少个文件变更后触发一次批量向量化（默认 5）")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("5")
          .setValue(String(this.plugin.settings.autoVectorizeThreshold))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.autoVectorizeThreshold = Number.isFinite(n) && n > 0 ? n : 5;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("每日 Token 限额")
      .setDesc("设置每日最大 Token 使用量（Embedding + Chat），超出后将阻止 API 调用。设置为 0 表示无限制。")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "0";
        t.setPlaceholder("100000")
          .setValue(String(this.plugin.settings.dailyTokenLimit))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.dailyTokenLimit = Number.isFinite(n) && n >= 0 ? n : 100000;
            await this.plugin.saveSettings();
          });
      });

    // ── 搜索设置 ──
    containerEl.createEl("h3", { text: "🔍 搜索设置" });

    new Setting(containerEl)
      .setName("搜索结果数量 (Top K)")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("10")
          .setValue(String(this.plugin.settings.searchTopK))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.searchTopK = Number.isFinite(n) && n > 0 ? n : 10;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("最低相似度阈值")
      .setDesc("低于此分数的结果将被过滤 (0-1)")
      .addSlider((s) =>
        s.setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.searchMinScore)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.searchMinScore = v;
            await this.plugin.saveSettings();
          })
      );

    // ── RAG ──
    containerEl.createEl("h3", { text: "💬 RAG 问答设置" });

    new Setting(containerEl)
      .setName("启用 RAG 问答")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.ragEnabled).onChange(async (v) => {
          this.plugin.settings.ragEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("启用流式输出")
      .setDesc("逐字显示回答，体验更好（需 API 支持 SSE）")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.ragStreaming).onChange(async (v) => {
          this.plugin.settings.ragStreaming = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("RAG 上下文条数 (Top K)")
      .setDesc("每次问答检索多少条相关片段作为上下文")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("5")
          .setValue(String(this.plugin.settings.ragTopK))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.ragTopK = Number.isFinite(n) && n > 0 ? n : 5;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("RAG Temperature")
      .setDesc("回答的创造性（0=严谨，1=灵活）")
      .addSlider((s) =>
        s.setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.ragTemperature)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.ragTemperature = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("最大上下文 Token 数")
      .setDesc("注入到 Prompt 中的 Wiki 内容上限")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("4000")
          .setValue(String(this.plugin.settings.ragMaxContextTokens))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.ragMaxContextTokens = Number.isFinite(n) && n > 0 ? n : 4000;
            await this.plugin.saveSettings();
          });
      });

    // ── 配额与成本 ──
    containerEl.createEl("h3", { text: "💰 配额与成本" });

    new Setting(containerEl)
      .setName("每日 Token 上限")
      .setDesc("0 表示不限制。超过上限将阻止操作。")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "0";
        t.setPlaceholder("1000000")
          .setValue(String(this.plugin.settings.dailyTokenLimit))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.dailyTokenLimit = Number.isFinite(n) && n >= 0 ? n : 1000000;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("高额操作警告")
      .setDesc("执行预计消耗较大的操作前显示确认")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.warnOnHighCost).onChange(async (v) => {
          this.plugin.settings.warnOnHighCost = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Embedding 单价 (¥/1M tokens)")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "0";
        t.inputEl.step = "0.01";
        t.setPlaceholder("0.15")
          .setValue(String(this.plugin.settings.costPerMillionTokensEmbedding))
          .onChange(async (v) => {
            const n = Number(v);
            this.plugin.settings.costPerMillionTokensEmbedding = Number.isFinite(n) ? n : 0.15;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Chat 单价 (¥/1M tokens)")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "0";
        t.inputEl.step = "0.01";
        t.setPlaceholder("1.0")
          .setValue(String(this.plugin.settings.costPerMillionTokensChat))
          .onChange(async (v) => {
            const n = Number(v);
            this.plugin.settings.costPerMillionTokensChat = Number.isFinite(n) ? n : 1.0;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("重置配额")
      .setDesc("清空当日已用 token 计数（不影响历史）")
      .addButton((b) => b.setButtonText("重置").onClick(async () => {
        if (!confirm("确定重置今日配额？")) return;
        await this.plugin.quotaManager.reset();
        await this.plugin.refreshQuota();
        new Notice("✅ 已重置配额");
      }));

    // ── 导出设置 ──
    containerEl.createEl("h3", { text: "📤 导出设置" });

    new Setting(containerEl)
      .setName("默认导出目录")
      .setDesc("对话默认导出到此目录（相对路径）")
      .addText((t) =>
        t.setPlaceholder("知识库/主题")
          .setValue(this.plugin.settings.chatExportFolder)
          .onChange(async (v) => {
            this.plugin.settings.chatExportFolder = v.trim() || "知识库/主题";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("自定义导出目录")
      .setDesc("如果填写，将覆盖默认目录（用户自定义路径）")
      .addText((t) =>
        t.setPlaceholder("（留空使用默认）")
          .setValue(this.plugin.settings.chatExportCustomPath)
          .onChange(async (v) => {
            this.plugin.settings.chatExportCustomPath = v.trim();
            await this.plugin.saveSettings();
          })
      );

    // ✅ v0.7 Express 导出目录（新增）
    new Setting(containerEl)
      .setName("Express 导出目录")
      .setDesc("相对于 baseFolder 的路径，例如：知识库/文章、知识库/主题、知识库/概述")
      .addText((t) =>
        t.setPlaceholder("知识库/文章")
          .setValue(this.plugin.settings.expressExportFolder || "知识库/文章")
          .onChange(async (v) => {
            this.plugin.settings.expressExportFolder = v.trim() || "知识库/文章";
            await this.plugin.saveSettings();
          })
      );

    // ── v0.6 Recall ──
    containerEl.createEl("h3", { text: "🧠 Recall 复习设置" });

    // ── v0.7 TTS 听力模式 ──
    containerEl.createEl("h4", { text: "🔊 TTS 听力模式（v0.7）" });

        // ── v0.7 Vocab TTS 快捷键 ──
    containerEl.createEl("h4", { text: "⌨️ 单词朗读快捷键（v0.7）" });

    new Setting(containerEl)
      .setName("朗读快捷键（主）")
      .setDesc("仅在单词（vocab）场景生效。格式示例：Shift+Space / Alt+S / Ctrl+Enter / Cmd+K。留空=禁用。")
      .addText((t) =>
        t.setPlaceholder("Shift+Space")
          .setValue(this.plugin.settings.recallVocabTTSHotkey ?? "Shift+Space")
          .onChange(async (v) => {
            this.plugin.settings.recallVocabTTSHotkey = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("朗读快捷键（备选）")
      .setDesc("主快捷键不方便时的备用键位。留空=禁用。")
      .addText((t) =>
        t.setPlaceholder("Alt+S")
          .setValue(this.plugin.settings.recallVocabTTSHotkeyAlt ?? "Alt+S")
          .onChange(async (v) => {
            this.plugin.settings.recallVocabTTSHotkeyAlt = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("启用 TTS")
      .setDesc("在英语单词复习时可一键朗读（基于浏览器 Web Speech API）")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.recallTTSEnabled ?? true).onChange(async (v) => {
          this.plugin.settings.recallTTSEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("语言 (lang)")
      .setDesc("如：en-US / en-GB / ja-JP / fr-FR")
      .addText((t) =>
        t.setPlaceholder("en-US")
          .setValue(this.plugin.settings.recallTTSLang ?? "en-US")
          .onChange(async (v) => {
            this.plugin.settings.recallTTSLang = v.trim() || "en-US";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("语速 (rate)")
      .setDesc("0.5 - 2.0，建议 0.9~1.1")
      .addSlider((s) =>
        s.setLimits(0.5, 2, 0.05)
          .setValue(this.plugin.settings.recallTTSRate ?? 1.0)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.recallTTSRate = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("音高 (pitch)")
      .setDesc("0 - 2")
      .addSlider((s) =>
        s.setLimits(0, 2, 0.05)
          .setValue(this.plugin.settings.recallTTSPitch ?? 1.0)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.recallTTSPitch = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("音量 (volume)")
      .setDesc("0 - 1")
      .addSlider((s) =>
        s.setLimits(0, 1, 0.05)
          .setValue(this.plugin.settings.recallTTSVolume ?? 1.0)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.recallTTSVolume = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("优先音色 (Voice Name，可选)")
      .setDesc("填 SpeechSynthesisVoice.name；留空则自动选择匹配语言的默认音色")
      .addText((t) =>
        t.setPlaceholder("（留空自动选择）")
          .setValue(this.plugin.settings.recallTTSPreferredVoice ?? "")
          .onChange(async (v) => {
            this.plugin.settings.recallTTSPreferredVoice = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("SRS 算法")
      .setDesc("SM-2：经典简单；FSRS：更精准（基于记忆模型）")
      .addDropdown((d) => {
        d.addOption("sm2", "SM-2（推荐）");
        d.addOption("fsrs", "FSRS-4.5");
        d.setValue(this.plugin.settings.recallSRSAlgorithm ?? "sm2");
        d.onChange(async (v) => {
          this.plugin.settings.recallSRSAlgorithm = v as "sm2" | "fsrs";
          this.plugin.srsEngine.setAlgorithm(v as any);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("每日新卡片上限")
      .setDesc("每天最多学习多少张新卡片（默认 20）")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("20")
          .setValue(String(this.plugin.settings.recallNewCardsPerDay ?? 20))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.recallNewCardsPerDay = Number.isFinite(n) && n > 0 ? n : 20;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("每日复习上限")
      .setDesc("每天最多复习多少张旧卡片（默认 100）")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("100")
          .setValue(String(this.plugin.settings.recallReviewLimit ?? 100))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.recallReviewLimit = Number.isFinite(n) && n > 0 ? n : 100;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("重置复习数据缓存")
      .setDesc("清空内存缓存，强制从文件重新加载卡片")
      .addButton((b) =>
        b.setButtonText("重置缓存").onClick(async () => {
          this.plugin.recallCardStore.invalidateCache();
          new Notice("✅ 已重置复习数据缓存");
        })
      );

        // --- 自动朗读开关 ---
    new Setting(containerEl)
      .setName("翻到新词自动朗读")
      .setDesc("vocab 场景：每张新卡出现时自动朗读一次（Space 重读，Enter 翻转）")
      .addToggle(toggle =>
        toggle
          .setValue(this.plugin.settings.recallVocabAutoSpeak ?? false)
          .onChange(async (v) => {
            this.plugin.settings.recallVocabAutoSpeak = v;
            await this.plugin.saveSettings();
          })
      );
    // ── 紧急控制 ──
    containerEl.createEl("h3", { text: "🚨 紧急控制" });
    
    const emergencySection = containerEl.createDiv({ cls: "mindos-emergency-section" });
    emergencySection.style.cssText = "background: var(--background-modifier-error); padding: 16px; border-radius: 8px; margin-bottom: 16px;";
    
    const emergencyTitle = emergencySection.createEl("h4", { text: "紧急停止所有 API 调用" });
    emergencyTitle.style.cssText = "color: var(--text-error); margin-top: 0;";
    
    const emergencyDesc = emergencySection.createEl("p", { 
      text: "如果发现插件在后台消耗大量 Token，点击下方按钮紧急停止所有 API 调用。" 
    });
    emergencyDesc.style.cssText = "color: var(--text-muted); margin-bottom: 12px;";
    
    const emergencyBtnContainer = emergencySection.createDiv({ cls: "mindos-emergency-buttons" });
    emergencyBtnContainer.style.cssText = "display: flex; gap: 8px;";
    
    const stopBtn = emergencyBtnContainer.createEl("button", { text: "🛑 紧急停止" });
    stopBtn.style.cssText = "background: var(--interactive-normal); border: 1px solid var(--background-modifier-border); color: var(--text-error); padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;";
    stopBtn.onclick = async () => {
      if (confirm("确定要紧急停止所有 API 调用吗？\n\n这将：\n1. 立即停止所有进行中的向量化\n2. 清空待向量化队列\n3. 禁用自动向量化功能")) {
        try {
          this.plugin.settings.autoVectorize = false;
          await this.plugin.saveSettings();
          // 尝试停止正在进行的向量化
          if (this.plugin.embeddingManager) {
            this.plugin.embeddingManager.emergencyStop();
          }
          this.display();
          new Notice("🚨 已紧急停止所有 API 调用！");
        } catch (err) {
          console.error("[MindOS] 紧急停止失败:", err);
          new Notice("❌ 紧急停止操作失败，请检查控制台");
        }
      }
    };
    
    const checkQuotaBtn = emergencyBtnContainer.createEl("button", { text: "📊 查看配额" });
    checkQuotaBtn.style.cssText = "background: var(--interactive-normal); border: 1px solid var(--background-modifier-border); padding: 8px 16px; border-radius: 6px; cursor: pointer;";
    checkQuotaBtn.onclick = async () => {
      try {
        const status = await this.plugin.quotaManager.getStatus();
        const limit = this.plugin.settings.dailyTokenLimit;
        const usedStr = status.used.toLocaleString();
        const limitStr = limit > 0 ? limit.toLocaleString() : "∞";
        const pctStr = limit > 0 ? ` (${Math.round(status.pct)}%)` : "";
        new Notice(`📊 今日 Token 使用：${usedStr} / ${limitStr}${pctStr}`);
      } catch (err) {
        console.error("[MindOS] 查看配额失败:", err);
        new Notice("❌ 查看配额失败，请检查控制台");
      }
    };
    
    // ── v0.9 深度关联 ──
    containerEl.createEl("h3", { text: "🔗 深度关联 (v0.9)" });

    containerEl.createEl("h4", { text: "自动链接挖掘" });
    
    new Setting(containerEl)
      .setName("自动扫描间隔（分钟）")
      .setDesc("后台自动扫描潜在链接的时间间隔，建议 30-60 分钟")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("60")
          .setValue(String(this.plugin.settings.autoLinkScanInterval ?? 60))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.autoLinkScanInterval = Number.isFinite(n) && n > 0 ? n : 60;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("手动扫描链接")
      .setDesc("立即扫描所有页面，发现潜在链接建议")
      .addButton((b) => b.setButtonText("开始扫描").onClick(async () => {
        new Notice("🔍 开始扫描潜在链接...");
        try {
          const suggestions = await this.plugin.autoLinkMiner.scanAllPagesForPotentialLinks();
          new Notice(`✅ 扫描完成，发现 ${suggestions.length} 个潜在链接建议`);
        } catch (e) {
          console.error("[MindOS] 链接扫描失败:", e);
          new Notice("❌ 扫描失败，请检查控制台");
        }
      }));

    containerEl.createEl("h4", { text: "矛盾检测" });

    new Setting(containerEl)
      .setName("启用矛盾检测")
      .setDesc("自动检测页面间的不一致描述")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.contradictionDetectionEnabled ?? true).onChange(async (v) => {
          this.plugin.settings.contradictionDetectionEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("检测间隔（小时）")
      .setDesc("后台自动检测矛盾的时间间隔，建议 12-24 小时")
      .addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.min = "1";
        t.setPlaceholder("24")
          .setValue(String(this.plugin.settings.contradictionScanInterval ?? 24))
          .onChange(async (v) => {
            const n = parseInt(v);
            this.plugin.settings.contradictionScanInterval = Number.isFinite(n) && n > 0 ? n : 24;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("手动检测矛盾")
      .setDesc("立即检测所有页面，发现矛盾描述")
      .addButton((b) => b.setButtonText("开始检测").onClick(async () => {
        new Notice("🔍 开始检测矛盾描述...");
        try {
          const report = await this.plugin.contradictionDetector.detectContradictions();
          const msg = report.totalConflicts > 0 
            ? `⚠️ 检测完成，发现 ${report.totalConflicts} 个潜在矛盾（高: ${report.bySeverity.high}, 中: ${report.bySeverity.medium}, 低: ${report.bySeverity.low}）`
            : `✅ 检测完成，未发现矛盾描述`;
          new Notice(msg);
        } catch (e) {
          console.error("[MindOS] 矛盾检测失败:", e);
          new Notice("❌ 检测失败，请检查控制台");
        }
      }));

    // ── 活动日志 ──
    containerEl.createEl("h3", { text: "📜 活动日志" });
    
    const logSection = containerEl.createDiv({ cls: "mindos-log-section" });
    
    new Setting(logSection)
      .setName("最近活动")
      .setDesc("插件最近的操作记录（用于诊断问题）")
      .addButton((b) => b.setButtonText("刷新日志").onClick(() => {
        this.display();
      }));
    
    const logContainer = logSection.createDiv({ cls: "mindos-log-container" });
    logContainer.style.cssText = "max-height: 300px; overflow-y: auto; background: var(--background-secondary); border-radius: 6px; padding: 12px; font-family: monospace; font-size: 12px;";
    
    // 获取真实的日志
    const recentLogs = this.plugin.activityLogger?.getRecentLogs(50) || [];
    
    if (recentLogs.length === 0) {
      const emptyEl = logContainer.createDiv({ cls: "mindos-log-empty" });
      emptyEl.style.cssText = "color: var(--text-muted); text-align: center; padding: 20px;";
      emptyEl.textContent = "暂无活动日志";
    } else {
      for (const log of recentLogs) {
        const logEl = logContainer.createDiv({ cls: "mindos-log-entry" });
        const timeStr = new Date(log.timestamp).toLocaleString('zh-CN');
        const timeEl = logEl.createSpan({ cls: "mindos-log-time", text: `[${timeStr}]` });
        timeEl.style.cssText = "color: var(--text-faint); margin-right: 8px;";
        
        const levelEl = logEl.createSpan({ cls: `mindos-log-level mindos-log-level-${log.level}`, text: `[${log.level.toUpperCase()}]` });
        levelEl.style.cssText = `color: ${log.level === 'error' ? 'var(--text-error)' : log.level === 'warn' ? 'var(--text-warning)' : 'var(--text-accent)'}; margin-right: 8px; font-weight: 600;`;
        
        if (log.source) {
          const sourceEl = logEl.createSpan({ cls: "mindos-log-source", text: `[${log.source}]` });
          sourceEl.style.cssText = "color: var(--text-muted); margin-right: 8px;";
        }
        
        const msgEl = logEl.createSpan({ cls: "mindos-log-message", text: log.message });
      }
    }
    
    new Setting(logSection)
      .setName("清空日志")
      .addButton((b) => b.setButtonText("清空").onClick(async () => {
        if (this.plugin.activityLogger) {
          this.plugin.activityLogger.clear();
          new Notice("✅ 日志已清空");
          this.display();
        }
      }));
  }
}


