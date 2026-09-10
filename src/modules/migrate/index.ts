/**
 * Migrate 模块 —— 数据迁移与备份（路线图 4C）
 */
export { MigrationService } from "./migration-service";
export type { ImportSummary } from "./migration-service";
export { MigrationModal } from "./migration-modal";
export { toAnkiText, toCSV, toMarkdown, toJSON, scenarioLabel } from "./anki-exporter";
export {
  parseCards,
  parseCardsFromJSON,
  parseCardsFromDelimited,
  buildImportedCard,
  detectFormat,
} from "./data-importer";
export type { ParsedImport } from "./data-importer";
