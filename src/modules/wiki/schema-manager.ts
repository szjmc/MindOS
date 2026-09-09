import { App, normalizePath, TFile } from "obsidian";
import {
  DIR_SCHEMA,
  DIR_SCHEMA_TEMPLATES,
  DIR_SCHEMA_WORKFLOWS,
  FILE_CLAUDE,
  FILE_CONVENTIONS,
  PLUGIN_NAME,
} from "../../core/constants";

export class SchemaManager {
  constructor(private app: App, private getBaseFolder: () => string) {}

  private path(relative: string): string {
    return normalizePath(`${this.getBaseFolder()}/${relative}`);
  }

  async initialize(): Promise<void> {
    await this.ensureFolder(this.path(DIR_SCHEMA));
    await this.ensureFolder(this.path(DIR_SCHEMA_TEMPLATES));
    await this.ensureFolder(this.path(DIR_SCHEMA_WORKFLOWS));

    await this.ensureFile(this.path(FILE_CLAUDE), CLAUDE_MD_TEMPLATE);
    await this.ensureFile(this.path(FILE_CONVENTIONS), CONVENTIONS_MD);

    await this.ensureFile(this.path(`${DIR_SCHEMA_TEMPLATES}/entity.md`), TEMPLATE_ENTITY);
    await this.ensureFile(this.path(`${DIR_SCHEMA_TEMPLATES}/concept.md`), TEMPLATE_CONCEPT);
    await this.ensureFile(this.path(`${DIR_SCHEMA_TEMPLATES}/topic.md`), TEMPLATE_TOPIC);
    await this.ensureFile(this.path(`${DIR_SCHEMA_TEMPLATES}/comparison.md`), TEMPLATE_COMPARISON);
    await this.ensureFile(this.path(`${DIR_SCHEMA_TEMPLATES}/overview.md`), TEMPLATE_OVERVIEW);

    await this.ensureFile(this.path(`${DIR_SCHEMA_WORKFLOWS}/ingest.md`), WORKFLOW_INGEST);
    await this.ensureFile(this.path(`${DIR_SCHEMA_WORKFLOWS}/update.md`), WORKFLOW_UPDATE);
    await this.ensureFile(this.path(`${DIR_SCHEMA_WORKFLOWS}/crosslink.md`), WORKFLOW_CROSSLINK);
  }

  async readClaudeMd(): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(this.path(FILE_CLAUDE));
    if (f instanceof TFile) return await this.app.vault.read(f);
    return "";
  }

  async readConventions(): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(this.path(FILE_CONVENTIONS));
    if (f instanceof TFile) return await this.app.vault.read(f);
    return "";
  }

  async getStatus(): Promise<{ claudeLoaded: boolean; claudeLines: number; templates: number }> {
    const claude = await this.readClaudeMd();
    const folder = this.app.vault.getAbstractFileByPath(this.path(DIR_SCHEMA_TEMPLATES));
    let templates = 0;
    if (folder && "children" in folder) {
      templates = (folder as any).children?.filter((c: any) => c.name?.endsWith(".md")).length ?? 0;
    }
    return {
      claudeLoaded: claude.length > 0,
      claudeLines: claude.split("\n").length,
      templates,
    };
  }

  private async ensureFolder(p: string) {
    // 用 adapter.exists 直查文件系统，不依赖 Obsidian 内存索引
    // 避免启动时索引未就绪导致 "Folder already exists" 崩溃
    if (await this.app.vault.adapter.exists(p)) return;
    const parts = p.split("/").filter(Boolean);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(cur))) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (e: any) {
          // 并发竞态：文件夹在 check 和 create 之间被其他进程（如 git）创建
          if (!e?.message?.includes?.("already exists")) throw e;
        }
      }
    }
  }

  private async ensureFile(p: string, defaultContent: string) {
    if (!(await this.app.vault.adapter.exists(p))) {
      try {
        await this.app.vault.create(p, defaultContent);
      } catch (e: any) {
        if (!e?.message?.includes?.("already exists")) throw e;
      }
    }
  }
}

