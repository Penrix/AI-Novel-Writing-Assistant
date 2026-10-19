/**
 * Music-score prose production boundary (07-17).
 *
 * This is an opt-in, pure state machine. It never calls a model, changes a
 * chapter, advances the A pointer, or alters the ordinary director/writer.
 * Import the actual approved prompts separately; do not fabricate them here.
 */
export const MUSIC_SCORE_STEPS = [
  "07", "08:first-listen", "09", "08:score-listen", "10", "11",
  "12", "13", "14", "15", "16", "17",
] as const;

export type MusicScoreStep = typeof MUSIC_SCORE_STEPS[number];
export type MusicScoreStatus = "READY" | "RETURN" | "BLOCKED" | "NEEDS_AUTHOR";

export interface MusicScoreAnchor {
  sourceId: string; // A original text, not a model-produced summary
  location: string; // chapter / section / line range resolvable by the app
  fingerprint: string; // immutable source revision or content digest
}

export interface MusicScoreStart {
  sessionId: string;
  novelId: string;
  chapterId: string;
  baseChapterRevision: string;
  chapterContractRef: string; // existing plot & chapter obligations, read-only
  originalA: MusicScoreAnchor[];
}

export interface MusicScoreEvent {
  step: MusicScoreStep;
  attempt: number;
  status: MusicScoreStatus;
  artifactRef: string;
  sourceRefs: string[];
  returnTo?: MusicScoreStep;
  note?: string;
  unitId?: string; // participant for 10 / current section for 12
}

export interface MusicScoreApproval {
  actor: "author";
  artifactRef: string;
  baseChapterRevision: string;
}

export interface MusicScoreSession extends MusicScoreStart {
  nextStepIndex: number;
  state: "RUNNING" | "PAUSED" | "AWAITING_AUTHOR" | "READY_TO_PROPOSE_WRITEBACK";
  events: MusicScoreEvent[];
  approval?: MusicScoreApproval;
}

function nonempty(value: string | undefined, field: string): string {
  if (!value?.trim()) throw new Error("音乐缩谱缺少：" + field);
  return value.trim();
}

export function createMusicScoreSession(input: MusicScoreStart): MusicScoreSession {
  nonempty(input.sessionId, "sessionId");
  nonempty(input.novelId, "novelId");
  nonempty(input.chapterId, "chapterId");
  nonempty(input.baseChapterRevision, "baseChapterRevision");
  nonempty(input.chapterContractRef, "chapterContractRef");
  if (!Array.isArray(input.originalA) || input.originalA.length === 0) {
    throw new Error("必须提供可定位的A原著正文；拆书摘要或文风标签不能代替。");
  }
  for (const a of input.originalA) {
    nonempty(a.sourceId, "A来源");
    nonempty(a.location, "A原文位置");
    nonempty(a.fingerprint, "A来源版本");
  }
  return {
    ...input,
    originalA: input.originalA.map((item) => ({ ...item })),
    nextStepIndex: 0,
    state: "RUNNING",
    events: [],
  };
}

export function expectedMusicScoreStep(session: MusicScoreSession): MusicScoreStep {
  if (session.state !== "RUNNING") {
    throw new Error("当前音乐缩谱流程已暂停或等待作者，不得自动继续。");
  }
  const step = MUSIC_SCORE_STEPS[session.nextStepIndex];
  if (!step || step === "17") {
    throw new Error("写回必须先有作者验收，不得自动执行17。");
  }
  return step;
}

/**
 * Each READY carries a stable artifact reference, never a bare "success".
 * RETURN must identify its exact upstream position; there are two 08 passes.
 * No downstream stage may silently repair an earlier stage's decision.
 */
