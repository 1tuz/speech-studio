#!/usr/bin/env node
import { Command } from "commander";
import {
  cmdListEngines,
  cmdModelInfo,
  cmdPing,
  cmdSynthesize,
  cmdTranscribe,
} from "./commands.js";
import { loadRegistry } from "./registry.js";

function humanBytes(n: number): string {
  if (!Number.isFinite(n)) return "?";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(1)} ${units[u]}`;
}

function message(text: string): void {
  process.stderr.write(text + "\n");
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    message(`soniqo: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const program = new Command();
program
  .name("soniqo")
  .description("CLI for the Soniqo speech sidecar (TTS synthesis, ASR transcription)")
  .version("0.1.0");

program
  .command("engines")
  .description("List TTS engines available on this platform")
  .option("--json", "print full registry entries as JSON")
  .action((opts) =>
    run(async () => {
      const engines = await cmdListEngines();
      if (opts.json) {
        process.stdout.write(JSON.stringify(engines, null, 2) + "\n");
        return;
      }
      const registry = loadRegistry();
      const defaultId = engines.some((e) => e.id === "voxcpm2")
        ? "voxcpm2"
        : (engines[0]?.id ?? registry.ttsEngines[0]?.id);
      for (const e of engines) {
        const line = `${e.id}\t${e.displayName}\t${e.modelId}`;
        process.stdout.write(e.id === defaultId ? `${line}\t*\n` : `${line}\n`);
      }
    })
  );

program
  .command("ping")
  .description("Health-check the sidecar binary")
  .action(() =>
    run(async () => {
      const result = await cmdPing();
      process.stdout.write(JSON.stringify(result) + "\n");
      if (!result.pong) process.exitCode = 1;
    })
  );

program
  .command("info")
  .description("Show model artifact status for an engine (no model load)")
  .requiredOption("--engine <engine>", "engine id, e.g. voxcpm2")
  .option("--model-id <modelId>", "override the registry model id")
  .option("--json", "print the raw model_info result as JSON")
  .action((opts) =>
    run(async () => {
      const info = await cmdModelInfo(opts.engine, opts.modelId);
      if (opts.json) {
        process.stdout.write(JSON.stringify(info, null, 2) + "\n");
        return;
      }
      process.stdout.write(`engine    ${String(info.engine)}\n`);
      process.stdout.write(`modelId   ${String(info.modelId)}\n`);
      process.stdout.write(`exists    ${info.exists ? "yes" : "no"}\n`);
      process.stdout.write(`bytes     ${humanBytes(Number(info.bytes))}\n`);
      process.stdout.write(`loaded    ${info.loaded ? "yes" : "no"}\n`);
      const paths = Array.isArray(info.paths) ? (info.paths as unknown[]) : [];
      for (const p of paths) process.stdout.write(`path      ${String(p)}\n`);
    })
  );

program
  .command("synthesize")
  .description("Synthesize speech with a TTS engine")
  .requiredOption("--engine <engine>", "engine id, e.g. voxcpm2")
  .requiredOption("--text <text>", "text to synthesize")
  .option("--voice <wav>", "reference audio for voice cloning")
  .option("--voice-text <text>", "transcript of the reference audio")
  .option("--language <lang>", "language for engines that require it")
  .option("--seed <seed>", "sampling seed", (v: string) => Number.parseInt(v, 10))
  .option("--out <path>", "copy the resulting WAV to this path")
  .option("--json", "print the full result object as JSON")
  .action((opts) =>
    run(async () => {
      message(`synthesizing with ${opts.engine}...`);
      const result = await cmdSynthesize({
        engine: opts.engine,
        text: opts.text,
        voice: opts.voice,
        voiceText: opts.voiceText,
        language: opts.language,
        seed: opts.seed,
        output: opts.out,
      });
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }
      process.stdout.write(`${result.copiedTo ?? result.audioPath}\n`);
    })
  );

program
  .command("transcribe")
  .description("Transcribe an audio file with Parakeet ASR")
  .argument("<audioPath>", "path to the audio file")
  .option("--json", "print the full result object as JSON")
  .action((audioPath: string, opts) =>
    run(async () => {
      const result = await cmdTranscribe(audioPath);
      if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }
      process.stdout.write(`${result.text}\n`);
    })
  );

await program.parseAsync(process.argv);
