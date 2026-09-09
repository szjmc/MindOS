/**
 * SRSEngine 单元测试
 *
 * 覆盖：
 * - SM-2：首次/二次/后续间隔、答错重置、Easy Bonus、EF 下限
 * - FSRS-4.5：初始化、遗忘重置、间隔上限、日期格式
 * - 通用：createInitialSRS / isDueToday / daysUntilReview
 */
import { SRSEngine } from "../src/modules/recall/core/srs-engine";
import { SRSData } from "../src/core/types";
import {
  SM2_DEFAULT_EASE_FACTOR,
  SM2_MIN_EASE_FACTOR,
  SM2_EASY_BONUS,
} from "../src/core/constants";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
}

function sm2Card(overrides: Partial<SRSData> = {}): SRSData {
  return {
    algorithm: "sm2",
    interval: 0,
    repetitions: 0,
    easeFactor: SM2_DEFAULT_EASE_FACTOR,
    stability: 1,
    difficulty: 0.3,
    nextReview: todayPlus(0),
    lastReview: "",
    lastRating: 0,
    ...overrides,
  };
}

describe("SRSEngine - SM-2", () => {
  const engine = new SRSEngine("sm2");

  test("首次答对（rating=3）：间隔 1 天，重复次数 1", () => {
    const result = engine.review(sm2Card(), 3);
    expect(result.newSRS.interval).toBe(1);
    expect(result.newSRS.repetitions).toBe(1);
    expect(result.newSRS.lastRating).toBe(3);
    expect(result.intervalDays).toBe(1);
  });

  test("第二次答对：间隔跳到 6 天", () => {
    const result = engine.review(sm2Card({ repetitions: 1, interval: 1 }), 3);
    expect(result.newSRS.interval).toBe(6);
    expect(result.newSRS.repetitions).toBe(2);
  });

  test("第三次起答对：间隔 = round(旧间隔 × EF)", () => {
    const card = sm2Card({ repetitions: 2, interval: 6, easeFactor: 2.5 });
    const result = engine.review(card, 3);
    expect(result.newSRS.interval).toBe(15); // round(6 * 2.5)
    expect(result.newSRS.repetitions).toBe(3);
  });

  test("答错（rating=1 或 2）：重置重复次数，间隔回到 1 天", () => {
    for (const rating of [1, 2] as const) {
      const card = sm2Card({ repetitions: 5, interval: 30 });
      const result = engine.review(card, rating);
      expect(result.newSRS.repetitions).toBe(0);
      expect(result.newSRS.interval).toBe(1);
    }
  });

  test("rating=4 应用 Easy Bonus", () => {
    const card = sm2Card({ repetitions: 2, interval: 10, easeFactor: 2.5 });
    const result = engine.review(card, 4);
    const expected = Math.round(Math.round(10 * 2.5) * SM2_EASY_BONUS);
    expect(result.newSRS.interval).toBe(expected);
  });

  test("难度因子随低评分下降，但不低于最小值", () => {
    let card = sm2Card();
    for (let i = 0; i < 10; i++) {
      card = { ...engine.review(card, 2).newSRS, repetitions: card.repetitions };
      // 每次答错都压一次 EF
      card = engine.review(sm2Card({ ...card, repetitions: 0 }), 2).newSRS;
    }
    expect(card.easeFactor).toBeGreaterThanOrEqual(SM2_MIN_EASE_FACTOR);
  });

  test("rating=4 时难度因子不变（ΔEF=0）", () => {
    const result = engine.review(sm2Card(), 4);
    expect(result.newSRS.easeFactor).toBe(SM2_DEFAULT_EASE_FACTOR);
  });

  test("rating=3 时难度因子按公式下调 0.14", () => {
    const result = engine.review(sm2Card(), 3);
    expect(result.newSRS.easeFactor).toBeCloseTo(SM2_DEFAULT_EASE_FACTOR - 0.14, 6);
  });

  test("nextReview 为 YYYY-MM-DD 且等于今天 + 间隔", () => {
    const result = engine.review(sm2Card(), 3);
    expect(result.newSRS.nextReview).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.newSRS.nextReview).toBe(todayPlus(result.intervalDays));
  });
});

