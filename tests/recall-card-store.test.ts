import { RecallCardStore, isNewRecallCard } from "../src/modules/recall/core/recall-card-store";
import { RecallCard, SRSData } from "../src/core/types";

const today = new Date().toISOString().slice(0, 10);
const srs: SRSData = { algorithm: "sm2", interval: 1, repetitions: 0, easeFactor: 2.5,
  stability: 1, difficulty: 1, nextReview: "9999-01-01", lastReview: today, lastRating: 1 };
function card(id: string, overrides: Partial<RecallCard> = {}): RecallCard {
  return { id, scenario: "wiki", status: "new", srs: { ...srs }, ...overrides } as RecallCard;
}

test("遗忘的旧卡片遵守到期日和复习限额，不占新卡额度", async () => {
  const store = new RecallCardStore({} as any, () => "");
  const fresh = card("fresh", { srs: { ...srs, lastReview: "" } });
  const future = card("future"); // 旧版本遗忘后保存为 new
  const due = card("due", { srs: { ...srs, nextReview: today } });
  const suspended = card("suspended", { status: "suspended" });
  jest.spyOn(store, "loadScenario").mockResolvedValue([fresh, future, due, suspended]);
  expect(isNewRecallCard(future)).toBe(false);
  expect((await store.getDueCards("wiki", { newLimit: 1, reviewLimit: 1 })).map(c => c.id)).toEqual(["due", "fresh"]);
  expect((await store.getDueCards("wiki", { includeNew: false })).map(c => c.id)).toEqual(["due"]);
  expect(await store.getScenarioStats("wiki")).toMatchObject({ newCount: 1, dueCount: 1, suspendedCount: 1 });
});

test("复习失败后状态为学习中", async () => {
  const store = new RecallCardStore({} as any, () => "");
  jest.spyOn(store, "saveCard").mockResolvedValue();
  const original = card("a", { stats: { totalReviews: 0, correctCount: 0, wrongCount: 0, avgResponseTimeMs: 0, streak: 0 } });
  const updated = await store.updateAfterReview(original, srs, 1, 100);
  expect(updated.status).toBe("learning");
});
