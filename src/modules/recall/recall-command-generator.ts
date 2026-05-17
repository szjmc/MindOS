import { App, TFile } from "obsidian";
import {
  RecallCard,
  RecallScenario,
  MindOSSettings,
} from "../../core/types";
import { IndexManager } from "../wiki/index-manager";
import { parseFrontmatter, generateUID, nowISOString, sleep } from "../../core/utils";
import { SRSEngine } from "./srs-engine";
import { RecallCardStore } from "./recall-card-store";
import { AICardGenerator } from "./ai-card-generator";

export interface CommandCardMeta {
  shell: string;          // bash / zsh / powershell / cmd
  category: string;       // linux / git / docker / k8s / npm 等
  difficulty: "basic" | "intermediate" | "advanced";
  sourcePath?: string;
  sourceCodeBlock?: string;  // 来源的代码块原文
}

export interface GenerateCommandsOptions {
  source: "wiki" | "builtin" | "both";
  maxCardsPerPage?: number;
  onlyNewPages?: boolean;
}

export interface CommandGenerateProgress {
  total: number;
  done: number;
  currentFile: string;
  newCards: number;
  errors: string[];
}

/**
 * 命令行卡片生成器
 *
 * 数据源：
 *  1. Wiki 中的 bash/shell/powershell 代码块
 *  2. 内置命令库（Linux/Git/Docker 基础常用命令）
 */
