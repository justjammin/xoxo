import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("keeps the lockfile compatible with the declared Bun 1.2 minimum", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { engines?: { bun?: string } };
  const lockfile = await readFile(new URL("../bun.lock", import.meta.url), "utf8");

  expect(packageJson.engines?.bun).toBe(">=1.2.0");
  expect(lockfile).toMatch(/^\{\n  "lockfileVersion": 1,/);
});
