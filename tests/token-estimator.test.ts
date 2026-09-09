/**
 * TokenEstimator 单元测试（纯函数，无外部依赖）
 */
import { TokenEstimator } from "../src/modules/retrieve/token-estimator";

describe("TokenEstimator.estimate", () => {
  test("空文本为 0", () => {
    expect(TokenEstimator.estimate("")).toBe(0);
  });

  test("中文按每字约 1.5 token 估算", () => {
    // 10 个中文字 → 15 tokens
    expect(TokenEstimator.estimate("一二三四五六七八九十")).toBe(15);
  });

  test("英文按每词约 1.3 token 估算", () => {
    // 10 个英文单词 → 13 tokens
    const text = "one two three four five six seven eight nine ten";
    expect(TokenEstimator.estimate(text)).toBe(13);
  });

  test("结果为向上取整的正整数", () => {
    const n = TokenEstimator.estimate("hello 世界");
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThan(0);
  });
});

describe("TokenEstimator.estimateBatch", () => {
  test("批量估算等于各项之和", () => {
    const texts = ["一二三四", "hello world", "知识库"];
    const sum = texts.reduce((s, t) => s + TokenEstimator.estimate(t), 0);
    expect(TokenEstimator.estimateBatch(texts)).toBe(sum);
  });

  test("空数组为 0", () => {
    expect(TokenEstimator.estimateBatch([])).toBe(0);
  });
});

describe("TokenEstimator.estimateCost", () => {
  test("按每百万 token 计价", () => {
    expect(TokenEstimator.estimateCost(1_000_000, 5)).toBeCloseTo(5, 6);
    expect(TokenEstimator.estimateCost(500_000, 4)).toBeCloseTo(2, 6);
    expect(TokenEstimator.estimateCost(0, 10)).toBe(0);
  });
});