const CLAUDE_MD_TEMPLATE = `# CLAUDE.md - ${PLUGIN_NAME} 工作说明书

> 这是你（LLM）维护本 Wiki 的工作规则。每次操作前必须先读本文件。
> 本文件由人类编写和修改，你不能修改它。

## 1. 你的角色

你是 ${PLUGIN_NAME} 的知识维护者。

**人类负责（你不要做）：**
- 把素材丢进 raw/
- 修改 schema/ 中的规则
- 做最终判断和决策

**你负责（人类不直接做）：**
- 读取 raw/ 中的素材
- 在 wiki/ 中创建、更新、维护页面
- 建立交叉引用，保持一致性
- 标注冲突、不确定性

## 2. 输出协议

你的所有输出必须是严格 JSON 格式，详见各阶段提示词。

## 3. 决策原则

- 收到新素材时，**先看 INDEX.md**，判断是否已有相关页面
- 已有 → 用 \`update\` 或 \`append_section\`
- 没有 → 用 \`create\`，并指定合适的 pageType
- 涉及多个已有页面的关系 → 用 \`link\` 建立链接

## 4. 页面类型选择

- **entity（实体）**：人物、公司、产品、技术栈、工具
- **concept（概念）**：思想、方法、术语、定义
- **topic（主题）**：跨多个对话的综合知识
- **comparison（对比）**：A vs B 的对照
- **overview（概述）**：顶层鸟瞰、领域全景

## 5. 不可逾越的边界

- ❌ 禁止修改 raw/ 中的任何文件
- ❌ 禁止删除 wiki/ 中已有的人类批注（标记为 \`> 👤\` 的引用块）
- ❌ 禁止臆测，不确定的内容必须标注 \`> ⚠️ 不确定：...\`
- ❌ 禁止生成空内容
- ❌ 禁止在 brief 中超过 30 字

## 6. 一致性原则

- 同一概念在多处出现，术语必须一致
- 引用其他页面时使用 \`[[页面标题]]\`
- 发现已有页面与新素材矛盾时，标注 \`> ⚠️ 与 [[xxx]] 中的描述存在冲突\`

## 7. 命名规范

详见 [[conventions]]。

## 8. 关于我（用户自定义）

> 在这里描述你自己，让 AI 更懂你的风格和需求

例如：
- 我是一名 Linux 运维工程师
- 主要关注 K8s、Docker、Python 自动化
- 笔记风格偏好：简洁、可执行、表格优先
`;

const CONVENTIONS_MD = `# 命名与链接规范

## 文件命名

- **实体页**：使用原名（如 \`Linux.md\`、\`Kubernetes.md\`）
- **概念页**：中文为主（如 \`文件权限.md\`、\`进程管理.md\`）
- **主题页**：用领域名（如 \`Linux 系统管理.md\`）
- **对比页**：用 \`A-vs-B\` 格式（如 \`chmod-vs-chown.md\`）
- **概述页**：用 \`xxx 全景\` 格式（如 \`运维知识全景.md\`）

## 链接规则

- 概念第一次出现必须用 \`[[]]\` 链接
- 同一文档中重复出现可不再链接
- 链接目标不存在时不要创建空链接

## brief 写作规范

- 严格 ≤ 30 字
- 一句话讲清楚"这是什么"
- 不用句号结尾
- 示例：
  - ✅ "Linux 中控制读写执行访问的机制"
  - ❌ "这是 Linux 系统中的一个非常重要的关于权限管理的机制，主要用于..."（太长）
`;

const TEMPLATE_ENTITY = `# {{title}}

## 简介
{{brief}}

## 关键信息
- 

## 相关命令/操作
- 

## 实战记录
- 

## 关联
- 
`;

const TEMPLATE_CONCEPT = `# {{title}}

> {{brief}}

## 定义
{{definition}}

## 关键要点
- 

## 示例
- 

## 关联概念
- 
`;

const TEMPLATE_TOPIC = `# {{title}}

> {{brief}}

## 核心要点
- 

## 涉及实体
- 

## 涉及概念
- 

## 实战经验
- 
`;

const TEMPLATE_COMPARISON = `# {{title}}

> {{brief}}

## 对比表

| 维度 | A | B |
|------|---|---|
|      |   |   |

## 选择建议
- 
`;

const TEMPLATE_OVERVIEW = `# {{title}}

> {{brief}}

## 领域全景

## 核心实体
- 

## 核心概念
- 

## 主题脉络
- 
`;

const WORKFLOW_INGEST = `# 工作流：处理新素材（ingest）

1. 读取 raw/ 中的新素材
2. 读取 wiki/INDEX.md，了解已有页面
3. 识别素材中的关键实体和概念
4. 对每个识别项：
   - 已有同名页面 → 准备 update action
   - 没有 → 准备 create action
5. 输出 actions 数组
`;

const WORKFLOW_UPDATE = `# 工作流：更新已有页面

- 不要覆盖整个页面，只追加新信息
- 使用 append_section 操作指定小节
- 如果新信息与已有内容冲突，标注 ⚠️
`;

const WORKFLOW_CROSSLINK = `# 工作流：建立交叉引用

- 创建/更新页面时，主动检查是否应链接到 INDEX.md 中的其他页面
- 在 links 字段中列出所有相关链接
`;