// Recall 模块统一导出 (barrel export)
// 减少 main.ts import 行数，提升可维护性

// 核心
export { RecallCardStore } from "./core/recall-card-store";
export { RecallView } from "./core/view-recall";
export { SRSEngine } from "./core/srs-engine";
export { AICardGenerator } from "./core/ai-card-generator";
export { TTSService } from "./core/tts-service";

// 场景生成器
export { RecallWikiGenerator } from "./generators/recall-wiki-generator";
export { RecallCommandGenerator } from "./generators/recall-command-generator";
export { RecallVocabGenerator } from "./generators/recall-vocab-generator";
export { RecallConceptGenerator } from "./generators/recall-concept-generator";
export { RecallPhraseGenerator } from "./generators/recall-phrase-generator";

// 单词场景
export { WordListStore } from "./vocab/word-list-store";

// 卡片管理
export { RecallCardManagerView } from "./card-manager/recall-card-manager-view";

// 面试助手
export { InterviewStore } from "./interview/interview-store";
export { JDAnalyzer } from "./interview/jd-analyzer";
export { GapAnalyzer } from "./interview/gap-analyzer";
export { InterviewView } from "./interview/interview-view";
export { MockInterviewer } from "./interview/mock-interviewer";
export { MockInterviewView } from "./interview/mock-interview-view";

// 自定义场景
export { CustomScenarioStore } from "./custom-scenario/custom-scenario-store";

// Dashboard
export { DashboardService } from "./dashboard/dashboard-service";

// 卡片关联
export { CardVectorStore } from "./card-relations/card-vector-store";
export { CardRelationService } from "./card-relations/card-relation-service";
