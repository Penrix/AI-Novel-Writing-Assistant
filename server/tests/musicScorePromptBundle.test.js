const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  loadMusicScorePromptSet, promptIdForMusicStep,
} = require("../dist/services/novel/musicScore/musicScorePromptBundle.js");

async function withPromptDir(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "music-score-test-"));
  try {
    for (let id = 7; id <= 17; id++) {
      const key = String(id).padStart(2, "0");
      await fs.writeFile(path.join(root, key + "-prompt.md"),
        "version: 0.4.0-source-rebuilt\n# Prompt " + key + "\n" + "实际正文参照A；".repeat(20));
    }
    return await callback(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("imports eleven version-pinned v0.4 prompts, maps both 08 passes", async () => {
  await withPromptDir(async (root) => {
    const result = await loadMusicScorePromptSet(root);
    assert.equal(Object.keys(result).length, 11);
    assert.equal(result["07"].version, "0.4.0-source-rebuilt");
    assert.equal(result["16"].sha256.length, 64);
    assert.equal(promptIdForMusicStep("08:first-listen"), "08");
    assert.equal(promptIdForMusicStep("08:score-listen"), "08");
  });
});

test("missing stages and old prompt versions fail closed", async () => {
  await withPromptDir(async (root) => {
    await fs.rm(path.join(root, "13-prompt.md"));
    await assert.rejects(loadMusicScorePromptSet(root), /13必须/);
  });
  await withPromptDir(async (root) => {
    await fs.writeFile(path.join(root, "10-prompt.md"), "version: 0.2\n" + "旧版".repeat(100));
    await assert.rejects(loadMusicScorePromptSet(root), /10版本不符/);
  });
});
