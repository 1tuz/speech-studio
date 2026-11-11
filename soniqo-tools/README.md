# soniqo-tools

CLI and MCP server for the Soniqo speech sidecars. Wraps the same NDJSON
stdin/stdout sidecar binaries the Studio app uses (Swift/MLX on macOS,
C++/LiteRT on Windows/Linux) and exposes synthesis, transcription and model
inspection from the shell or from an MCP client.

## Prerequisites

A sidecar binary:

- **macOS** — `cd swift-sidecar && swift build` (binary at
  `swift-sidecar/.build/debug/soniqo-tts-sidecar`). Also copy
  `mlx.metallib` next to it (see AGENTS.md notes), or use a staged
  `src-tauri/binaries/soniqo-tts-sidecar-aarch64-apple-darwin` with the
  co-located `mlx.metallib`.
- **Windows / Linux** — build `core-sidecar` with cmake (see AGENTS.md) and
  stage it under `src-tauri/binaries/<triple>`.

Node 20+, pnpm. Build:

```bash
pnpm install
pnpm --filter @soniqo/tools build
```

Outputs `dist/cli.js` (`soniqo`) and `dist/mcp.js` (`soniqo-mcp`).

## Binary resolution

`SONIQO_SIDECAR_PATH` → `swift-sidecar/.build/debug/soniqo-tts-sidecar` →
`src-tauri/binaries/soniqo-tts-sidecar-<triple>`. The registry is
`model-registry.json` at the repo root (override: `SONIQO_MODEL_REGISTRY`).

## CLI

```bash
node soniqo-tools/dist/cli.js engines
node soniqo-tools/dist/cli.js engines --json
node soniqo-tools/dist/cli.js ping
node soniqo-tools/dist/cli.js info --engine voxcpm2
node soniqo-tools/dist/cli.js info --engine voxcpm2 --model-id aufklarer/VoxCPM2-MLX-int8 --json
node soniqo-tools/dist/cli.js synthesize --engine voxcpm2 \
  --text "Hello from the CLI" --voice src-tauri/resources/voices/anna.wav --seed 7 \
  --out ./out.wav
node soniqo-tools/dist/cli.js transcribe ./clip.wav
node soniqo-tools/dist/cli.js transcribe ./clip.wav --json
```

`--out <path>` copies the generated WAV out of the cache dir.

## MCP

stdio server at `soniqo-tools/dist/mcp.js`. Claude Desktop
(`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "soniqo": {
      "command": "node",
      "args": ["/absolute/path/to/speech-studio/soniqo-tools/dist/mcp.js"]
    }
  }
}
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "soniqo": {
      "command": "node",
      "args": ["/absolute/path/to/speech-studio/soniqo-tools/dist/mcp.js"]
    }
  }
}
```

### MCP tools

| Tool | Purpose |
| --- | --- |
| `soniqo_list_engines` | engines available on this platform (no sidecar start) |
| `soniqo_model_info` | artifact paths/size/loaded state for an engine's model |
| `soniqo_ping` | start the sidecar, return its version |
| `soniqo_transcribe` | Parakeet transcription of an audio file |
| `soniqo_synthesize` | TTS synthesis; `engine`, `text`, `voice`, `voiceText`, `language`, `seed`, `output` |

Every `soniqo_synthesize` / `soniqo_transcribe` call spawns a fresh sidecar
process; TTS models are downloaded from Hugging Face on first use (multi-GB)
and loaded per call. Use `soniqo_list_engines` / `soniqo_model_info` to check
what is available and already cached.

## Environment

| Variable | Effect |
| --- | --- |
| `SONIQO_SIDECAR_PATH` | explicit path to the sidecar binary |
| `SONIQO_MODEL_REGISTRY` | path to an alternative model registry JSON |
| `SONIQO_SIDECAR_TIMEOUT_MS` | per-request timeout (default 900000) |

Generated clips are cached under the OS cache dir,
`~/Library/Caches/audio.soniqo.studio/clips/` on macOS.
