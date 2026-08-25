import { describe, expect, it } from "vitest";
import { reviewArmOrder } from "../../evals/dream-agent/prepare-review";

describe("dream agent blind-review randomization", () => {
  it("is deterministic within a round and changes assignments across rounds", () => {
    const ids = Array.from({ length: 20 }, (_, index) => `case-${index + 1}`);
    const roundOne = ids.map((id) => reviewArmOrder(id, "round-1"));
    const repeated = ids.map((id) => reviewArmOrder(id, "round-1"));
    const roundTwo = ids.map((id) => reviewArmOrder(id, "round-2"));
    expect(repeated).toEqual(roundOne);
    expect(roundTwo.some((order, index) => order[0] !== roundOne[index][0])).toBe(true);
  });
});
