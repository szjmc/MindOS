import { App, TFile, Notice } from "obsidian";
import { MindOSSettings, ChunkMeta, PageType } from "../../core/types";
import { parseFrontmatter, nowISOString } from "../../core/utils";
import { VectorStore } from "./vector-store";
import { Chunker, ChunkInput } from "./chunker";
import { EmbeddingClient } from "./embedding-client";
import { TokenEstimator } from "./token-estimator";
import { QuotaManager } from "./quota-manager";
import { IndexManager } from "../wiki/index-manager";
import { RetrieveStore } from "../../core/store";

export interface VectorizePlan {
  filesToProcess: TFile[];
  filesToRemove: string[];
  totalChunks: number;
  estimatedTokens: number;
  estimatedCostCny: number;
}

/**
 * 向量化生命周期管理器
 *
 * 核心职责：
 * 1. 全量向量化（首次/重建）
 * 2. 增量同步（基于 mtime 检测变更）
 * 3. 自动批量向量化（积累变更触发）
 * 4. 进度推送给 RetrieveStore
 * 5. 配额检查
 */
export class EmbeddingManager {
  private pendingFiles = new Set<string>();
  private autoTriggerTimer: number | null = null;
  private isProcessing = false;
  private stopRequested = false;

  constructor(
    private app: App,
    private getSettings: () => MindOSSettings,
    private vectorStore: VectorStore,
    private embeddingClient: EmbeddingClient,
    private quotaManager: QuotaManager,
    private indexManager: IndexManager,
    private retrieveStore: RetrieveStore,
    private logger: (msg: string) => void,
  ) {}

  /**
   * 紧急停止所有正在进行的向量化操作
   */
  emergencyStop() {
    this.stopRequested = true;
    this.pendingFiles.clear();
    if (this.autoTriggerTimer) {
      window.clearTimeout(this.autoTriggerTimer);
      this.autoTriggerTimer = null;
    }
    this.logger("🚨 已紧急停止所有向量化操作");
  }

  /**
   * 重置停止标志
   */
  resetStopFlag() {
    this.stopRequested = false;
  }

  // ════════════════════════════════════════════════════════════
  // 全量向量化
  // ════════════════════════════════════════════════════════════
  async vectorizeAll(): Promise<{ success: boolean; message: string }> {
    const s = this.getSettings();
    if (!s.embeddingApiBaseUrl || !s.embeddingApiKey || !s.embeddingModel) {
      return {
        success: false,
        message: "请先在设置中配置 Embedding（Base URL / API Key / Model）",
      };
    }

    this.logger("📦 开始全量向量化...");

    // 1. 扫描所有可索引文件
    const allFiles = await this.indexManager.scanAllIndexableFiles(true);
    if (allFiles.length === 0) {
      return { success: false, message: "没有可向量化的文件" };
    }

    this.logger(`📋 扫描到 ${allFiles.length} 个文件`);

    // 2. 制定计划
    const plan = await this.makePlan(allFiles, true);

    // 3. 配额检查
    const quotaCheck = await this.quotaManager.canConsume(plan.estimatedTokens);
    if (!quotaCheck.allowed) {
      return {
        success: false,
        message: `配额不足：${quotaCheck.reason}`,
      };
    }

    // 4. 清空旧索引（全量）
    await this.vectorStore.clear();

    // 5. 执行向量化
    return await this.executePlan(plan, true);
  }