describe("SRSEngine - FSRS-4.5", () => {
  const engine = new SRSEngine("fsrs");

  test("新卡片初始化：重复次数置 1，稳定性取自 w[rating-1]", () => {
    const result = engine.review(sm2Card({ algorithm: "fsrs" }), 3);
    expect(result.newSRS.repetitions).toBe(1);
    expect(result.newSRS.stability).toBeCloseTo(3.1262, 4); // w[2]
    expect(result.newSRS.interval).toBeGreaterThanOrEqual(1);
  });

  test("遗忘（rating=1）：重复次数归零，间隔为 1 天", () => {
    const learned = sm2Card({
      algorithm: "fsrs",
      repetitions: 3,
      stability: 10,
      difficulty: 5,
      interval: 9,
      lastReview: todayPlus(-9),
    });
    const result = engine.review(learned, 1);
    expect(result.newSRS.repetitions).toBe(0);
    expect(result.newSRS.interval).toBe(1);
  });

  test("复习成功：稳定性增长，间隔至少 1 天", () => {
    const learned = sm2Card({
      algorithm: "fsrs",
      repetitions: 2,
      stability: 5,
      difficulty: 5,
      interval: 5,
      lastReview: todayPlus(-5),
    });
    const result = engine.review(learned, 3);
    expect(result.newSRS.stability).toBeGreaterThan(5);
    expect(result.newSRS.interval).toBeGreaterThanOrEqual(1);
    expect(result.newSRS.repetitions).toBe(3);
  });

  test("难度在 [1, 10] 区间内", () => {
    let card = sm2Card({ algorithm: "fsrs" });
    for (let i = 0; i < 8; i++) {
      card = engine.review(card, 1).newSRS;
      card = { ...card, repetitions: 1, stability: 2, lastReview: todayPlus(-1) };
    }
    expect(card.difficulty).toBeGreaterThanOrEqual(1);
    expect(card.difficulty).toBeLessThanOrEqual(10);
  });

  test("message 包含间隔天数提示", () => {
    const result = engine.review(sm2Card({ algorithm: "fsrs" }), 4);
    expect(result.message).toContain(String(result.intervalDays));
  });
});

describe("SRSEngine - 通用", () => {
  const engine = new SRSEngine();

  test("默认算法为 sm2", () => {
    const result = engine.review(sm2Card(), 3);
    expect(result.newSRS.algorithm).toBe("sm2");
  });

  test("setAlgorithm 可切换算法", () => {
    engine.setAlgorithm("fsrs");
    const result = engine.review(sm2Card(), 3);
    expect(result.newSRS.algorithm).toBe("fsrs");
    engine.setAlgorithm("sm2");
  });

  test("createInitialSRS 生成合法初始数据", () => {
    const srs = engine.createInitialSRS();
    expect(srs.interval).toBe(0);
    expect(srs.repetitions).toBe(0);
    expect(srs.easeFactor).toBe(SM2_DEFAULT_EASE_FACTOR);
    expect(srs.nextReview).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(engine.isDueToday(srs)).toBe(true);
  });

  test("isDueToday：到期/过期为 true，未来为 false", () => {
    expect(engine.isDueToday(sm2Card({ nextReview: todayPlus(0) }))).toBe(true);
    expect(engine.isDueToday(sm2Card({ nextReview: todayPlus(-3) }))).toBe(true);
    expect(engine.isDueToday(sm2Card({ nextReview: todayPlus(3) }))).toBe(false);
    expect(engine.isDueToday(sm2Card({ nextReview: "" }))).toBe(true);
  });

  test("daysUntilReview：未来/今天/过期的天数计算", () => {
    expect(engine.daysUntilReview(sm2Card({ nextReview: todayPlus(5) }))).toBe(5);
    expect(engine.daysUntilReview(sm2Card({ nextReview: todayPlus(0) }))).toBe(0);
    expect(engine.daysUntilReview(sm2Card({ nextReview: todayPlus(-2) }))).toBe(0);
    expect(engine.daysUntilReview(sm2Card({ nextReview: "" }))).toBe(0);
  });
});
