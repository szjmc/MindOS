/**
 * 卡片相似度工具测试（v0.7 智能卡片关联）
 */
import {
  cosineSimilarity,
  computeTextSimilarity,
  computeTagBoost,
  computeScenarioBoost,
} from "../src/modules/recall/card-relations/card-similarity";
import { RecallCard, RecallScenario } from "../src/core/types";

function makeCard(overrides: Partial<RecallCard> = {}): RecallCard {
  return {
    id: overrides.id ?? "card-1",
    scenario: (overrides.scenario as RecallScenario) ?? "wiki",
    front: overrides.front ?? "什么是闭包？",
    back: overrides.back ?? "闭包是能捕获外部变量的函数",
    srs: {
      algorithm: "sm2",
      interval: 1,
      repetitions: 1,
      easeFactor: 2.5,
      stability: 1,
      difficulty: 0.3,
      nextReview: "2026-01-01",
      lastReview: "2026-01-01",
      lastRating: 3,
    },
    stats: { totalReviews: 1, correctCount: 1, wrongCount: 0, avgResponseTimeMs: 1000, streak: 1 },
    tags: overrides.tags ?? [],
    status: overrides.status ?? "review",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  } as RecallCard;
}

describe("cosineSimilarity", () => {
  test("相同向量相似度为 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  test("正交向量相似度为 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  test("缺失向量返回 0", () => {
    expect(cosineSimilarity(undefined, [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], undefined)).toBe(0);
    expect(cosineSimilarity(undefined, undefined)).toBe(0);
  });

  test("维度不一致返回 0", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  test("零向量返回 0", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });
});

describe("computeTextSimilarity", () => {
  test("完全相同的卡片相似度接近 1", () => {
    const a = makeCard({ front: "JavaScript 闭包", back: "闭包是函数及其词法环境" });
    const b = makeCard({ id: "card-2", front: "JavaScript 闭包", back: "闭包是函数及其词法环境" });
    expect(computeTextSimilarity(a, b)).toBeGreaterThan(0.9);
  });

  test("毫不相关的卡片相似度低", () => {
    const a = makeCard({ front: "HTTP 状态码", back: "200 表示成功" });
    const b = makeCard({ id: "card-2", front: "如何做番茄炒蛋", back: "先炒蛋再放番茄" });
    expect(computeTextSimilarity(a, b)).toBeLessThan(0.3);
  });

  test("结果始终在 [0, 1] 区间", () => {
    const a = makeCard();
    const b = makeCard({ id: "card-2", front: "闭包", back: "闭包" });
    const s = computeTextSimilarity(a, b);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe("computeTagBoost / computeScenarioBoost", () => {
  test("共享标签产生正向加成", () => {
    const a = makeCard({ tags: ["javascript", "面试"] });
    const b = makeCard({ id: "2", tags: ["javascript", "闭包"] });
    expect(computeTagBoost(a, b)).toBeGreaterThan(0);
  });

  test("无共享标签加成为 0", () => {
    const a = makeCard({ tags: ["css"] });
    const b = makeCard({ id: "2", tags: ["数据库"] });
    expect(computeTagBoost(a, b)).toBe(0);
  });

  test("同场景加成高于跨场景", () => {
    const a = makeCard({ scenario: "vocab" });
    const same = makeCard({ id: "2", scenario: "vocab" });
    const diff = makeCard({ id: "3", scenario: "interview" });
    expect(computeScenarioBoost(a, same)).toBeGreaterThan(computeScenarioBoost(a, diff));
  });
});
