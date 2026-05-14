import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	normalizePath,
	requestUrl
} from "obsidian";

const VIEW_TYPE_AI_TASK_CENTER = "ai-task-center-view";

type ProtocolValue = string | string[] | undefined;

interface PromptPayload {
	source: string;
	content: string;
	title?: string;
	pageTitle?: string;
	url?: string;
	collectedAt?: string;
}

interface ConversationRound {
	round: number;
	user: string;
	ai: string;
	hash: string;
	raw: string;
}

interface RoundDocMeta {
	contentType: string;
	title: string;
	markdown: string;
}

interface AIPromptCollectorSettings {
	baseFolder: string;
	openAfterSave: boolean;

	apiBaseUrl: string;
	apiKey: string;
	model: string;
	temperature: number;

	processPrompt: string;
}

interface TaskResultItem {
	round: number;
	contentType: string;
	title: string;
	filePath: string;
	action: "created" | "appended" | "skipped";
}

interface TaskState {
	status: string;
	step: string;
	detail: string;
	error: string;
	logs: string[];
	results: TaskResultItem[];
}

const DEFAULT_PROCESS_PROMPT = `请对我提供的「AI对话原文」执行以下两步处理，最终输出可直接复制归档到Obsidian的标准知识库Markdown文档，严格遵循所有要求，不新增无关内容、不遗漏任何干货，不添加任何多余套话。

第一步：必做分类（唯一选择）
1. 通读全部对话，判断核心内容所属类型，仅能从以下5类中选择1个，不可多选、不可自定义：
若以上类型均不匹配，统一标注：其他类型（简要说明：XXX）（XXX填写核心内容属性，极简）
- 技术类（含开发、运维、代码、命令、配置、技术原理等）
- 职场类（含工作方法、流程、沟通技巧、职场经验等）
- 学习类（含知识点、考点、学习方法、笔记整理等）
- 实操类（含具体步骤、操作指南、流程拆解等）
- 理论类（含概念、原理、逻辑、观点论证等）

2. 分类完成后，在Markdown文档开头明确标注：内容类型：XXX（XXX为选择的类型，其他类型需补充简要说明）

第二步：必做框架整理（匹配分类）
根据第一步确定的类型，选择对应标准框架，从对话中提取所有干货（知识点、结论、步骤、代码、命令、配置、要点等），彻底删除闲聊、客套、重复、无关话术，严格遵循以下输出要求：

1. 内容边界：仅基于对话原文，不新增、不扩展任何原文未提及的信息，不遗漏任何干货（含代码、命令、配置、关键步骤、核心结论、表格、模板、字段、清单）；
2. 格式要求：严格匹配对应类型框架，标题层级清晰（#/## 规范使用），分点（有序/无序）规范，可直接复制到Obsidian归档，无需二次调整；
3. 语言要求：极简、干练、可检索、可复习，无冗余表述，核心信息突出；
4. 标题要求：文档主题需自动提炼，精准贴合对话核心，不冗余、不模糊；
5. 输出规范：不添加“以下是整理结果”“我来帮你整理”等任何套话，最终仅输出纯Markdown正文，不包裹任何代码块。

各类型标准知识框架（必严格遵循，不可修改框架结构）

一、技术类框架（适配开发、运维、代码等）
# 主题：【自动提炼对话核心标题，精准不冗余】
## 内容类型：技术类
## 1. 适用场景
说明该技术/代码/命令的适用场景、解决的核心问题
## 2. 核心原理（极简）
一句话概括核心逻辑，不展开多余解释
## 3. 关键干货（代码/命令/配置）
- 代码块（单独用代码格式）
- 核心命令/配置项（分点，清晰可复制）
## 4. 实操步骤（若有）
1. 步骤1（简洁明了，不废话）
2. 步骤2（重点标注易错步骤）
## 5. 易错点/排错技巧
- 易错点1：说明问题及规避方法
- 易错点2：说明问题及解决思路
## 6. 个人精简总结（2-3句）
用直白的话重述核心，方便快速回忆归档

二、职场类框架（适配工作方法、流程等）
# 主题：【自动提炼对话核心标题】
## 内容类型：职场类
## 1. 核心场景/需求
说明该内容适用的职场场景、解决的工作问题
## 2. 核心结论/方法
- 核心要点1（精准提炼，不冗余）
- 核心要点2
- 核心要点3
## 3. 实操流程（若有）
1. 流程步骤1
2. 流程步骤2（标注关键节点）
## 4. 注意事项/避坑点
- 注意点1：职场使用中的细节
- 注意点2：容易忽略的问题
## 5. 个人精简总结（2-3句）
浓缩核心，适配职场快速查阅、复用

三、学习类框架（适配知识点、学习方法等）
# 主题：【自动提炼对话核心标题】
## 内容类型：学习类
## 1. 核心知识点/学习目标
明确该内容的核心知识点、要掌握的关键目标
## 2. 核心要点（分点提炼）
- 要点1（精准，不重复）
- 要点2（标注重点/考点）
- 要点3
## 3. 易错点/易混淆点
- 易错点1：说明错误原因及正确结论
- 易混淆点：区分相似知识点
## 4. 学习技巧/记忆方法（若有）
简单说明高效掌握、记忆的方法
## 5. 个人精简总结（2-3句）
浓缩核心知识点，方便复习、快速回顾

四、实操类框架（适配步骤、操作指南等）
# 主题：【自动提炼对话核心标题】
## 内容类型：实操类
## 1. 实操目标
明确本次操作要达成的结果、目的
## 2. 前置准备（若有）
- 所需工具/材料
- 前置条件（需完成的准备工作）
## 3. 详细操作步骤（核心）
1. 步骤1：具体操作，明确每一步做什么、怎么做
2. 步骤2：标注关键细节、操作规范
3. 步骤3：若有可选步骤，标注“可选”及适用场景
## 4. 常见问题/异常处理
- 问题1：异常现象 + 解决方法
- 问题2：异常现象 + 解决方法
## 5. 个人精简总结（2-3句）
浓缩操作核心，方便后续快速复用、参考

五、理论类框架（适配概念、原理、观点等）
# 主题：【自动提炼对话核心标题】
## 内容类型：理论类
## 1. 核心概念/观点
一句话明确核心理论、观点，不展开多余解释
## 2. 核心要点（分点拆解）
- 要点1：理论核心细节
- 要点2：逻辑推导 / 观点支撑
- 要点3：适用范围 / 局限性
## 3. 关键补充（若有）
补充相关延伸、与其他理论的区别（极简）
## 4. 个人精简总结（2-3句）
用直白的话重述理论核心，方便理解、归档

六、其他类型框架（适配以上均不匹配的内容）
# 主题：【自动提炼对话核心标题】
## 内容类型：其他类型（简要说明：XXX）
## 1. 核心内容提炼
- 要点1
- 要点2
- 要点3（提取所有干货，不遗漏）
## 2. 关键补充（若有）
补充必要的背景、适用场景
## 3. 个人精简总结（2-3句）
浓缩核心，方便归档、查阅

核心禁忌（必严格遵守）
- 禁止新增原文未提及的任何信息、拓展内容；
- 禁止遗漏对话中的代码、命令、配置、关键步骤、核心结论；
- 禁止遗漏表格、模板、字段、栏目、清单、结构化项目；
- 如果原对话中包含表格、模板、巡检项、字段清单、报告模板、检查项矩阵、信息登记表，必须优先保留为 Markdown 表格，不得擅自改写成纯文字段落；
- 如果原文中的信息天然适合表格表达（如：项目 / 状态 / 说明 / 结果 / 时间 / 负责人 / 巡检项 / 风险项 / 建议），优先整理为 Markdown 表格；
- 若原文本身已经是模板、表格、清单格式，输出时必须尽量保持原结构，不得因为“总结”而丢失字段、列、行；
- 对于“报告模板”“表单模板”“巡检模板”“字段模板”“清单模板”等场景，最终输出必须优先保留模板结构，能用表格就用表格，能用清单就用清单，不可只写成概括性说明；
- 如果存在代码块、命令块、配置块、表格块，必须原样保留其结构化形式，不得改写成解释性文字；
- 禁止保留闲聊、客套、重复解释等无关话术；
- 禁止修改框架结构、标题层级，禁止添加任何套话；
- 禁止将最终Markdown正文包裹在代码块中，需直接输出可复制的纯正文。`;

