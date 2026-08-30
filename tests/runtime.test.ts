import { describe, expect, test } from "bun:test";
import { planAttempts } from "../src/application/planning";
import { Scheduler } from "../src/application/scheduler";

describe("execution planning", () => {
  test("expands each case/trial into isolated X and Y attempts", () => {
    const result = planAttempts([{ id: "one", prompt: "p", cwd: "/tmp/a" }], { provider: "claude", model: "a" }, { provider: "codex", model: "b" }, 2);
    expect(result.map((item) => item.id)).toEqual(["one:1:x", "one:1:y", "one:2:x", "one:2:y"]);
  });

  test("enforces scheduler concurrency", async () => {
    const scheduler = new Scheduler({ concurrency: 2 });
    let active = 0;
    let maximum = 0;
    await Promise.all(Array.from({ length: 6 }, (_, index) => scheduler.add(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return index;
    })));
    expect(maximum).toBe(2);
  });
});
