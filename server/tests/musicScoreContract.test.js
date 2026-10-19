const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMusicScoreSession, expectedMusicScoreStep, recordMusicScoreEvent,
  approveMusicScoreTake, proposeMusicScoreWriteback, resumeMusicScoreSession,
} = require("../dist/services/novel/musicScore/musicScoreContract.js");

function fresh() {
  return createMusicScoreSession({
    sessionId: "run-1",
    novelId: "novel-1",
    chapterId: "chapter-1",
    baseChapterRevision: "revision-42",
    chapterContractRef: "chapter-contract-1",
    originalA: [{ sourceId: "book-a", location: "chapter-9:paragraphs-4-12", fingerprint: "source-v1" }],
  });
}

function record(session, status = "READY", returnTo) {
  const step = expectedMusicScoreStep(session);
  return recordMusicScoreEvent(session, {
    step,
    status,
    artifactRef: "artifact-" + step + "-" + session.events.length,
    sourceRefs: ["book-a:chapter-9:paragraphs-4-12"],
    baseChapterRevision: "revision-42",
    ...(step === "12" || step === "13" ? { unitId: "beat-1" } : {}),
    ...(returnTo ? { returnTo } : {}),
  });
}

test("requires actual A original anchors and a committed chapter contract", () => {
  assert.throws(() => createMusicScoreSession({
    ...fresh(), originalA: [],
  }), /A原著/);
  assert.throws(() => createMusicScoreSession({
    ...fresh(), chapterContractRef: "",
  }), /chapterContractRef/);
});

test("strict 07-16 sequence includes two different 08 passes", () => {
  let session = fresh();
  const order = ["07", "08:first-listen", "09", "08:score-listen", "10", "11", "12", "13", "14", "15", "16"];
  for (const step of order) {
    assert.equal(expectedMusicScoreStep(session), step);
    session = record(session);
  }
  assert.equal(session.state, "AWAITING_AUTHOR");
  assert.equal(session.events.length, 11);
  assert.throws(() => expectedMusicScoreStep(session), /暂停或等待作者/);
  assert.throws(() => proposeMusicScoreWriteback(session), /作者正文验收/);
});

test("does not accept stale chapter revision or skip a stage", () => {
  assert.throws(() => recordMusicScoreEvent(fresh(), {
    step: "13", status: "READY", artifactRef: "x",
    sourceRefs: ["a"], baseChapterRevision: "revision-42",
  }), /步骤次序错误/);
  assert.throws(() => recordMusicScoreEvent(fresh(), {
    step: "07", status: "READY", artifactRef: "x",
    sourceRefs: ["a"], baseChapterRevision: "stale",
  }), /正文版本已经变化/);
});

test("RETURN has a precise upstream position and reopens it", () => {
  let session = record(record(fresh()));
  assert.equal(expectedMusicScoreStep(session), "09");
  assert.throws(() => record(session, "RETURN", "13"), /只能回到/);
  assert.throws(() => record(session, "RETURN"), /必须给出/);
  session = record(session, "RETURN", "08:first-listen");
  assert.equal(expectedMusicScoreStep(session), "08:first-listen");
  assert.equal(session.events.at(-1).status, "RETURN");
});

test("BLOCKED and NEEDS_AUTHOR require explicit human resume", () => {
  const session = record(fresh(), "NEEDS_AUTHOR");
  assert.equal(session.state, "PAUSED");
  assert.throws(() => expectedMusicScoreStep(session), /暂停或等待作者/);
  assert.throws(() => resumeMusicScoreSession(session, false), /作者明确处理/);
  assert.equal(expectedMusicScoreStep(resumeMusicScoreSession(session, true)), "07");
});

test("17 returns a proposal only after author approves the exact 16 take", () => {
  let session = fresh();
  for (let i = 0; i < 11; i++) session = record(session);
  assert.throws(() => approveMusicScoreTake(session, {
    actor: "author", artifactRef: "not-16", baseChapterRevision: "revision-42",
  }), /并非16阶段产出/);
  const approvedRef = session.events.at(-1).artifactRef;
  session = approveMusicScoreTake(session, {
    actor: "author", artifactRef: approvedRef, baseChapterRevision: "revision-42",
  });
  const proposal = proposeMusicScoreWriteback(session);
  assert.equal(proposal.pointerUpdate, "PROPOSE_ONLY");
  assert.equal(proposal.approvedContentRef, approvedRef);
  assert.equal(proposal.baseChapterRevision, "revision-42");
});


test("10 per person and 12 per section may repeat without advancing the whole stage", () => {
  let session = fresh();
  for (let i = 0; i < 4; i++) session = record(session); // at 10
  assert.equal(expectedMusicScoreStep(session), "10");
  session = recordMusicScoreEvent(session, {
    step: "10", status: "READY", artifactRef: "char-a",
    sourceRefs: ["A", "B-character-a"], unitId: "character-a",
    continueSameStep: true, baseChapterRevision: "revision-42",
  });
  assert.equal(expectedMusicScoreStep(session), "10");
  assert.throws(() => recordMusicScoreEvent(session, {
    step: "10", status: "READY", artifactRef: "char-a-again",
    sourceRefs: ["A"], unitId: "character-a",
    continueSameStep: true, baseChapterRevision: "revision-42",
  }), /不得重复消费/);
  session = recordMusicScoreEvent(session, {
    step: "10", status: "READY", artifactRef: "char-b",
    sourceRefs: ["A", "B-character-b"], unitId: "character-b",
    baseChapterRevision: "revision-42",
  });
  assert.equal(expectedMusicScoreStep(session), "11");
  session = record(session); // at 12
  session = recordMusicScoreEvent(session, {
    step: "12", status: "READY", artifactRef: "beat-1",
    sourceRefs: ["B-score"], unitId: "beat-1",
    continueSameStep: true, baseChapterRevision: "revision-42",
  });
  assert.equal(expectedMusicScoreStep(session), "12");
});


test("12 then 13 can repeat per new beat; an actor cannot consume an uncompiled beat", () => {
  let session = fresh();
  for (let i = 0; i < 6; i++) session = record(session); // now 12
  assert.equal(expectedMusicScoreStep(session), "12");
  session = recordMusicScoreEvent(session, {
    step: "12", status: "READY", artifactRef: "actor-packet-1",
    sourceRefs: ["A", "scene-score"], unitId: "beat-1",
    baseChapterRevision: "revision-42",
  });
  assert.equal(expectedMusicScoreStep(session), "13");
  assert.throws(() => recordMusicScoreEvent(session, {
    step: "13", status: "READY", artifactRef: "illegal-actor-output",
    sourceRefs: ["A", "actor-packet"], unitId: "beat-2",
    continueSameStep: true, baseChapterRevision: "revision-42",
  }), /需要先完成相同小节/);
  session = recordMusicScoreEvent(session, {
    step: "13", status: "READY", artifactRef: "prose-beat-1",
    sourceRefs: ["actor-packet-1"], unitId: "beat-1",
    continueSameStep: true, baseChapterRevision: "revision-42",
  });
  assert.equal(expectedMusicScoreStep(session), "12");
  session = recordMusicScoreEvent(session, {
    step: "12", status: "READY", artifactRef: "actor-packet-2",
    sourceRefs: ["A", "scene-score"], unitId: "beat-2",
    baseChapterRevision: "revision-42",
  });
  session = recordMusicScoreEvent(session, {
    step: "13", status: "READY", artifactRef: "prose-beat-2",
    sourceRefs: ["actor-packet-2"], unitId: "beat-2",
    baseChapterRevision: "revision-42",
  });
  assert.equal(expectedMusicScoreStep(session), "14");
});
