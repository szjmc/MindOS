/**
 * PluginLike — 插件的最小接口，供 ServiceContainer 和其它模块引用
 *
 * 用于打破 'this' 的循环依赖：各服务模块不再依赖完整的 MindOSPlugin 类型，
 * 而是依赖这个最小接口，使得 ServiceContainer 可以独立创建服务。
 */
import { App } from "obsidian";
import { MindOSSettings } from "./types";
import type { AIClient } from "../modules/pipeline/ai-client";

export interface PluginLike {
  app: App;
  settings: MindOSSettings;
  aiClient: AIClient;
  loadData(): Promise<any>;
  saveData(data: any): Promise<void>;
}
