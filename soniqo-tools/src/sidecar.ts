import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface SidecarRequest {
  id?: string;
  command: string;
  [k: string]: unknown;
}

interface SidecarResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout | undefined;
}

// stdin/stdout piped, stderr inherited (sidecar logs `[sidecar] ...` there).
type SidecarChild = ChildProcessByStdio<Writable, Readable, null>;

// Per-request deadline. Long first-use downloads + model loads can exceed
// two minutes; `SONIQO_SIDECAR_TIMEOUT_MS` overrides the default.
const DEFAULT_TIMEOUT_MS = (() => {
  const raw = process.env.SONIQO_SIDECAR_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 900_000;
})();

function platformTriples(platform: NodeJS.Platform, arch: string): string[] {
  if (platform === "win32") {
    return ["x86_64-pc-windows-msvc", "x86_64-pc-windows-msvc.exe"];
  }
  if (platform === "linux") return ["x86_64-unknown-linux-gnu"];
  if (platform === "darwin") {
    return [arch === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin"];
  }
  return [];
}

/**
 * Repo root discovered from the compiled file location: dist/ -> package
 * root -> repo root, looking for model-registry.json as the marker. Also
 * walks up from CWD so running from src/ or an uncompiled checkout works.
 */
export function findRepoRoot(): string {
  const here = import.meta.dirname;
  const candidates: string[] = [];
  if (here) {
    candidates.push(path.resolve(here, "..", ".."));
    candidates.push(path.resolve(here, "..", "..", ".."));
  }
  let cwd = process.cwd();
  for (let i = 0; i < 4; i++) {
    candidates.push(cwd);
    const parent = path.dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "model-registry.json"))) return dir;
  }
  return candidates[0] ?? process.cwd();
}

export function findSidecarBinary(): string {
  const tried: string[] = [];
  const probe = (p: string): string | null => {
    tried.push(p);
    return existsSync(p) ? p : null;
  };

  if (process.env.SONIQO_SIDECAR_PATH) {
    const hit = probe(process.env.SONIQO_SIDECAR_PATH);
    if (hit) return hit;
  }

  const root = findRepoRoot();
  const debug = probe(path.join(root, "swift-sidecar", ".build", "debug", "soniqo-tts-sidecar"));
  if (debug) return debug;

  for (const triple of platformTriples(process.platform, process.arch)) {
    const hit = probe(path.join(root, "src-tauri", "binaries", `soniqo-tts-sidecar-${triple}`));
    if (hit) return hit;
  }

  throw new Error(
    `sidecar binary not found. Tried:\n${tried.map((p) => `  - ${p}`).join("\n")}\n` +
      `Build it first: on macOS run \`swift build\` inside swift-sidecar/, ` +
      `on Windows/Linux build the C++ sidecar with cmake (see AGENTS.md), ` +
      `or point SONIQO_SIDECAR_PATH at the binary.`
  );
}

export class SidecarClient {
  private child: SidecarChild | null = null;
  private buffer = "";
  private readonly pending = new Map<string, PendingRequest>();
  private spawnError: Error | null = null;
  private exitInfo: string | null = null;
  readonly binaryPath: string;

  constructor(binaryPath: string) {
    this.binaryPath = binaryPath;
  }

  private ensureChild(): SidecarChild {
    if (this.child) return this.child;
    const child = spawn(this.binaryPath, [], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    child.on("error", (err) => {
      this.spawnError = err instanceof Error ? err : new Error(String(err));
      this.failAll(this.spawnError);
    });
    child.on("exit", (code, signal) => {
      this.exitInfo = signal ? `killed by ${signal}` : `exited with code ${code}`;
      this.failAll(new Error(`sidecar ${this.exitInfo}`));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child = child;
    return child;
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: SidecarResponse;
      try {
        msg = JSON.parse(line) as SidecarResponse;
      } catch {
        process.stderr.write(`[sidecar] unparsable stdout line: ${line}\n`);
        continue;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) continue;
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error ?? "unknown sidecar error"));
    }
  }

  private failAll(err: Error): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
  }

  async request<T = unknown>(
    payload: Omit<SidecarRequest, "id"> & { id?: string },
    opts?: { timeoutMs?: number }
  ): Promise<T> {
    if (this.exitInfo) throw new Error(`sidecar ${this.exitInfo}`);

    const id = payload.id ?? `cli-${randomUUID()}`;
    const child = this.ensureChild();
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { promise, resolve, reject } = Promise.withResolvers<T>();

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            this.close();
            reject(new Error(`sidecar request timed out after ${timeoutMs} ms`));
          }, timeoutMs)
        : undefined;

    this.pending.set(id, {
      resolve: (v) => resolve(v as T),
      reject,
      timer,
    });

    if (this.spawnError) {
      clearTimeout(timer);
      this.pending.delete(id);
      reject(this.spawnError);
      return promise;
    }

    const line = JSON.stringify({ ...payload, id }) + "\n";
    child.stdin.write(line, (err) => {
      if (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return promise;
  }

  close(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("sidecar client closed"));
    }
    this.pending.clear();
    if (this.child) {
      this.child.stdin.end();
      this.child.kill();
      this.child = null;
    }
  }
}

export async function withSidecar<T>(fn: (client: SidecarClient) => Promise<T>): Promise<T> {
  const client = new SidecarClient(findSidecarBinary());
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
