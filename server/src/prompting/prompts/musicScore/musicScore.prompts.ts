import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { PromptAsset } from "../../core/promptTypes";
import { MUSIC_SCORE_OFFICIAL_PROMPTS, MUSIC_SCORE_SOURCE_VERSION } from "./musicScoreOfficialSources";

export const MUSIC_SCORE_PROMPT_IDS = [
  "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17",
] as const;
export type MusicScorePromptId = typeof MUSIC_SCORE_PROMPT_IDS[number];

/** Workbench input is assembled by the later chapter-specific orchestrator.
 * In particular, stage 13 MUST receive only the stage-12 actor packet and
 * accepted manuscript seam, never the global control room or other secrets.
 */
export interface MusicScorePromptInput {
  stageMaterial: string;
}

const routingTask: Record<MusicScorePromptId, "writer" | "review" | "planner" | "repair" | "state_resolution"> = {
  "07": "planner",
  "08": "review",
  "09": "planner",
  "10": "planner",
  "11": "review",
  "12": "planner",
  "13": "writer",
  "14": "review",
  "15": "review",
  "16": "repair",
  "17": "state_resolution",
};

export function getMusicScorePromptAsset(id: MusicScorePromptId): PromptAsset<MusicScorePromptInput, string> {
  const source = MUSIC_SCORE_OFFICIAL_PROMPTS[id];
  if (!source || !source.includes("version: " + MUSIC_SCORE_SOURCE_VERSION)) {
    throw new Error("音乐缩谱官方提示词缺失或源版本不符：" + id);
  }
  return {
    id: "thirdgen.music." + id,
    version: "v0.3",
    taskType: routingTask[id],
    mode: "text",
    language: "zh",
    contextPolicy: { maxTokensBudget: 12000, requiredGroups: [], preferredGroups: [] },
    contextRequirements: [{ group: "music_stage_material", required: false, priority: 95 }],
    management: {
      productPrompt: true,
      proseGeneration: id === "13",
      editModes: ["advanced_template"],
      advancedTemplate: { scope: "novel", requiredContextGroups: [] },
    },
    render: (input) => {
      if (!input || typeof input.stageMaterial !== "string" || !input.stageMaterial.trim()) {
        throw new Error("音乐缩谱" + id + "尚未收到本工序合法资料包。");
      }
      return [new SystemMessage(source), new HumanMessage(input.stageMaterial)];
    },
  };
}
