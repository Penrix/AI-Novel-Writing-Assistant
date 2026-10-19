import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveAppDataRoot } from "../../../runtime/appPaths";

export interface ChatGPTRegistration {
  clientId: string;
  subject: string;
  email: string;
  scopes: string[];
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
}

export interface ChatGPTCredentials {
  hostId: string;
  activeClientId: string | null;
  registrations: ChatGPTRegistration[];
}

const directory = path.join(resolveAppDataRoot(), "chatgpt-plan");
const file = path.join(directory, "credentials.json");
let writeQueue: Promise<void> = Promise.resolve();

async function readFile(): Promise<ChatGPTCredentials | null> {
  try {
    const value = JSON.parse(await fs.readFile(file, "utf8")) as ChatGPTCredentials;
    if (
      typeof value.hostId !== "string"
      || !/^urn:uuid:[0-9a-f-]{36}$/i.test(value.hostId)
      || !Array.isArray(value.registrations)
    ) {
      throw new Error("ChatGPT 授权资料格式无效。");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(value: ChatGPTCredentials): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = path.join(directory, "credentials-" + randomUUID() + ".tmp");
  try {
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}

export async function loadChatGPTCredentials(): Promise<ChatGPTCredentials> {
  const stored = await readFile();
  if (stored) return stored;
  const initial: ChatGPTCredentials = {
    hostId: "urn:uuid:" + randomUUID(),
    activeClientId: null,
    registrations: [],
  };
  await saveChatGPTCredentials(initial);
  return (await readFile()) ?? initial;
}

export async function saveChatGPTCredentials(value: ChatGPTCredentials): Promise<void> {
  const task = writeQueue.catch(() => {}).then(() => atomicWrite(value));
  writeQueue = task;
  await task;
}
