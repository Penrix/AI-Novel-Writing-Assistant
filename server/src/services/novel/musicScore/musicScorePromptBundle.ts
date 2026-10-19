import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { MusicScoreStep } from "./musicScoreContract";

export type MusicScorePromptId =
  | "07" | "08" | "09" | "10" | "11" | "12"
  | "13" | "14" | "15" | "16" | "17";

export interface MusicScorePromptSource {
  id: MusicScorePromptId;
  filename: string;
  fullPath: string;
  version: string;
  sha256: string;
  instructions: string;
}

export type MusicScorePromptSet = Record<MusicScorePromptId, MusicScorePromptSource>;

const IDS: MusicScorePromptId[] = [
  "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17",
];

export function promptIdForMusicStep(step: MusicScoreStep): MusicScorePromptId {
  return step.slice(0, 2) as MusicScorePromptId;
}

/**
 * Load the actual 11 distinct prompt files supplied by the author.
 *
 * The v0.4 prompt bundle is not recreated from our own summaries. Neither
 * the generic writer prompt nor the older v0.2 draft may silently stand in.
 * This importer is not connected to the default chapter pipeline yet.
 */
export async function loadMusicScorePromptSet(
  promptDirectory: string,
  expectedVersion = "0.4.0-source-rebuilt",
): Promise<MusicScorePromptSet> {
  if (!promptDirectory.trim() || !expectedVersion.trim()) {
    throw new Error("音乐缩谱提示词目录和版本不能为空。");
  }
  const actualDirectory = await realpath(promptDirectory);
  const entries = await readdir(actualDirectory, { withFileTypes: true });
  const result: Partial<MusicScorePromptSet> = {};
  for (const id of IDS) {
    const matches = entries.filter((entry) =>
      entry.isFile() && entry.name.startsWith(id + "-") && entry.name.endsWith(".md"),
    );
    if (matches.length !== 1) {
      throw new Error("音乐缩谱" + id + "必须有且仅有一份真实提示词文件。");
    }
    const filename = matches[0].name;
    const fullPath = await realpath(path.join(actualDirectory, filename));
    if (path.dirname(fullPath) !== actualDirectory) {
      throw new Error("提示词文件不得越过指定目录。");
    }
    const fileStat = await stat(fullPath);
    if (fileStat.size < 100 || fileStat.size > 1024 * 1024) {
      throw new Error("音乐缩谱" + id + "提示词大小异常。");
    }
    const instructions = await readFile(fullPath, "utf8");
    if (!instructions.includes("version: " + expectedVersion)) {
      throw new Error("音乐缩谱" + id + "版本不符，禁止用旧版替代新版。");
    }
    result[id] = {
      id,
      filename,
      fullPath,
      version: expectedVersion,
      sha256: createHash("sha256").update(instructions).digest("hex"),
      instructions,
    };
  }
  return result as MusicScorePromptSet;
}
