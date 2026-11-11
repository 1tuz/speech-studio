import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { enginesForPlatform, loadRegistry, type EngineEntry } from "./registry.js";
import { withSidecar } from "./sidecar.js";

export interface SynthesizeArgs {
  engine: string;
  text: string;
  voice?: string;
  voiceText?: string;
  language?: string;
  seed?: number;
  output?: string;
}

function findEngine(engine: string): EngineEntry | undefined {
  const reg = loadRegistry();
  return reg.ttsEngines.find((e) => e.id === engine) ?? reg.asrModels.find((e) => e.id === engine);
}

export function cmdPing(): Promise<{ pong: boolean; version: string }> {
  return withSidecar((client) =>
    client.request<{ pong: boolean; version: string }>({ command: "ping" })
  );
}

export function cmdModelInfo(engine: string, modelId?: string): Promise<Record<string, unknown>> {
  const resolvedModelId = modelId ?? findEngine(engine)?.modelId;
  return withSidecar((client) =>
    client.request<Record<string, unknown>>(
      { command: "model_info", engine, ...(resolvedModelId ? { modelId: resolvedModelId } : {}) }
    )
  );
}

export async function cmdSynthesize(args: SynthesizeArgs): Promise<{
  audioPath: string;
  copiedTo?: string;
  sampleRate: number;
  durationSec: number;
}> {
  const entry = findEngine(args.engine);
  const modelId = entry?.modelId;
  const command = entry?.sidecarCommand ?? `synthesize_${args.engine}`;

  const result = await withSidecar(async (client) => {
    await client.request(
      { command: "init_model", engine: args.engine, ...(modelId ? { modelId } : {}) },
      { timeoutMs: 900_000 }
    );
    const payload: Record<string, unknown> = { command, text: args.text };
    if (args.voice !== undefined) payload.referenceAudioPath = args.voice;
    if (args.voiceText !== undefined) payload.referenceText = args.voiceText;
    if (args.language !== undefined) payload.language = args.language;
    if (args.seed !== undefined) payload.seed = args.seed;
    return client.request<{ audioPath: string; sampleRate: number; durationSec: number }>(
      payload,
      { timeoutMs: 900_000 }
    );
  });

  const out: { audioPath: string; copiedTo?: string; sampleRate: number; durationSec: number } = {
    ...result,
  };
  if (args.output) {
    const dest = path.resolve(args.output);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(result.audioPath, dest);
    out.copiedTo = dest;
  }
  return out;
}

export function cmdTranscribe(audioPath: string): Promise<{
  text: string;
  modelName: string;
  sampleRate: number;
  durationSec: number;
  elapsedSec: number;
}> {
  return withSidecar((client) =>
    client.request<{
      text: string;
      modelName: string;
      sampleRate: number;
      durationSec: number;
      elapsedSec: number;
    }>({ command: "transcribe_parakeet", audioPath }, { timeoutMs: 900_000 })
  );
}

export function cmdListEngines(): Promise<EngineEntry[]> {
  return Promise.resolve(enginesForPlatform(loadRegistry(), process.platform));
}
