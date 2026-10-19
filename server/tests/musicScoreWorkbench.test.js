const test = require("node:test");
const assert = require("node:assert/strict");
const { getRegisteredPromptAsset } = require("../dist/prompting/registry.js");
const {
  getOfficialPromptTemplate, getRequiredTemplateContextGroups,
} = {
  ...require("../dist/prompting/templates/officialTemplates.js"),
  ...require("../dist/prompting/templates/templateTypes.js"),
};
const { compilePromptTemplate } = require("../dist/prompting/templates/templateCompiler.js");
const { MUSIC_SCORE_OFFICIAL_PROMPTS } = require("../dist/prompting/prompts/musicScore/musicScoreOfficialSources.js");

const ids = ["07","08","09","10","11","12","13","14","15","16","17"];

test("all 11 source-preserved official stages register in native prompt workbench", () => {
  for (const id of ids) {
    const promptId = "thirdgen.music." + id;
    const asset = getRegisteredPromptAsset(promptId, "v0.3");
    assert.ok(asset, "missing registered stage " + id);
    assert.equal(asset.management.editModes.includes("advanced_template"), true);
    const official = getOfficialPromptTemplate(promptId);
    assert.ok(official);
    assert.equal(official.messages[0].content, MUSIC_SCORE_OFFICIAL_PROMPTS[id]);
    assert.deepEqual(getRequiredTemplateContextGroups(promptId), []);
  }
});

test("editable music stage compiles a custom system body and stage handoff input", () => {
  const asset = getRegisteredPromptAsset("thirdgen.music.13", "v0.3");
  const custom = {
    kind: "chat",
    messages: [
      { role: "system", content: "【编辑版】只写合法当前小节正文，不读取别人的后台。" },
      { role: "human", content: "{{input.stageMaterial}}" },
    ],
  };
  const compiled = compilePromptTemplate({
    template: custom,
    promptInput: { stageMaterial: "【当前小节演奏包】赵元任读稿\n【正文接缝】" },
    context: { blocks: [], selectedBlockIds: [], droppedBlockIds: [],
      summarizedBlockIds: [], estimatedInputTokens: 0 },
    slotDefs: [], allowedContextGroups: [], requiredContextGroups: [],
  });
  assert.deepEqual(compiled.diagnostics.invalidMessages, []);
  assert.deepEqual(compiled.diagnostics.missingRequiredGroups, []);
  assert.ok(compiled.messages[0].content.includes("【编辑版】"));
  assert.ok(compiled.messages[1].content.includes("赵元任读稿"));
  assert.equal(asset.mode, "text");
});

test("13 actor official prompt is preserved and does not import control-room rules automatically", () => {
  const stage = MUSIC_SCORE_OFFICIAL_PROMPTS["13"];
  assert.ok(stage.includes("isolated-performer"));
  assert.ok(stage.includes("input_contract"));
  assert.ok(!stage.includes("00-共同审美契约.md"));
});
