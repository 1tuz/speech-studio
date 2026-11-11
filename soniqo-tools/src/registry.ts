import { readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./sidecar.js";

export interface EngineEntry {
  id: string;
  displayName: string;
  modelId: string;
  sidecarCommand: string;
  macosOnly?: boolean;
  platformOverrides?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ModelRegistry {
  version: number;
  ttsEngines: EngineEntry[];
  asrModels: EngineEntry[];
}

export function loadRegistry(): ModelRegistry {
  const override = process.env.SONIQO_MODEL_REGISTRY;
  const file = override ?? path.join(findRepoRoot(), "model-registry.json");
  return JSON.parse(readFileSync(file, "utf8")) as ModelRegistry;
}

export function enginesForPlatform(reg: ModelRegistry, platform: NodeJS.Platform): EngineEntry[] {
  // darwin: every TTS engine in the registry is selectable on macOS — the
  // swift sidecar implements all of them; `macosOnly` only excludes
  // non-macOS platforms.
  if (platform === "darwin") return reg.ttsEngines;
  // windows/linux: the LiteRT sidecar handles the subset that declares a
  // per-platform override.
  return reg.ttsEngines.filter(
    (e) => e.macosOnly !== true && e.platformOverrides != null && platform in e.platformOverrides
  );
}
