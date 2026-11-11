#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  cmdListEngines,
  cmdModelInfo,
  cmdPing,
  cmdSynthesize,
  cmdTranscribe,
} from "./commands.js";
import { enginesForPlatform, loadRegistry } from "./registry.js";

const server = new McpServer({ name: "soniqo-tools", version: "0.1.0" });

function ok(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

function fail(message: string, nextStep: string) {
  return {
    isError: true as const,
    content: [
      { type: "text" as const, text: `${message} ${nextStep}` },
    ],
  };
}

function defaultEngineId(): string {
  const engines = enginesForPlatform(loadRegistry(), process.platform);
  const preferred = engines.find((e) => e.id === "voxcpm2");
  return (preferred ?? engines[0]).id;
}

const defaultEngineHint =
  "Omit to use the platform default engine (voxcpm2 where available).";

server.registerTool(
  "soniqo_list_engines",
  {
    title: "List TTS engines",
    description:
      "List the TTS engines available on this platform from the model registry, " +
      "with id, display name and default model id. Does not start the sidecar.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    try {
      return ok(await cmdListEngines());
    } catch (e) {
      return fail(String(e), "Check that model-registry.json exists at the repo root or set SONIQO_MODEL_REGISTRY.");
    }
  },
);

server.registerTool(
  "soniqo_model_info",
  {
    title: "TTS model info",
    description:
      "Report artifact paths, existence, size in bytes and load state for an engine's model bundle. " +
      "Cheap: no model load, no sidecar model download.",
    inputSchema: {
      engine: z.string().min(1).describe("Engine id from soniqo_list_engines, e.g. voxcpm2 or cosyvoice."),
      modelId: z.string().optional().describe("Optional specific model variant; defaults to the registry default."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ engine, modelId }) => {
    try {
      return ok(await cmdModelInfo(engine, modelId));
    } catch (e) {
      return fail(
        String(e),
        `Call soniqo_list_engines to check that the engine "${engine}" is valid on this platform.`,
      );
    }
  },
);

server.registerTool(
  "soniqo_ping",
  {
    title: "Ping sidecar",
    description:
      "Start the sidecar binary and return its protocol version. Use to verify the sidecar resolves and runs.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    try {
      return ok(await cmdPing());
    } catch (e) {
      return fail(
        String(e),
        "Build the sidecar (swift build on macOS, cmake for Windows/Linux) or set SONIQO_SIDECAR_PATH.",
      );
    }
  },
);

server.registerTool(
  "soniqo_transcribe",
  {
    title: "Transcribe audio",
    description:
      "Transcribe an audio file with Parakeet (sidecar ASR). Each call spawns a fresh sidecar; the Parakeet model is downloaded on first use (multi-GB possible).",
    inputSchema: {
      audioPath: z.string().min(1).describe("Absolute path to an audio file to transcribe."),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ audioPath }) => {
    try {
      return ok(await cmdTranscribe(audioPath));
    } catch (e) {
      return fail(
        String(e),
        `Check that "${audioPath}" is a readable audio file and that the sidecar binary is built (SONIQO_SIDECAR_PATH).`,
      );
    }
  },
);

server.registerTool(
  "soniqo_synthesize",
  {
    title: "Synthesize speech",
    description:
      "Synthesize speech with a TTS engine. Each call spawns a fresh sidecar; the model is downloaded on first use (multi-GB possible) and loaded per call. The engine must be valid for the platform (call soniqo_list_engines).",
    inputSchema: {
      engine: z.string().optional().describe(`Engine id from soniqo_list_engines. ${defaultEngineHint}`),
      text: z.string().min(1).describe("Text to synthesize; may include emotion markers where the engine supports them."),
      voice: z.string().optional().describe("Path to a reference WAV to clone, for engines that require reference audio."),
      voiceText: z.string().optional().describe("Transcript of the reference audio, for engines that require it."),
      language: z.string().optional().describe("Language code, e.g. en or ru, for multilingual engines."),
      seed: z.number().int().optional().describe("Deterministic sampling seed; omit for random."),
      output: z.string().optional().describe("Optional destination path for the WAV; omit to keep the sidecar cache path."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async (args) => {
    try {
      return ok(
        await cmdSynthesize({
          engine: args.engine ?? defaultEngineId(),
          text: args.text,
          voice: args.voice,
          voiceText: args.voiceText,
          language: args.language,
          seed: args.seed,
          output: args.output,
        }),
      );
    } catch (e) {
      return fail(
        String(e),
        "Call soniqo_list_engines and soniqo_model_info to check engine validity and whether the model bundle is downloaded.",
      );
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
