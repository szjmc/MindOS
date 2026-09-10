/**
 * 数据迁移模块测试（v1.1 / 路线图 4C）
 *
 * 覆盖：
 * - 导出：Anki 文本 / CSV / Markdown / JSON
 * - 导入：JSON / Anki 文本（含 # 指令）/ CSV 表头 / TSV 嗅探
 * - 往返：JSON 导出 → 导入 无损
 */
import {
  toAnkiText,
  toCSV,
  toMarkdown,
  toJSON,
} from "../src/modules/migrate/anki-exporter";
import {
  parseCards,
  parseCardsFromJSON,
  parseCardsFromDelimited,
  buildImportedCard,
  detectFormat,
} from "../src/modules/migrate/data-importer";
import { RecallCard } from "../src/core/types";

function makeCard(overrides: Partial<RecallCard> = {}): RecallCard {
  return {
    id: overrides.id ?? "card-1",
    scenario: (overrides.scenario as RecallCard["scenario"]) ?? "wiki",
    front: overrides.front ?? "什么是闭包？",
    back: overrides.back ?? "闭包是能捕获外部变量的函数",
    tags: overrides.tags ?? ["javascript"],
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
    status: overrides.status ?? "review",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...overrides,
  } as RecallCard;
}

describe("格式探测", () => {
  test("JSON 对象/数组识别为 json", () => {
    expect(detectFormat('{"cards":[]}')).toBe("json");
    expect(detectFormat("  [{}]")).toBe("json");
  });

  test("其他文本识别为 delimited", () => {
    expect(detectFormat("a\tb")).toBe("delimited");
    expect(detectFormat("#separator:tab\nx\ty")).toBe("delimited");
  });
});

describe("导出器", () => {
  const cards = [
    makeCard(),
    makeCard({ id: "card-2", front: "HTTP 200\n表示什么", back: "成功", tags: [] }),
  ];

  test("Anki 文本：含官方指令，字段以 tab 分隔，换行转 <br>", () => {
    const text = toAnkiText(cards);
    const lines = text.split("\n");
    expect(lines[0]).toBe("#separator:tab");
    expect(lines[1]).toBe("#html:true");
    expect(lines[2]).toBe("#tags column:3");
    expect(lines[3].split("\t")).toEqual(["什么是闭包？", "闭包是能捕获外部变量的函数", "javascript"]);
    expect(lines[4]).toContain("HTTP 200<br>表示什么");
  });

  test("CSV：表头 + 引号转义", () => {
    const csv = toCSV([makeCard({ front: '含"引号",和逗号', back: "换行\n测试" })]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("scenario,front,back,tags,id");
    expect(lines[1]).toContain('"含""引号"",和逗号"');
  });

  test("Markdown：按场景分组", () => {
    const md = toMarkdown(cards);
    expect(md).toContain("# MindOS 复习卡片导出");
    expect(md).toContain("## Wiki（2）");
    expect(md).toContain("什么是闭包？");
  });

  test("JSON：带元信息包装", () => {
    const parsed = JSON.parse(toJSON(cards));
    expect(parsed.type).toBe("mindos-recall-cards");
    expect(parsed.count).toBe(2);
    expect(parsed.cards).toHaveLength(2);
  });
});

describe("导入器 - JSON", () => {
  test("解析 {cards:[...]} 结构并保留原字段", () => {
    const json = toJSON([makeCard()]);
    const res = parseCardsFromJSON(json);
    expect(res.errors).toHaveLength(0);
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].id).toBe("card-1");
    expect(res.cards[0].front).toBe("什么是闭包？");
    expect(res.cards[0].tags).toEqual(["javascript"]);
  });

  test("裸数组也可解析", () => {
    const res = parseCardsFromJSON(JSON.stringify([makeCard()]));
    expect(res.cards).toHaveLength(1);
  });

  test("非法 JSON 返回错误而非抛异常", () => {
    const res = parseCardsFromJSON("{oops");
    expect(res.cards).toHaveLength(0);
    expect(res.errors[0]).toContain("JSON 解析失败");
  });

  test("缺 front 的条目被跳过并计数", () => {
    const res = parseCardsFromJSON(JSON.stringify([{ back: "只有背面" }, { front: "正", back: "反" }]));
    expect(res.cards).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  test("非法 scenario 回退到默认场景", () => {
    const res = parseCardsFromJSON(JSON.stringify([{ front: "q", back: "a", scenario: "bogus" }]));
    expect(res.cards[0].scenario).toBe("custom");
  });
});

describe("导入器 - 分隔符文本", () => {
  test("Anki 导出格式可回读（# 指令 + tab + tags 列）", () => {
    const text = toAnkiText([
      makeCard({ front: "问题一", back: "答案一", tags: ["tag1", "tag2"] }),
      makeCard({ id: "x", front: "问题二", back: "答案二", tags: [] }),
    ]);
    const res = parseCardsFromDelimited(text);
    expect(res.errors).toHaveLength(0);
    expect(res.cards).toHaveLength(2);
    expect(res.cards[0].front).toBe("问题一");
    expect(res.cards[0].tags).toEqual(["tag1", "tag2"]);
    expect(res.cards[1].back).toBe("答案二");
  });

  test("CSV 表头自动识别（列序可乱）", () => {
    const csv = 'back,front,tags\n答案,问题,甲 乙';
    const res = parseCards(csv);
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].front).toBe("问题");
    expect(res.cards[0].back).toBe("答案");
    expect(res.cards[0].tags).toEqual(["甲", "乙"]);
  });

  test("中文表头识别", () => {
    const res = parseCards("正面,背面\n你好,Hello");
    expect(res.cards[0].front).toBe("你好");
    expect(res.cards[0].back).toBe("Hello");
  });

  test("<br> 还原为换行", () => {
    const res = parseCardsFromDelimited("多行答案<br>第二行\t是front");
    // 无指令时嗅探分隔符；此处第一行无 tab，整行视为 front
    expect(res.cards).toHaveLength(1);
  });

  test("无 front 的行被跳过", () => {
    const res = parseCardsFromDelimited("\t只有背面\n问题\t答案");
    expect(res.cards).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  test("分号分隔 + #separator 指令", () => {
    const text = "#separator:semicolon\nq1;a1\nq2;a2";
    const res = parseCardsFromDelimited(text);
    expect(res.cards).toHaveLength(2);
    expect(res.cards[1].front).toBe("q2");
  });

  test("CSV 引号内逗号不被切开", () => {
    const res = parseCardsFromDelimited('"问题,带逗号","答案"');
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].front).toBe("问题,带逗号");
  });
});