export class RecallCommandGenerator {
  private srsEngine: SRSEngine;

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private indexManager: IndexManager,
    private cardStore: RecallCardStore,
    private aiGenerator: AICardGenerator,
    private logger: (msg: string) => void,
  ) {
    this.srsEngine = new SRSEngine("sm2");
  }

  // ════════════════════════════════════════════════════════════
  // 主入口
  // ════════════════════════════════════════════════════════════
  async generate(
    opts: GenerateCommandsOptions,
    onProgress?: (p: CommandGenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    const progress: CommandGenerateProgress = {
      total: 0,
      done: 0,
      currentFile: "",
      newCards: 0,
      errors: [],
    };

    // 1. 内置命令库
    if (opts.source === "builtin" || opts.source === "both") {
      this.logger("ℹ️ 加载内置命令库");
      const builtinCards = this.generateFromBuiltin();
      await this.cardStore.saveCards(builtinCards);
      progress.newCards += builtinCards.length;
      this.logger(`✅ 内置命令库：${builtinCards.length} 张卡片`);
    }

    // 2. Wiki 扫描
    if (opts.source === "wiki" || opts.source === "both") {
      const wikiResult = await this.generateFromWiki(opts, progress, onProgress);
      progress.newCards += wikiResult.newCards;
      progress.errors.push(...wikiResult.errors);
    }

    this.cardStore.invalidateCache("command");
    return { newCards: progress.newCards, errors: progress.errors };
  }

  // ════════════════════════════════════════════════════════════
  // 内置命令库生成
  // ════════════════════════════════════════════════════════════
  private generateFromBuiltin(): RecallCard[] {
    const cards: RecallCard[] = [];

    for (const def of BUILTIN_COMMAND_LIBRARY) {
      const meta: CommandCardMeta = {
        shell: def.shell,
        category: def.category,
        difficulty: def.difficulty,
      };

      cards.push(this.makeCard({
        front: def.task,
        back: def.command,
        hints: def.hints ?? [],         // ✅ 默认空数组
        examples: def.examples ?? [],   // ✅ 默认空数组
        tags: ["command", def.category, def.shell],
        metadata: meta,
        sourcePath: undefined,
        sourceSection: `内置库 / ${def.category}`,
      }));
    }

    return cards;
  }

  // ════════════════════════════════════════════════════════════
  // Wiki 扫描生成
  // ════════════════════════════════════════════════════════════
  private async generateFromWiki(
    opts: GenerateCommandsOptions,
    progress: CommandGenerateProgress,
    onProgress?: (p: CommandGenerateProgress) => void,
  ): Promise<{ newCards: number; errors: string[] }> {
    const allFiles = await this.indexManager.scanAllIndexableFiles(false);
    const candidateFiles: TFile[] = [];

    // 预扫描：找含命令代码块的文件
    for (const f of allFiles) {
      try {
        const content = await this.app.vault.read(f);
        if (this.hasCommandBlock(content)) {
          candidateFiles.push(f);
        }
      } catch {}
    }

    // 跳过已生成的页面
    if (opts.onlyNewPages) {
      const existing = await this.cardStore.getAllCards("command");
      const coveredPaths = new Set(
        existing
          .map((c) => c.sourcePath)
          .filter(Boolean),
      );
      const filtered = candidateFiles.filter((f) => !coveredPaths.has(f.path));
      candidateFiles.length = 0;
      candidateFiles.push(...filtered);
    }

    progress.total = candidateFiles.length;
    onProgress?.(progress);

    if (candidateFiles.length === 0) {
      return { newCards: 0, errors: [] };
    }

    this.logger(`ℹ️ 命令行扫描：${candidateFiles.length} 个文件含代码块`);

    let newCards = 0;
    const errors: string[] = [];
    const maxCards = opts.maxCardsPerPage ?? 5;

    for (const file of candidateFiles) {
      progress.currentFile = file.path;
      onProgress?.(progress);

      try {
        const content = await this.app.vault.read(file);
        const { frontmatter, body } = parseFrontmatter(content);
        const fileTitle = String(frontmatter.title ?? file.basename);

        const codeBlocks = this.extractCommandBlocks(body);
        if (codeBlocks.length === 0) {
          progress.done++;
          continue;
        }

        // 为该文件生成命令卡片（AI 提取）
        const cards = await this.generateCardsForFile(
          file.path,
          fileTitle,
          codeBlocks,
          maxCards,
        );

        await this.cardStore.saveCards(cards);
        newCards += cards.length;
        progress.newCards = newCards;
        this.logger(`✅ ${file.path}：生成 ${cards.length} 张命令卡片`);

        await sleep(500);  // 避免 API 限流
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${file.path}: ${msg}`);
        this.logger(`❌ ${file.path}: ${msg}`);
      }

      progress.done++;
      onProgress?.(progress);
    }

    return { newCards, errors };
  }

  // ════════════════════════════════════════════════════════════
  // 单文件 AI 生成
  // ════════════════════════════════════════════════════════════
  private async generateCardsForFile(
    path: string,
    fileTitle: string,
    codeBlocks: Array<{ shell: string; code: string }>,
    maxCards: number,
  ): Promise<RecallCard[]> {
    const blocksText = codeBlocks
      .map((b, i) => `【代码块 ${i + 1}】shell: ${b.shell}\n\`\`\`${b.shell}\n${b.code}\n\`\`\``)
      .join("\n\n");

    const systemPrompt = `你是命令行复习卡片生成专家。
你的任务：从给定的代码块中提取出独立的命令，每个命令做成一张复习卡片。

输出严格 JSON：
{
  "cards": [
    {
      "task": "用一句话描述这个命令的作用（≤30字）",
      "command": "完整命令本身",
      "explanation": "参数详解（可用 Markdown 列表）",
      "shell": "bash | zsh | powershell | cmd",
      "category": "linux | git | docker | k8s | npm | python | 其他",
      "difficulty": "basic | intermediate | advanced",
      "hints": ["提示1", "提示2"],
      "examples": ["示例命令1", "示例命令2"]
    }
  ]
}`;

    const userPrompt = `请从以下代码块中提取命令，每条命令做成一张卡片（最多 ${maxCards} 张）。

页面标题：${fileTitle}

${blocksText}

要求：
1. 每张卡正面（task）描述命令的具体任务，反面（command）是命令本身
2. explanation 必须详解每个参数的含义
3. 如果代码块包含多条相关命令，可以合并到一张卡（如完整的 git workflow）
4. 只提取真正可学习/复用的命令，跳过纯演示性的（如 echo "hello"）`;

    const result = await this.aiGenerator.generateSimple<any>(
      systemPrompt,
      userPrompt,
      0.2,
    );

    const cards: RecallCard[] = [];
    for (const item of result) {
      if (!item?.task || !item?.command) continue;

      const meta: CommandCardMeta = {
        shell: item.shell ?? "bash",
        category: item.category ?? "其他",
        difficulty: item.difficulty ?? "basic",
        sourcePath: path,
      };

      const back = item.explanation
        ? `\`\`\`${meta.shell}\n${item.command}\n\`\`\`\n\n${item.explanation}`
        : `\`\`\`${meta.shell}\n${item.command}\n\`\`\``;

      cards.push(this.makeCard({
        front: item.task,
        back,
        hints: Array.isArray(item.hints) ? item.hints : [],
        examples: Array.isArray(item.examples) ? item.examples : [],
        tags: ["command", meta.category, meta.shell],
        metadata: meta,
        sourcePath: path,
        sourceSection: fileTitle,
      }));
    }

    return cards;
  }

  // ════════════════════════════════════════════════════════════
  // 工具：提取命令代码块
  // ════════════════════════════════════════════════════════════
  private hasCommandBlock(content: string): boolean {
    return /```(?:bash|sh|shell|zsh|powershell|ps1|cmd|console|terminal)/i.test(content);
  }

  private extractCommandBlocks(content: string): Array<{ shell: string; code: string }> {
    const result: Array<{ shell: string; code: string }> = [];
    const regex = /```(bash|sh|shell|zsh|powershell|ps1|cmd|console|terminal)\n([\s\S]*?)\n```/gi;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      const shell = this.normalizeShell(m[1]);
      const code = m[2].trim();
      if (code && code.length < 2000) {  // 太长的代码块不要
        result.push({ shell, code });
      }
    }
    return result;
  }

  private normalizeShell(raw: string): string {
    const s = raw.toLowerCase();
    if (s === "sh" || s === "shell" || s === "console" || s === "terminal") return "bash";
    if (s === "ps1") return "powershell";
    return s;
  }

  // ════════════════════════════════════════════════════════════
  // 工具：构造卡片
  // ════════════════════════════════════════════════════════════
  private makeCard(opts: {
    front: string;
    back: string;
    hints: string[];
    examples: string[];
    tags: string[];
    metadata: CommandCardMeta;
    sourcePath?: string;
    sourceSection?: string;
  }): RecallCard {
    const id = `command_${generateUID()}`;
    return {
      id,
      scenario: "command" as RecallScenario,
      front: opts.front,
      back: opts.back,
      hints: opts.hints,
      examples: opts.examples,
      metadata: opts.metadata,
      sourcePath: opts.sourcePath,
      sourceSection: opts.sourceSection,
      srs: this.srsEngine.createInitialSRS(),
      stats: {
        totalReviews: 0,
        correctCount: 0,
        wrongCount: 0,
        avgResponseTimeMs: 0,
        streak: 0,
      },
      tags: Array.from(new Set(opts.tags.filter(Boolean))),
      status: "new",
      createdAt: nowISOString(),
      updatedAt: nowISOString(),
    };
  }
}

// ════════════════════════════════════════════════════════════
// 内置命令库（精选 50 条常用命令）
// ════════════════════════════════════════════════════════════
interface BuiltinCommand {
  task: string;
  command: string;
  hints?: string[];
  examples?: string[];
  shell: string;
  category: string;
  difficulty: "basic" | "intermediate" | "advanced";
}

const BUILTIN_COMMAND_LIBRARY: BuiltinCommand[] = [
  // ── Linux 基础 ──
  {
    task: "查看当前目录下所有文件（含隐藏）",
    command: "```bash\nls -la\n```\n\n- `-l` 显示详细信息\n- `-a` 显示隐藏文件",
    hints: ["a 代表 all"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "切换到上一级目录",
    command: "```bash\ncd ..\n```",
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "递归创建多级目录",
    command: "```bash\nmkdir -p path/to/folder\n```\n\n`-p` 自动创建中间目录",
    examples: ["mkdir -p ~/projects/2025/january"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "递归删除目录及其所有内容",
    command: "```bash\nrm -rf folder/\n```\n\n⚠️ `-r` 递归 / `-f` 强制不询问",
    hints: ["谨慎使用，无法恢复"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "搜索文件内容（含行号 + 颜色）",
    command: "```bash\ngrep -nri \"关键词\" path/\n```\n\n- `-n` 显示行号\n- `-r` 递归子目录\n- `-i` 忽略大小写",
    examples: ["grep -nri \"TODO\" src/"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "查找指定名称的文件",
    command: "```bash\nfind . -name \"*.md\"\n```",
    examples: ["find /var/log -name \"*.log\" -mtime -7"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "实时查看日志文件末尾",
    command: "```bash\ntail -f /var/log/syslog\n```\n\n`-f` 持续跟踪新内容",
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "改变文件所有者",
    command: "```bash\nsudo chown user:group filename\n```",
    examples: ["sudo chown -R nginx:nginx /var/www"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "修改文件权限为 755",
    command: "```bash\nchmod 755 filename\n```\n\n7=rwx 所有者 / 5=rx 组 / 5=rx 其他",
    hints: ["数字三位分别对应 owner/group/other"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "查看实时系统资源占用",
    command: "```bash\ntop\n```\n\n推荐使用更友好的：`htop`",
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "查看磁盘空间使用情况",
    command: "```bash\ndf -h\n```\n\n`-h` 人性化显示（GB/MB）",
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "查看当前目录占用空间",
    command: "```bash\ndu -sh ./*\n```\n\n- `-s` 汇总每个文件\n- `-h` 人性化显示",
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "终止指定进程",
    command: "```bash\nkill -9 PID\n```\n\n`-9` 强制终止信号",
    hints: ["先用 ps -ef 找 PID"],
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },
  {
    task: "查看监听端口及对应进程",
    command: "```bash\nsudo lsof -i :端口号\n```",
    examples: ["sudo lsof -i :8080"],
    shell: "bash",
    category: "linux",
    difficulty: "intermediate",
  },
  {
    task: "解压 tar.gz 压缩包",
    command: "```bash\ntar -xzvf archive.tar.gz\n```\n\n- `-x` 解压\n- `-z` gzip 格式\n- `-v` 显示过程\n- `-f` 指定文件",
    shell: "bash",
    category: "linux",
    difficulty: "basic",
  },

  // ── Git ──
  {
    task: "初始化 Git 仓库",
    command: "```bash\ngit init\n```",
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "克隆远程仓库到本地",
    command: "```bash\ngit clone <url>\n```",
    examples: ["git clone https://github.com/user/repo.git"],
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "查看当前文件状态",
    command: "```bash\ngit status\n```\n\n推荐：`git status -sb`（精简版）",
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "添加所有变更到暂存区",
    command: "```bash\ngit add .\n```",
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "提交并附带消息",
    command: "```bash\ngit commit -m \"提交说明\"\n```",
    examples: ["git commit -m \"feat: 添加登录功能\""],
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "推送到远程分支",
    command: "```bash\ngit push origin <branch>\n```",
    examples: ["git push origin main", "git push -u origin feat/login"],
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "拉取远程并合并",
    command: "```bash\ngit pull origin <branch>\n```\n\n相当于 `fetch + merge`",
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "创建并切换到新分支",
    command: "```bash\ngit checkout -b <branch-name>\n```\n\n现代写法：`git switch -c <branch-name>`",
    examples: ["git checkout -b feat/login"],
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "合并指定分支到当前分支",
    command: "```bash\ngit merge <branch-name>\n```",
    shell: "bash",
    category: "git",
    difficulty: "basic",
  },
  {
    task: "查看提交历史（精简单行）",
    command: "```bash\ngit log --oneline --graph --all\n```",
    shell: "bash",
    category: "git",
    difficulty: "intermediate",
  },
  {
    task: "撤销已暂存的文件（保留修改）",
    command: "```bash\ngit reset HEAD <file>\n```\n\n现代写法：`git restore --staged <file>`",
    shell: "bash",
    category: "git",
    difficulty: "intermediate",
  },
  {
    task: "丢弃工作区文件的修改",
    command: "```bash\ngit checkout -- <file>\n```\n\n现代写法：`git restore <file>`",
    hints: ["⚠️ 不可恢复"],
    shell: "bash",
    category: "git",
    difficulty: "intermediate",
  },
  {
    task: "暂存当前工作区（紧急切分支用）",
    command: "```bash\ngit stash\n```\n\n恢复：`git stash pop`\n查看列表：`git stash list`",
    shell: "bash",
    category: "git",
    difficulty: "intermediate",
  },
  {
    task: "变基到指定分支（保持提交线性）",
    command: "```bash\ngit rebase <branch>\n```\n\n⚠️ 不要对已推送的提交执行",
    shell: "bash",
    category: "git",
    difficulty: "advanced",
  },
  {
    task: "撤销最后一次提交（保留修改）",
    command: "```bash\ngit reset --soft HEAD^\n```\n\n- `--soft` 保留暂存\n- `--mixed`（默认）保留工作区\n- `--hard` 全部丢弃",
    shell: "bash",
    category: "git",
    difficulty: "intermediate",
  },

  // ── Docker ──
  {
    task: "查看本地所有镜像",
    command: "```bash\ndocker images\n```",
    shell: "bash",
    category: "docker",
    difficulty: "basic",
  },
  {
    task: "查看正在运行的容器",
    command: "```bash\ndocker ps\n```\n\n查看所有容器（含已停止）：`docker ps -a`",
    shell: "bash",
    category: "docker",
    difficulty: "basic",
  },
  {
    task: "拉取指定镜像",
    command: "```bash\ndocker pull <image>:<tag>\n```",
    examples: ["docker pull nginx:1.25", "docker pull redis:7-alpine"],
    shell: "bash",
    category: "docker",
    difficulty: "basic",
  },
  {
    task: "后台运行容器并映射端口",
    command: "```bash\ndocker run -d --name <name> -p 宿主机端口:容器端口 <image>\n```\n\n- `-d` 后台运行\n- `--name` 指定容器名\n- `-p` 端口映射",
    examples: ["docker run -d --name mynginx -p 8080:80 nginx"],
    shell: "bash",
    category: "docker",
    difficulty: "basic",
  },
  {
    task: "进入运行中容器的 bash",
    command: "```bash\ndocker exec -it <container> bash\n```\n\n如无 bash 用 sh：`docker exec -it <container> sh`",
    examples: ["docker exec -it mynginx bash"],
    shell: "bash",
    category: "docker",
    difficulty: "basic",
  },
  {
    task: "查看容器日志",
    command: "```bash\ndocker logs -f <container>\n```\n\n- `-f` 跟踪\n- `--tail 100` 仅最后 100 行",
    shell: "bash",
    category: "docker",
    difficulty: "basic",
  },
  {
    task: "停止并删除容器",
    command: "```bash\ndocker stop <container> && docker rm <container>\n```",
    shell: "bash",
    category: "docker",
    difficulty: "basic",
  },
  {
    task: "构建镜像（含 Dockerfile 的目录）",
    command: "```bash\ndocker build -t <name>:<tag> .\n```",
    examples: ["docker build -t myapp:v1 ."],
    shell: "bash",
    category: "docker",
    difficulty: "intermediate",
  },
  {
    task: "清理所有停止的容器/未用镜像/网络",
    command: "```bash\ndocker system prune -a\n```\n\n⚠️ `-a` 会清理所有未使用的镜像",
    shell: "bash",
    category: "docker",
    difficulty: "intermediate",
  },
  {
    task: "挂载本地目录到容器",
    command: "```bash\ndocker run -d -v 宿主机路径:容器路径 <image>\n```",
    examples: ["docker run -d -v $(pwd)/data:/app/data nginx"],
    shell: "bash",
    category: "docker",
    difficulty: "intermediate",
  },

  // ── npm ──
  {
    task: "初始化 package.json",
    command: "```bash\nnpm init -y\n```\n\n`-y` 跳过所有提问使用默认值",
    shell: "bash",
    category: "npm",
    difficulty: "basic",
  },
  {
    task: "安装依赖到生产环境",
    command: "```bash\nnpm install <package>\n```",
    examples: ["npm install lodash", "npm install react react-dom"],
    shell: "bash",
    category: "npm",
    difficulty: "basic",
  },
  {
    task: "安装为开发依赖",
    command: "```bash\nnpm install -D <package>\n```\n\n`-D` 等同 `--save-dev`",
    examples: ["npm install -D typescript @types/node"],
    shell: "bash",
    category: "npm",
    difficulty: "basic",
  },
  {
    task: "全局安装包",
    command: "```bash\nnpm install -g <package>\n```\n\n`-g` 全局安装",
    examples: ["npm install -g pnpm"],
    shell: "bash",
    category: "npm",
    difficulty: "basic",
  },
  {
    task: "运行 package.json 中的 script",
    command: "```bash\nnpm run <script-name>\n```\n\n查看所有 script：`npm run`",
    examples: ["npm run build", "npm run dev"],
    shell: "bash",
    category: "npm",
    difficulty: "basic",
  },
  {
    task: "升级所有依赖到最新版",
    command: "```bash\nnpx npm-check-updates -u && npm install\n```\n\n或使用 `pnpm update --latest`",
    shell: "bash",
    category: "npm",
    difficulty: "intermediate",
  },

  // ── Kubernetes ──
  {
    task: "查看所有命名空间的 Pod",
    command: "```bash\nkubectl get pods -A\n```\n\n`-A` 等同 `--all-namespaces`",
    shell: "bash",
    category: "k8s",
    difficulty: "basic",
  },
  {
    task: "查看指定 Pod 的详细信息",
    command: "```bash\nkubectl describe pod <name> -n <namespace>\n```\n\n常用于排查启动失败原因",
    shell: "bash",
    category: "k8s",
    difficulty: "intermediate",
  },
  {
    task: "查看 Pod 日志",
    command: "```bash\nkubectl logs <pod> -n <ns> -f --tail=100\n```",
    shell: "bash",
    category: "k8s",
    difficulty: "intermediate",
  },
  {
    task: "进入 Pod 容器执行 bash",
    command: "```bash\nkubectl exec -it <pod> -n <ns> -- bash\n```",
    shell: "bash",
    category: "k8s",
    difficulty: "intermediate",
  },
  {
    task: "应用 YAML 配置（创建/更新资源）",
    command: "```bash\nkubectl apply -f manifest.yaml\n```\n\n查看变化：`kubectl diff -f manifest.yaml`",
    shell: "bash",
    category: "k8s",
    difficulty: "intermediate",
  },
  {
    task: "扩缩 Deployment 副本数",
    command: "```bash\nkubectl scale deploy <name> --replicas=3 -n <ns>\n```",
    shell: "bash",
    category: "k8s",
    difficulty: "intermediate",
  },
  {
    task: "重启 Deployment（滚动重启）",
    command: "```bash\nkubectl rollout restart deploy <name> -n <ns>\n```",
    shell: "bash",
    category: "k8s",
    difficulty: "intermediate",
  },
];