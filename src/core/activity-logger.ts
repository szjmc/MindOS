import { App, TFile } from "obsidian";

export interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  source?: string;
  data?: any;
}

export class ActivityLogger {
  private logs: LogEntry[] = [];
  private maxLogs = 500;
  private logFile: TFile | null = null;
  private initialized = false;
  private logHistory: string[] = [];

  constructor(private app: App, private baseFolder: string) {}

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    
    const logPath = `${this.baseFolder}/.mindos-activity-log.json`;
    const fileExists = await this.app.vault.adapter.exists(logPath);
    
    if (fileExists) {
      try {
        const content = await this.app.vault.adapter.read(logPath);
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          this.logs = parsed.slice(-this.maxLogs);
        }
      } catch (e) {
        console.log('MindOS: 读取日志失败，使用空日志');
      }
    }
    
    this.info('插件启动', 'system');
    this.info('日志系统初始化完成', 'logger');
  }

  log(level: 'info' | 'warn' | 'error', message: string, source: string = 'unknown', data?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      source,
      data
    };
    
    this.logs.push(entry);
    this.logHistory.push(`[${new Date(entry.timestamp).toLocaleTimeString()}] [${level.toUpperCase()}] ${source}: ${message}`);
    
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }
    if (this.logHistory.length > this.maxLogs) {
      this.logHistory = this.logHistory.slice(-this.maxLogs);
    }
    
    console.log(`[MindOS ${level.toUpperCase()}] ${source}: ${message}`, data || '');
    
    this.saveSoon();
  }

  info(message: string, source: string = 'unknown', data?: any) {
    this.log('info', message, source, data);
  }

  warn(message: string, source: string = 'unknown', data?: any) {
    this.log('warn', message, source, data);
  }

  error(message: string, source: string = 'unknown', data?: any) {
    this.log('error', message, source, data);
  }

  getRecentLogs(count: number = 50): LogEntry[] {
    return this.logs.slice(-count).reverse();
  }

  getRecentLogStrings(count: number = 50): string[] {
    return this.logHistory.slice(-count).reverse();
  }

  private saveTimer: any = null;
  
  private saveSoon() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.save(), 5000);
  }

  private async save() {
    try {
      const logPath = `${this.baseFolder}/.mindos-activity-log.json`;
      const content = JSON.stringify(this.logs, null, 2);
      
      if (!this.logFile) {
        // 用 adapter.exists 直查文件系统，避免 getAbstractFileByPath 未索引的竞态
        const fileExists = await this.app.vault.adapter.exists(logPath);
        if (fileExists) {
          // 文件已存在：读取已有内容合并（防止并发写覆盖）
          try {
            const existingRaw = await this.app.vault.adapter.read(logPath);
            const existingLogs = JSON.parse(existingRaw);
            if (Array.isArray(existingLogs)) {
              // 合并：保留最新的 maxLogs 条，去重
              const merged = new Map<string, LogEntry>();
              for (const entry of existingLogs) {
                merged.set(`${entry.timestamp}-${entry.message}`, entry);
              }
              for (const entry of this.logs) {
                merged.set(`${entry.timestamp}-${entry.message}`, entry);
              }
              this.logs = Array.from(merged.values())
                .sort((a, b) => a.timestamp - b.timestamp)
                .slice(-this.maxLogs);
            }
          } catch {
            // 读取失败就用内存中的
          }
          const finalContent = JSON.stringify(this.logs, null, 2);
          await this.app.vault.adapter.write(logPath, finalContent);
          // 让 Obsidian 重新索引
          const abstractFile = this.app.vault.getAbstractFileByPath(logPath);
          if (abstractFile instanceof TFile) {
            this.logFile = abstractFile;
          }
        } else {
          try {
            this.logFile = await this.app.vault.create(logPath, JSON.stringify(this.logs, null, 2));
          } catch (createErr: any) {
            if (createErr?.message?.includes?.("already exists")) {
              // 竞态：两个并发 save() 同时走到此分支，后者忽略即可
              const f = this.app.vault.getAbstractFileByPath(logPath);
              if (f instanceof TFile) this.logFile = f;
            } else {
              throw createErr;
            }
          }
        }
      } else {
        await this.app.vault.modify(this.logFile, content);
      }
    } catch (e) {
      console.error('MindOS: 保存日志失败', e);
    }
  }

  clear() {
    this.logs = [];
    this.logHistory = [];
    if (this.logFile) {
      this.app.vault.delete(this.logFile).catch(() => {});
      this.logFile = null;
    }
  }
}