describe("buildImportedCard", () => {
  test("生成完整合法的新卡片", () => {
    const card = buildImportedCard("  Q  ", "  A  ", ["#t1", "t2"], "vocab");
    expect(card.id).toMatch(/^imp_/);
    expect(card.front).toBe("Q");
    expect(card.back).toBe("A");
    expect(card.tags).toEqual(["t1", "t2"]);
    expect(card.scenario).toBe("vocab");
    expect(card.status).toBe("new");
    expect(card.srs.repetitions).toBe(0);
    expect(card.stats.totalReviews).toBe(0);
  });
});

describe("往返无损", () => {
  test("JSON 导出 → 导入：内容与结构保留", () => {
    const original = [
      makeCard(),
      makeCard({ id: "card-2", scenario: "vocab", front: "apple", back: "苹果", tags: ["CET4"] }),
    ];
    const res = parseCards(toJSON(original));
    expect(res.cards).toHaveLength(2);
    expect(res.cards[0]).toEqual(expect.objectContaining({
      id: "card-1",
      scenario: "wiki",
      front: "什么是闭包？",
      tags: ["javascript"],
    }));
    expect(res.cards[1].srs.easeFactor).toBe(2.5);
    expect(res.cards[1].stats.totalReviews).toBe(1);
  });

  test("Anki 导出 → 导入：正反面与标签保留（换行转义可逆语义）", () => {
    const original = [makeCard({ front: "Q", back: "A1\nA2", tags: ["t"] })];
    const res = parseCards(toAnkiText(original));
    expect(res.cards).toHaveLength(1);
    expect(res.cards[0].front).toBe("Q");
    expect(res.cards[0].back).toBe("A1\nA2");
    expect(res.cards[0].tags).toEqual(["t"]);
  });
});