  // ════════════════════════════════════════════════════════════
  // 增量同步
  // ════════════════════════════════════════════════════════════
  async syncIncremental(): Promise<{ success: boolean; message: string }> {
    const s = this.getSettings();
    if (!s.embeddingApiBaseUrl || !s.embeddingApiKey || !s.embeddingModel) {
      return {
        success: false,
        message: "请先在设置中配置 Embedding",
      };
    }

    this.logger("🔄 开始增量同步...");

    // 1. 扫描所有可索引文件
    const allFiles = await this.indexManager.scanAllIndexableFiles(true);

    // 2. 找出已索引的文件
    const indexed = await this.vectorStore.getIndexedFiles();
    const indexedPaths = new Set(indexed.keys());

    // 3. 找出删除的文件
    const currentPaths = new Set(allFiles.map((f) => f.path));
    const deletedPaths: string[] = [];
    for (const p of indexedPaths) {
      if (!currentPaths.has(p)) deletedPaths.push(p);
    }

    // 4. 找出新增和修改的文件
    const filesToProcess: TFile[] = [];
    for (const f of allFiles) {
      const indexedMtime = indexed.get(f.path);
      if (indexedMtime === undefined || indexedMtime !== f.stat.mtime) {
        filesToProcess.push(f);
      }
    }

    if (filesToProcess.length === 0 && deletedPaths.length === 0) {
      this.logger("✅ 无变更，索引已是最新");
      return { success: true, message: "索引已是最新" };
    }

    this.logger(`ℹ️ 检测到 ${filesToProcess.length} 个新增/修改, ${deletedPaths.length} 个删除`);

    // 5. 删除已删除文件的向量
    if (deletedPaths.length > 0) {
      await this.vectorStore.removeByPaths(deletedPaths);
      this.logger(`🗑 已清理 ${deletedPaths.length} 个删除文件的向量`);
    }

    if (filesToProcess.length === 0) {
      await this.vectorStore.save();
      return { success: true, message: `已清理 ${deletedPaths.length} 个删除文件` };
    }

    // 6. 制定计划（不全量重建，仅处理变更文件）
    const plan = await this.makePlan(filesToProcess, false);
    plan.filesToRemove = deletedPaths;

    // 7. 配额检查
    const quotaCheck = await this.quotaManager.canConsume(plan.estimatedTokens);
    if (!quotaCheck.allowed) {
      return {
        success: false,
        message: `配额不足：${quotaCheck.reason}`,
      };
    }

    // 8. 删除待处理文件的旧向量（避免重复）
    for (const f of filesToProcess) {
      await this.vectorStore.removeByPath(f.path);
    }

    // 9. 执行
    return await this.executePlan(plan, false);
  }

