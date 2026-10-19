import type { LLMProvider } from "@ai-novel/shared/types/llm";
import { runTextPrompt } from "../../../prompting/core/promptRunner";
import { getMusicScorePromptAsset } from "../../../prompting/prompts/musicScore/musicScore.prompts";
import type { MusicScoreSession, MusicScoreStep } from "./musicScoreContract";
import { expectedMusicScoreStep } from "./musicScoreContract";

export type MusicScoreStageMaterial =
  | { kind: "general"; text: string }
  | { kind: "actor"; currentBeatPacket: string; acceptedProseSeam: string };

export interface MusicScoreStageCall {
  session: MusicScoreSession;
  material: MusicScoreStageMaterial;
  provider?: LLMProvider;
  model?: string;
}

/**
 * The native prompt runner resolves the active novel-scoped version in
 * Prompt Workbench. No music prompt changes require a code release.
 * Model output is NOT signed off or saved here.
 */
export async function runMusicScoreStage(input: MusicScoreStageCall): Promise<{
  step: MusicScoreStep;
  output: string;
  promptId: string;
  promptVersion: string;
}> {
  const step = expectedMusicScoreStep(input.session);
  const id = step.slice(0, 2) as "07" | "08" | "09" | "10" | "11" | "12" | "13" | "14" | "15" | "16";
  if (step === "13" && input.material.kind !== "actor") {
    throw new Error("音乐缩谱13演员只允许接收12生成的当前小节演奏包与已验收正文接缝。");
  }
  if (step !== "13" && input.material.kind === "actor") {
    throw new Error("演员包只能用于13正文演奏，不得当成控制室的通用资料。");
  }
  let stageMaterial: string;
  if (input.material.kind === "actor") {
    if (!input.material.currentBeatPacket.trim()) {
      throw new Error("13缺少当前小节演奏包，禁止自行写小说。");
    }
    stageMaterial = [
      "【当前小节演奏包】", input.material.currentBeatPacket,
      "【已验收正文接缝】", input.material.acceptedProseSeam.trim() || "本场景无已验收接缝",
    ].join("\n\n");
  } else {
    if (!input.material.text.trim()) {
      throw new Error("音乐缩谱缺少真实A/B当前交接材料，禁止空白生成。");
    }
    stageMaterial = input.material.text;
  }
  const asset = getMusicScorePromptAsset(id);
  const result = await runTextPrompt({
    asset,
    promptInput: { stageMaterial },
    contextBlocks: [],
    options: {
      novelId: input.session.novelId,
      chapterId: input.session.chapterId,
      provider: input.provider,
      model: input.model,
      stage: "music_score_" + step,
      entrypoint: "music_score_prose",
      triggerReason: "user_selected_music_workflow",
    },
  });
  const output = result.output.trim();
  if (!output) throw new Error("音乐缩谱模型没有交出阶段产物，禁止推进下一步。");
  if (step === "13" && /^<<无法演奏[：:]/.test(output)) {
    throw new Error("演员已报告无法演奏；不得把阻塞标记当作正文：" + output.slice(0, 300));
  }
  return { step, output, promptId: asset.id, promptVersion: asset.version };
}