export function recordMusicScoreEvent(
  session: MusicScoreSession,
  input: Omit<MusicScoreEvent, "attempt"> & { baseChapterRevision: string; continueSameStep?: boolean },
): MusicScoreSession {
  const step = expectedMusicScoreStep(session);
  if (input.step !== step) throw new Error("音乐缩谱步骤次序错误，当前应为 " + step);
  if (input.baseChapterRevision !== session.baseChapterRevision) {
    throw new Error("本章正文版本已经变化；必须重新核对上下文，不得覆盖。");
  }
  if (input.continueSameStep && (input.status !== "READY" || (step !== "10" && step !== "13"))) {
    throw new Error("只有10人物分谱可继续同工序，13演完一小节后可返回12编译下一小节。");
  }
  if (input.continueSameStep) nonempty(input.unitId, "当前人物或小节标识");
  if (step === "12" && input.status === "READY") {
    nonempty(input.unitId, "12当前小节标识");
  }
  if (step === "13" && input.status === "READY") {
    const beatId = nonempty(input.unitId, "13本小节标识");
    const hasCompiledBeat = session.events.some((event) =>
      event.step === "12" && event.unitId === beatId && event.status === "READY");
    if (!hasCompiledBeat) throw new Error("13需要先完成相同小节的12演员包，不得跳过局部编译。");
  }
  if (input.unitId && session.events.some((item) => item.step === step && item.unitId === input.unitId && item.status === "READY")) {
    throw new Error("本工序已验收相同人物或小节，不得重复消费。");
  }
  if (input.status !== "RETURN" && input.returnTo) {
    throw new Error("只有RETURN可以指定上游目标。");
  }
  nonempty(input.artifactRef, "阶段完整产物引用");
  if (!Array.isArray(input.sourceRefs) || input.sourceRefs.length === 0) {
    throw new Error("阶段产物必须标明所用原著或上游产物来源。");
  }
  const event: MusicScoreEvent = {
    step: input.step,
    attempt: session.events.filter((item) => item.step === step).length + 1,
    status: input.status,
    artifactRef: input.artifactRef,
    sourceRefs: [...input.sourceRefs],
    ...(input.returnTo ? { returnTo: input.returnTo } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.unitId ? { unitId: input.unitId } : {}),
  };
  const next: MusicScoreSession = {
    ...session,
    events: [...session.events, event],
  };
  if (input.status === "READY") {
    if (step === "13" && input.continueSameStep) {
      next.nextStepIndex = MUSIC_SCORE_STEPS.indexOf("12"); // next beat needs a fresh actor packet
    } else if (!input.continueSameStep) {
      next.nextStepIndex += 1;
    }
    if (step === "16") next.state = "AWAITING_AUTHOR";
  } else if (input.status === "RETURN") {
    if (!input.returnTo) throw new Error("RETURN必须给出具体的上游步骤。");
    const index = MUSIC_SCORE_STEPS.indexOf(input.returnTo);
    if (index < 0 || index >= session.nextStepIndex) {
      throw new Error("RETURN只能回到真正的上游工序，不能向前跳或回到本工序。");
    }
    next.nextStepIndex = index;
  } else {
    if (input.returnTo) throw new Error("非RETURN状态不应指定回退目标。");
    next.state = "PAUSED";
  }
  return next;
}

/** A PAUSED session cannot be unlocked by a model response alone. */
export function resumeMusicScoreSession(
  session: MusicScoreSession,
  acceptedByAuthor: boolean,
): MusicScoreSession {
  if (session.state !== "PAUSED" || !acceptedByAuthor) {
    throw new Error("暂停状态需要作者明确处理后才能恢复。");
  }
  return { ...session, state: "RUNNING" };
}

/**
 * The approved take is NOT committed here. Revision checks must also be
 * performed against the live chapter at the eventual write boundary.
 */
export function approveMusicScoreTake(
  session: MusicScoreSession,
  approval: MusicScoreApproval,
): MusicScoreSession {
  if (session.state !== "AWAITING_AUTHOR" || session.nextStepIndex !== MUSIC_SCORE_STEPS.length - 1) {
    throw new Error("16未完成，不能申请正文验收或进入17。");
  }
  if (approval.actor !== "author") throw new Error("正文批准权属于作者。");
  if (approval.baseChapterRevision !== session.baseChapterRevision) {
    throw new Error("验收针对的正文版本已变化。");
  }
  const last = session.events.at(-1);
  if (!last || last.step !== "16" || last.status !== "READY") {
    throw new Error("缺少通过的16阶段正文产物。");
  }
  if (approval.artifactRef !== last.artifactRef) {
    throw new Error("不能批准并非16阶段产出的正文版本。");
  }
  return {
    ...session,
    approval: { ...approval },
    state: "READY_TO_PROPOSE_WRITEBACK",
  };
}

export interface MusicScoreWritebackProposal {
  novelId: string;
  chapterId: string;
  baseChapterRevision: string;
  approvedContentRef: string;
  aSourceRefs: MusicScoreAnchor[];
  stageEvents: MusicScoreEvent[];
  pointerUpdate: "PROPOSE_ONLY";
}

/**
 * 17 writes only a proposal for the existing chapter lifecycle to validate
 * and commit later. Never directly mutate the canonical manuscript.
 */
export function proposeMusicScoreWriteback(session: MusicScoreSession): MusicScoreWritebackProposal {
  if (session.state !== "READY_TO_PROPOSE_WRITEBACK" || !session.approval) {
    throw new Error("未获得作者正文验收，不允许生成写回提案。");
  }
  return {
    novelId: session.novelId,
    chapterId: session.chapterId,
    baseChapterRevision: session.baseChapterRevision,
    approvedContentRef: session.approval.artifactRef,
    aSourceRefs: session.originalA.map((item) => ({ ...item })),
    stageEvents: session.events.map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] })),
    pointerUpdate: "PROPOSE_ONLY",
  };
}