  // ════════════════════════════════════════════════════════════
  // 制定向量化计划
  // ════════════════════════════════════════════════════════════
  async makePlan(files: TFile[], isFullRebuild: boolean): Promise<VectorizePlan> {
    const s = this.getSettings();
    const chunker = new Chunker(s.embeddingChunkMaxChars, s.embeddingChunkMinChars);

    let totalChunks = 0;
    let estimatedTokens = 0;

    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const { frontmatter, body } = parseFrontmatter(content);
        const fileType = this.indexManager.classifyFile(file);
        const fileTitle = String(frontmatter.title ?? file.basename);

        const chunks = chunker.chunk({
          path: file.path,
          fileTitle,
          fileType,
          content: body,
          fileMtime: file.stat.mtime,
        });

        totalChunks += chunks.length;
        estimatedTokens += chunks.reduce((sum, c) => sum + c.tokens, 0);
      } catch {
        // 跳过读取失败的文件
      }
    }

    const estimatedCostCny = TokenEstimator.estimateCost(
      estimatedTokens,
      s.costPerMillionTokensEmbedding,
    );

    return {
      filesToProcess: files,
      filesToRemove: [],
      totalChunks,
      estimatedTokens,
      estimatedCostCny,
    };
  }

  // ════════════════════════════════════════════════════════════
  // 执行向量化
  // ════════════════════════════════════════════════════════════
  private async executePlan(
    plan: VectorizePlan,
    isFullRebuild: boolean,
  ): Promise<{ success: boolean; message: string }> {
    const s = this.getSettings();
    const chunker = new Chunker(s.embeddingChunkMaxChars, s.embeddingChunkMinChars);

    this.retrieveStore.startVectorize(plan.filesToProcess.length, plan.estimatedTokens);

    let totalActualTokens = 0;
    let processedFiles = 0;
    let totalUpsertedChunks = 0;
    let modelDim = 0;

    // 按文件逐个处理（一个文件可能产生多个 chunk）
    for (const file of plan.filesToProcess) {
      // 检查是否请求停止
      if (this.stopRequested) {
        this.logger("🚨 向量化被用户紧急停止");
        this.retrieveStore.finishVectorize("stopped");
        await this.vectorStore.save();
        const stoppedCost = TokenEstimator.estimateCost(totalActualTokens, s.costPerMillionTokensEmbedding);
        await this.quotaManager.consume(totalActualTokens, stoppedCost);
        return {
          success: false,
          message: `已紧急停止，已处理 ${processedFiles} 个文件，消耗 ${totalActualTokens} tokens`,
        };
      }
      
      try {
        const content = await this.app.vault.read(file);
        const { frontmatter, body } = parseFrontmatter(content);
        const fileType = this.indexManager.classifyFile(file);
        const fileTitle = String(frontmatter.title ?? file.basename);

        const chunks = chunker.chunk({
          path: file.path,
          fileTitle,
          fileType,
          content: body,
          fileMtime: file.stat.mtime,
        });

        if (chunks.length === 0) {
          processedFiles++;
          this.retrieveStore.updateVectorizeProgress(processedFiles, file.path, totalActualTokens);
          continue;
        }

        // 按 batchSize 分批调用
        const batchSize = Math.max(1, s.embeddingBatchSize);
        const chunkMetas: ChunkMeta[] = [];

        for (let i = 0; i < chunks.length; i += batchSize) {
          const batch = chunks.slice(i, i + batchSize);
          const texts = batch.map((c) => c.text);

          this.retrieveStore.updateVectorizeProgress(
            processedFiles,
            `${file.path} [${i + 1}/${chunks.length}]`,
            totalActualTokens,
          );

          try {
            const result = await this.embeddingClient.embed(texts);
            totalActualTokens += result.totalTokens;

            // 记录维度
            if (modelDim === 0 && result.vectors[0]) {
              modelDim = result.vectors[0].length;
            }

            for (let j = 0; j < batch.length; j++) {
              const c = batch[j];
              const v = result.vectors[j];
              chunkMetas.push({
                id: c.id,
                path: c.path,
                fileTitle: c.fileTitle,
                fileType: c.fileType,
                section: c.section,
                sectionIndex: c.sectionIndex,
                text: c.text,
                hash: c.hash,
                vector: v,
                vectorDim: v.length,
                model: s.embeddingModel,
                tokens: c.tokens,
                fileMtime: c.fileMtime,
                createdAt: nowISOString(),
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.retrieveStore.addVectorizeError(`${file.path}: ${msg}`);
            this.logger(`❌ ${file.path} 第 ${i + 1} 批失败: ${msg}`);

            // API Key 错误立即停止
            if (msg.includes("invalid_api_key") || msg.includes("401")) {
              this.retrieveStore.finishVectorize("error");
              await this.vectorStore.save();
              return { success: false, message: `API Key 无效，已停止` };
            }
            if (msg.includes("insufficient_quota") || msg.includes("402")) {
              this.retrieveStore.finishVectorize("error");
              await this.vectorStore.save();
              return { success: false, message: `API 余额不足，已停止` };
            }
            // 其他错误：跳过这一批
          }
        }

        // 一个文件的所有 chunk 处理完，写入向量库
        if (chunkMetas.length > 0) {
          await this.vectorStore.upsertChunks(chunkMetas);
          totalUpsertedChunks += chunkMetas.length;
        }

        processedFiles++;
        this.retrieveStore.updateVectorizeProgress(processedFiles, file.path, totalActualTokens);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.retrieveStore.addVectorizeError(`${file.path}: ${msg}`);
        this.logger(`❌ ${file.path} 处理失败: ${msg}`);
        processedFiles++;
      }
    }

    // 设置模型元信息
    if (modelDim > 0) {
      await this.vectorStore.setMeta(s.embeddingModel, modelDim);
    }

    // 持久化
    await this.vectorStore.save();

    // 配额计入
    const cost = TokenEstimator.estimateCost(totalActualTokens, s.costPerMillionTokensEmbedding);
    await this.quotaManager.consume(totalActualTokens, cost);

    this.retrieveStore.finishVectorize("done");

    const message = `✅ 完成：${totalUpsertedChunks} 个 chunks（${processedFiles} 个文件），实际消耗 ${TokenEstimator.formatTokens(totalActualTokens)} tokens（${TokenEstimator.formatCost(cost)}）`;
    this.logger(message);

    return { success: true, message };
  }

  // ════════════════════════════════════════════════════════════
  // 单文件向量化（用于自动触发）
  // ════════════════════════════════════════════════════════════
  async vectorizeFile(file: TFile): Promise<void> {
    const s = this.getSettings();
    if (!s.embeddingApiBaseUrl || !s.embeddingApiKey || !s.embeddingModel) {
      return;
    }

    try {
      const content = await this.app.vault.read(file);
      const { frontmatter, body } = parseFrontmatter(content);
      const fileType = this.indexManager.classifyFile(file);
      const fileTitle = String(frontmatter.title ?? file.basename);

      const chunker = new Chunker(s.embeddingChunkMaxChars, s.embeddingChunkMinChars);
      const chunks = chunker.chunk({
        path: file.path,
        fileTitle,
        fileType,
        content: body,
        fileMtime: file.stat.mtime,
      });

      if (chunks.length === 0) {
        await this.vectorStore.removeByPath(file.path);
        await this.vectorStore.save();
        return;
      }

      // 删除旧的
      await this.vectorStore.removeByPath(file.path);

      // 配额检查
      const estimatedTokens = chunks.reduce((sum, c) => sum + c.tokens, 0);
      const quotaCheck = await this.quotaManager.canConsume(estimatedTokens);
      if (!quotaCheck.allowed) {
        this.logger(`⚠️ ${file.path} 配额不足，跳过自动向量化`);
        return;
      }

      // 嵌入
      const batchSize = Math.max(1, s.embeddingBatchSize);
      const chunkMetas: ChunkMeta[] = [];
      let actualTokens = 0;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const texts = batch.map((c) => c.text);
        const result = await this.embeddingClient.embed(texts);
        actualTokens += result.totalTokens;

        for (let j = 0; j < batch.length; j++) {
          const c = batch[j];
          const v = result.vectors[j];
          chunkMetas.push({
            id: c.id,
            path: c.path,
            fileTitle: c.fileTitle,
            fileType: c.fileType,
            section: c.section,
            sectionIndex: c.sectionIndex,
            text: c.text,
            hash: c.hash,
            vector: v,
            vectorDim: v.length,
            model: s.embeddingModel,
            tokens: c.tokens,
            fileMtime: c.fileMtime,
            createdAt: nowISOString(),
          });
        }
      }

      await this.vectorStore.upsertChunks(chunkMetas);
      await this.vectorStore.save();

      const cost = TokenEstimator.estimateCost(actualTokens, s.costPerMillionTokensEmbedding);
      await this.quotaManager.consume(actualTokens, cost);

      this.logger(`✅ 自动向量化：${file.path}（${chunkMetas.length} chunks）`);
    } catch (e) {
      this.logger(`❌ 自动向量化失败：${file.path} - ${e}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  // 自动触发器（积累 N 个变更后批量向量化）
  // ════════════════════════════════════════════════════════════
  
  private lastFlushTime = 0;
  private MIN_FLUSH_INTERVAL = 30 * 60 * 1000; // 至少30分钟间隔
  private MAX_PENDING_FILES = 50; // 最大待处理文件数
  private filesProcessedThisSession = new Set<string>(); // 本次会话已处理的文件
  private processing = false; // 防止并发处理

  notifyFileChanged(filePath: string) {
    const s = this.getSettings();
    if (!s.autoVectorize) return;

    // 防止重复添加
    if (this.filesProcessedThisSession.has(filePath)) {
      this.logger(`⚠️ ${filePath} 本次会话已处理过，跳过`);
      return;
    }

    // 队列已满，防止无限增长
    if (this.pendingFiles.size >= this.MAX_PENDING_FILES) {
      this.logger(`⚠️ 待向量化队列已满 (${this.MAX_PENDING_FILES})，跳过 ${filePath}`);
      return;
    }

    this.pendingFiles.add(filePath);
    this.logger(`ℹ️ 待向量化队列：${this.pendingFiles.size}/${s.autoVectorizeThreshold}`);

    if (this.pendingFiles.size >= s.autoVectorizeThreshold) {
      this.flushPending();
    } else {
      // 延迟触发：更长的间隔（15分钟）
      if (this.autoTriggerTimer) {
        window.clearTimeout(this.autoTriggerTimer);
      }
      this.autoTriggerTimer = window.setTimeout(() => {
        this.flushPending();
      }, 15 * 60 * 1000);
    }
  }

  notifyFileDeleted(filePath: string) {
    this.pendingFiles.delete(filePath);
    // 立即清理向量
    this.vectorStore.removeByPath(filePath).then(() => this.vectorStore.save());
  }

  private async flushPending() {
    if (this.pendingFiles.size === 0) return;
    if (this.processing) {
      this.logger(`⚠️ 正在处理中，跳过本次触发`);
      return;
    }

    // 检查最小间隔
    const now = Date.now();
    if (now - this.lastFlushTime < this.MIN_FLUSH_INTERVAL) {
      const remaining = Math.ceil((this.MIN_FLUSH_INTERVAL - (now - this.lastFlushTime)) / 60000);
      this.logger(`⚠️ 距上次向量化不足 ${remaining} 分钟，跳过本次触发`);
      // 重新设置定时器，延后触发
      if (this.autoTriggerTimer) {
        window.clearTimeout(this.autoTriggerTimer);
      }
      this.autoTriggerTimer = window.setTimeout(() => {
        this.flushPending();
      }, this.MIN_FLUSH_INTERVAL - (now - this.lastFlushTime));
      return;
    }

    if (this.autoTriggerTimer) {
      window.clearTimeout(this.autoTriggerTimer);
      this.autoTriggerTimer = null;
    }

    this.processing = true;
    this.lastFlushTime = now;

    const paths = Array.from(this.pendingFiles);
    this.pendingFiles.clear();

    this.logger(`ℹ️ 开始批量向量化 ${paths.length} 个待处理文件`);

    try {
      for (const p of paths) {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (f instanceof TFile) {
          await this.vectorizeFile(f);
          this.filesProcessedThisSession.add(p);
        }
      }
      this.logger(`✅ 批量向量化完成`);
    } catch (e) {
      this.logger(`❌ 批量向量化失败：${e}`);
    } finally {
      this.processing = false;
    }
  }

  // ════════════════════════════════════════════════════════════
  // 管理操作
  // ════════════════════════════════════════════════════════════
  async clearAll(): Promise<void> {
    await this.vectorStore.clear();
    this.pendingFiles.clear();
    if (this.autoTriggerTimer) {
      window.clearTimeout(this.autoTriggerTimer);
      this.autoTriggerTimer = null;
    }
    this.logger("🗑 所有向量已清空");
  }

  async getStatus(): Promise<{
    indexed: number;
    pages: number;
    model: string;
    dim: number;
    pending: number;
  }> {
    const meta = await this.vectorStore.getMeta();
    return {
      indexed: meta.total,
      pages: meta.pages,
      model: meta.model,
      dim: meta.dim,
      pending: this.pendingFiles.size,
    };
  }

  /**
   * 检查待同步的文件数量（不实际处理）
   */
  async checkPendingSync(): Promise<{
    toAdd: number;
    toUpdate: number;
    toRemove: number;
    estimatedTokens: number;
  }> {
    const allFiles = await this.indexManager.scanAllIndexableFiles(true);
    const indexed = await this.vectorStore.getIndexedFiles();
    const indexedPaths = new Set(indexed.keys());
    const currentPaths = new Set(allFiles.map((f) => f.path));

    let toAdd = 0;
    let toUpdate = 0;
    const filesToProcess: TFile[] = [];

    for (const f of allFiles) {
      const m = indexed.get(f.path);
      if (m === undefined) {
        toAdd++;
        filesToProcess.push(f);
      } else if (m !== f.stat.mtime) {
        toUpdate++;
        filesToProcess.push(f);
      }
    }

    let toRemove = 0;
    for (const p of indexedPaths) {
      if (!currentPaths.has(p)) toRemove++;
    }

    let estimatedTokens = 0;
    if (filesToProcess.length > 0) {
      const plan = await this.makePlan(filesToProcess, false);
      estimatedTokens = plan.estimatedTokens;
    }

    return { toAdd, toUpdate, toRemove, estimatedTokens };
  }
}