const DEFAULT_SETTINGS: AIPromptCollectorSettings = {
	baseFolder: "Knowledge Base",
	openAfterSave: true,

	apiBaseUrl: "https://api.openai.com/v1",
	apiKey: "",
	model: "gpt-4o-mini",
	temperature: 0.1,

	processPrompt: DEFAULT_PROCESS_PROMPT
};

function normalizeText(text: string): string {
	return String(text ?? "")
		.replace(/\r\n/g, "\n")
		.replace(/\u00A0/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function yamlString(value: string): string {
	return JSON.stringify(value ?? "");
}

function getFirstParam(value: ProtocolValue): string {
	if (Array.isArray(value)) return value[0] ?? "";
	return value ?? "";
}

function decodeParam(value: ProtocolValue): string {
	const raw = getFirstParam(value);
	if (!raw) return "";
	try {
		return decodeURIComponent(raw.replace(/\+/g, "%20"));
	} catch {
		return raw;
	}
}

function simpleHash(text: string): string {
	let hash = 0;
	const input = normalizeText(text);
	for (let i = 0; i < input.length; i++) {
		hash = (hash << 5) - hash + input.charCodeAt(i);
		hash |= 0;
	}
	return String(hash >>> 0);
}

class TaskStore {
	private state: TaskState = {
		status: "idle",
		step: "",
		detail: "",
		error: "",
		logs: [],
		results: []
	};

	private listeners = new Set<() => void>();

	getState(): TaskState {
		return this.state;
	}

	reset() {
		this.state = {
			status: "idle",
			step: "",
			detail: "",
			error: "",
			logs: [],
			results: []
		};
		this.emit();
	}

	setStatus(status: string, step = "", detail = "") {
		this.state.status = status;
		this.state.step = step;
		this.state.detail = detail;
		this.emit();
	}

	setError(error: string) {
		this.state.error = error;
		this.log(`❌ ${error}`);
		this.emit();
	}

	log(message: string) {
		this.state.logs.push(message);
		this.emit();
	}

	addResult(item: TaskResultItem) {
		this.state.results.push(item);
		this.emit();
	}

	subscribe(fn: () => void) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit() {
		for (const fn of this.listeners) fn();
	}
}

class AITaskCenterView extends ItemView {
	plugin: AIPromptCollectorPlugin;
	unsubscribe: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: AIPromptCollectorPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AI_TASK_CENTER;
	}

	getDisplayText(): string {
		return "AI 任务中心";
	}

	getIcon(): string {
		return "blocks";
	}

	async onOpen() {
		this.unsubscribe = this.plugin.taskStore.subscribe(() => this.render());
		this.render();
	}

	async onClose() {
		this.unsubscribe?.();
	}

	render() {
		const { contentEl } = this;
		contentEl.empty();

		const state = this.plugin.taskStore.getState();

		contentEl.createEl("h2", { text: "AI 任务中心" });

		const info = contentEl.createDiv();
		info.style.padding = "12px";
		info.style.border = "1px solid var(--background-modifier-border)";
		info.style.borderRadius = "8px";
		info.style.marginBottom = "12px";

		info.createEl("div", { text: `状态：${state.status || "-"}` });
		info.createEl("div", { text: `阶段：${state.step || "-"}` });
		info.createEl("div", { text: `说明：${state.detail || "-"}` });

		if (state.error) {
			const err = info.createEl("div", { text: `错误：${state.error}` });
			err.style.color = "var(--text-error)";
			err.style.marginTop = "8px";
		}

		const btnRow = contentEl.createDiv();
		btnRow.style.display = "flex";
		btnRow.style.gap = "8px";
		btnRow.style.marginBottom = "12px";

		const clearBtn = btnRow.createEl("button", { text: "清空日志" });
		clearBtn.onclick = () => {
			this.plugin.taskStore.reset();
		};

		contentEl.createEl("h3", { text: "日志" });

		const logsBox = contentEl.createDiv();
		logsBox.style.whiteSpace = "pre-wrap";
		logsBox.style.fontFamily = "var(--font-monospace)";
		logsBox.style.fontSize = "12px";
		logsBox.style.padding = "10px";
		logsBox.style.border = "1px solid var(--background-modifier-border)";
		logsBox.style.borderRadius = "8px";
		logsBox.style.maxHeight = "220px";
		logsBox.style.overflowY = "auto";
		logsBox.style.marginBottom = "12px";
		logsBox.setText(state.logs.join("\n") || "暂无日志");

		contentEl.createEl("h3", { text: "结果" });

		const resultWrap = contentEl.createDiv();
		resultWrap.style.display = "flex";
		resultWrap.style.flexDirection = "column";
		resultWrap.style.gap = "8px";

		if (state.results.length === 0) {
			resultWrap.createEl("div", { text: "暂无结果" });
		} else {
			for (const item of state.results) {
				const row = resultWrap.createDiv();
				row.style.padding = "10px";
				row.style.border = "1px solid var(--background-modifier-border)";
				row.style.borderRadius = "8px";

				row.createEl("div", {
					text: `回合 ${item.round} | ${item.contentType} | ${item.title}`
				});
				row.createEl("div", { text: `动作：${item.action}` });
				row.createEl("div", { text: `文件：${item.filePath}` });
			}
		}
	}
}

export default class AIPromptCollectorPlugin extends Plugin {
	settings!: AIPromptCollectorSettings;
	taskStore = new TaskStore();

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_AI_TASK_CENTER,
			(leaf) => new AITaskCenterView(leaf, this)
		);

		this.addRibbonIcon("archive", "收集并整理 AI 对话", async () => {
			await this.collectFromClipboard({ source: "clipboard" });
		});

		this.addRibbonIcon("blocks", "打开 AI 任务中心", async () => {
			await this.activateTaskCenter();
		});

		this.addCommand({
			id: "collect-and-organize-ai-conversation",
			name: "收集并整理 AI 对话",
			callback: async () => {
				await this.collectFromClipboard({ source: "clipboard" });
			}
		});

		this.addCommand({
			id: "open-ai-task-center",
			name: "打开 AI 任务中心",
			callback: async () => {
				await this.activateTaskCenter();
			}
		});

		this.registerObsidianProtocolHandler(
			"ai-prompt-collector",
			async (params) => {
				await this.handleProtocol(params as Record<string, ProtocolValue>);
			}
		);

		this.addSettingTab(new AIPromptCollectorSettingTab(this.app, this));
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_AI_TASK_CENTER);
	}

	async activateTaskCenter(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_TASK_CENTER)[0];

		if (!leaf) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (!rightLeaf) {
				new Notice("无法创建 AI 任务中心");
				return;
			}
			leaf = rightLeaf;
			await leaf.setViewState({
				type: VIEW_TYPE_AI_TASK_CENTER,
				active: true
			});
		}

		await this.app.workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		const loaded = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private readClipboardText(): string {
		try {
			const { clipboard } = require("electron");
			return String(clipboard.readText() ?? "");
		} catch (error) {
			console.error(error);
			return "";
		}
	}

	async collectFromClipboard(meta: Partial<PromptPayload> = {}) {
		const text = normalizeText(this.readClipboardText());

		if (!text) {
			new Notice("剪贴板为空，未读取到内容");
			return;
		}

		await this.processConversation({
			source: meta.source ?? "clipboard",
			title: meta.title,
			pageTitle: meta.pageTitle,
			url: meta.url,
			collectedAt: meta.collectedAt,
			content: text
		});
	}

	async handleProtocol(params: Record<string, ProtocolValue>) {
		const mode = (decodeParam(params.mode) || "clipboard").toLowerCase();
		const source = decodeParam(params.source) || "browser";
		const title = decodeParam(params.title) || "";
		const pageTitle =
			decodeParam(params.page_title) ||
			decodeParam(params.pageTitle) ||
			"";
		const url =
			decodeParam(params.page_url) ||
			decodeParam(params.url) ||
			decodeParam(params.page) ||
			"";

		if (mode === "clipboard") {
			await this.collectFromClipboard({
				source,
				title,
				pageTitle,
				url
			});
			return;
		}

		const content = normalizeText(decodeParam(params.content));
		if (!content) {
			new Notice("协议中没有携带内容");
			return;
		}

		await this.processConversation({
			source,
			title,
			pageTitle,
			url,
			content
		});
	}

	async processConversation(payload: PromptPayload) {
		await this.activateTaskCenter();
		this.taskStore.reset();

		try {
			this.taskStore.setStatus("running", "解析回合", "正在解析浏览器传来的内容");
			this.taskStore.log("开始处理新的 AI 对话");

			const rounds = this.parseRounds(payload.content);
			this.taskStore.log(`识别到回合数：${rounds.length}`);

			if (rounds.length === 0) {
				throw new Error("未识别到有效回合");
			}

			for (const round of rounds) {
				this.taskStore.setStatus(
					"running",
					`处理回合 ${round.round}`,
					`正在调用模型生成回合 ${round.round} 的文章`
				);
				this.taskStore.log(`处理回合 ${round.round}`);

				let meta: RoundDocMeta;
				try {
					meta = await this.generateSingleRoundDoc(round);
					this.taskStore.log(
						`回合 ${round.round} 生成完成：${meta.contentType} / ${meta.title}`
					);
				} catch (error) {
					console.error(error);
					meta = {
						contentType: "其他类型",
						title: this.fallbackTitle(round.user || round.ai || `回合 ${round.round}`),
						markdown: this.buildFallbackMarkdown(round)
					};
					this.taskStore.log(
						`回合 ${round.round} 模型生成失败，使用兜底文档：${meta.contentType} / ${meta.title}`
					);
				}

				const folder = normalizePath(`${this.settings.baseFolder}/${meta.contentType}`);
				await this.ensureFolder(folder);

				const filePath = normalizePath(
					`${folder}/${this.safeFileName(meta.title)}.md`
				);

				const existing = this.app.vault.getAbstractFileByPath(filePath);
				let targetFile: TFile;
				let action: "created" | "appended" | "skipped";

				if (existing instanceof TFile) {
					targetFile = existing;
					action = await this.appendGeneratedDocToFile(targetFile, round, meta);
				} else {
					targetFile = await this.createGeneratedDocFile(filePath, round, meta);
					action = "created";
				}

				this.taskStore.addResult({
					round: round.round,
					contentType: meta.contentType,
					title: meta.title,
					filePath: targetFile.path,
					action
				});

				this.taskStore.log(
					`回合 ${round.round} 已完成：${action} -> ${targetFile.path}`
				);
			}

			this.taskStore.setStatus("done", "完成", "所有回合处理完毕");
			new Notice("AI 对话处理完成");
		} catch (error) {
			console.error(error);
			const msg = error instanceof Error ? error.message : String(error);
			this.taskStore.setStatus("error", "失败", msg);
			this.taskStore.setError(msg);
			new Notice("AI 对话处理失败，请打开任务中心查看");
		}
	}

	parseRounds(content: string): ConversationRound[] {
		const text = normalizeText(content);
		const sections = text.split(/\n(?=###\s*第?\d+回合)/g).filter(Boolean);
		const rounds: ConversationRound[] = [];

		if (sections.length > 0 && sections.some((s) => /##\s*用户/.test(s))) {
			for (let i = 0; i < sections.length; i++) {
				const sec = sections[i];
				const userMatch = sec.match(/##\s*用户\s*\n([\s\S]*?)(?=\n##\s*AI|\s*$)/);
				const aiMatch = sec.match(/##\s*AI\s*\n([\s\S]*?)$/);

				const user = normalizeText(userMatch?.[1] || "");
				const ai = normalizeText(aiMatch?.[1] || "");
				const raw = normalizeText(sec);

				if (!user && !ai) continue;

				rounds.push({
					round: i + 1,
					user,
					ai,
					raw,
					hash: simpleHash(`${user}\n---\n${ai}`)
				});
			}
			return rounds;
		}

		const regex =
			/##\s*用户\s*\n([\s\S]*?)(?=\n##\s*AI)\n##\s*AI\s*\n([\s\S]*?)(?=\n##\s*用户|\s*$)/g;
		let match: RegExpExecArray | null;
		let idx = 1;
		while ((match = regex.exec(text)) !== null) {
			const user = normalizeText(match[1] || "");
			const ai = normalizeText(match[2] || "");
			const raw = `## 用户\n${user}\n\n## AI\n${ai}`;
			rounds.push({
				round: idx++,
				user,
				ai,
				raw,
				hash: simpleHash(`${user}\n---\n${ai}`)
			});
		}

		if (rounds.length > 0) return rounds;

		return [
			{
				round: 1,
				user: text,
				ai: "",
				raw: text,
				hash: simpleHash(text)
			}
		];
	}

	async generateSingleRoundDoc(round: ConversationRound): Promise<RoundDocMeta> {
		const apiBaseUrl = this.settings.apiBaseUrl.trim().replace(/\/+$/, "");
		const apiKey = this.settings.apiKey.trim();
		const model = this.settings.model.trim();

		if (!apiBaseUrl || !apiKey || !model) {
			throw new Error("请先填写 API Base URL / API Key / Model");
		}

		const endpoint = `${apiBaseUrl}/chat/completions`;

		const response = await requestUrl({
			url: endpoint,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model,
				temperature: this.settings.temperature,
				stream: false,
				messages: [
					{
						role: "system",
						content: this.settings.processPrompt
					},
					{
						role: "user",
						content: round.raw
					}
				]
			})
		});

		const data = response.json as any;
		const markdown = this.extractAssistantContent(data);
		if (!markdown) {
			throw new Error("模型返回为空");
		}

		return this.parseGeneratedMarkdown(markdown, round);
	}

	extractAssistantContent(data: any): string {
		const content = data?.choices?.[0]?.message?.content;

		if (typeof content === "string") return content.trim();

		if (Array.isArray(content)) {
			return content
				.map((item: any) => {
					if (typeof item === "string") return item;
					if (item?.type === "text" && typeof item?.text === "string") return item.text;
					return "";
				})
				.join("")
				.trim();
		}

		return "";
	}

	parseGeneratedMarkdown(markdown: string, round: ConversationRound): RoundDocMeta {
		const clean = normalizeText(markdown);

		const titleMatch =
			clean.match(/^#\s*主题[：:]\s*(.+)$/m) ||
			clean.match(/^#\s+(.+)$/m);

		const typeMatch =
			clean.match(/^##\s*内容类型[：:]\s*(.+)$/m) ||
			clean.match(/^内容类型[：:]\s*(.+)$/m);

		const rawTitle = titleMatch?.[1]?.trim() || this.fallbackTitle(round.user || round.ai);
		const rawType = typeMatch?.[1]?.trim() || "其他类型";

		return {
			contentType: this.normalizeType(rawType),
			title: this.safeTopicTitle(rawTitle),
			markdown: clean
		};
	}

	buildFallbackMarkdown(round: ConversationRound): string {
		const title = this.fallbackTitle(round.user || round.ai || `回合 ${round.round}`);
		return `# 主题：${title}
## 内容类型：其他类型

## 1. 核心内容提炼
- 用户提问：${round.user || "（空）"}
- AI回复：${round.ai || "（空）"}

## 2. 关键补充（若有）
- 该内容由兜底逻辑生成，模型整理失败

## 3. 个人精简总结（2-3句）
本回合内容已保存，但未成功走完整的模型结构化整理流程。`;
	}

	normalizeType(type: string): string {
		const value = normalizeText(type);
		if (value.includes("技术")) return "技术类";
		if (value.includes("职场")) return "职场类";
		if (value.includes("学习")) return "学习类";
		if (value.includes("实操")) return "实操类";
		if (value.includes("理论")) return "理论类";
		return "其他类型";
	}

	fallbackTitle(text: string): string {
		const line = normalizeText(text).split("\n").find((l) => l.trim());
		if (!line) return "未命名主题";
		return this.safeTopicTitle(line.slice(0, 24));
	}

	safeTopicTitle(title: string): string {
		const clean = normalizeText(title)
			.replace(/[【】]/g, "")
			.replace(/^#+\s*/, "")
			.trim();
		return clean || "未命名主题";
	}

	async createGeneratedDocFile(
		filePath: string,
		round: ConversationRound,
		meta: RoundDocMeta
	): Promise<TFile> {
		const content = `${meta.markdown}

---

<!-- round-hash: ${round.hash} -->
`;
		return await this.app.vault.create(filePath, content);
	}

	async appendGeneratedDocToFile(
		file: TFile,
		round: ConversationRound,
		meta: RoundDocMeta
	): Promise<"appended" | "skipped"> {
		const original = await this.app.vault.read(file);

		if (original.includes(`<!-- round-hash: ${round.hash} -->`)) {
			return "skipped";
		}

		const next = `${original.trimEnd()}

---

## 附加回合 ${round.round}
<!-- round-hash: ${round.hash} -->

### 用户
${round.user || "（空）"}

### AI
${round.ai || "（空）"}
`;
		await this.app.vault.modify(file, next);
		return "appended";
	}

	async ensureFolder(folderPath: string) {
		const normalized = normalizePath(folderPath);
		const parts = normalized.split("/").filter(Boolean);

		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	safeFileName(name: string): string {
		return name
			.replace(/[\\/:*?"<>|]/g, " ")
			.replace(/\s+/g, " ")
			.replace(/\.+$/g, "")
			.trim();
	}
}

class AIPromptCollectorSettingTab extends PluginSettingTab {
	plugin: AIPromptCollectorPlugin;

	constructor(app: App, plugin: AIPromptCollectorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "AI Prompt Collector" });

		new Setting(containerEl)
			.setName("知识库根目录")
			.addText((text) =>
				text
					.setPlaceholder("Knowledge Base")
					.setValue(this.plugin.settings.baseFolder)
					.onChange(async (value) => {
						this.plugin.settings.baseFolder = value.trim() || "Knowledge Base";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("保存后自动打开")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openAfterSave)
					.onChange(async (value) => {
						this.plugin.settings.openAfterSave = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "模型接口设置" });

		new Setting(containerEl)
			.setName("API Base URL")
			.addText((text) =>
				text
					.setPlaceholder("https://api.openai.com/v1")
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Key")
			.addText((text) => {
				text
					.setPlaceholder("sk-...")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("Model")
			.addText((text) =>
				text
					.setPlaceholder("gpt-4o-mini")
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Temperature")
			.addText((text) =>
				text
					.setPlaceholder("0.1")
					.setValue(String(this.plugin.settings.temperature))
					.onChange(async (value) => {
						const num = Number(value);
						this.plugin.settings.temperature = Number.isFinite(num) ? num : 0.1;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "文章整理 Prompt" });

		new Setting(containerEl)
			.setName("完整整理 Prompt")
			.addTextArea((text) => {
				text
					.setValue(this.plugin.settings.processPrompt)
					.onChange(async (value) => {
						this.plugin.settings.processPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 18;
				text.inputEl.style.width = "100%";
				text.inputEl.style.fontFamily = "var(--font-monospace)";
			});
	}
}