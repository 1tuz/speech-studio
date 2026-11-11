import { describe, expect, it } from "vitest";
import { normalizeRuntimeTtsCatalog } from "./commands";

describe("normalizeRuntimeTtsCatalog", () => {
  // The daemon keys rows by `model`; the compare page looks engines up by `id`.
  // Before normalisation the lookup always missed, so a model owned by the
  // shared runtime (notably ESpeech) could never be shown as loaded.
  it("maps daemon rows onto engine ids", () => {
    const catalog = normalizeRuntimeTtsCatalog({
      models: [
        {
          model: "espeech",
          engine: "espeech",
          modelId: "local/ESpeech-TTS-1-RL-V2-MLX-fp16",
          displayName: "ESpeech-TTS-1 RL-V2",
          sampleRate: 24_000,
          loaded: true,
          loadedVariant: null,
        },
      ],
    });

    expect(catalog.models).toHaveLength(1);
    const row = catalog.models[0];
    expect(row.id).toBe("espeech");
    expect(row.displayName).toBe("ESpeech-TTS-1 RL-V2");
    expect(row.loaded).toBe(true);
  });

  it("keeps an id the daemon already provides", () => {
    const catalog = normalizeRuntimeTtsCatalog({
      models: [{ id: "voxcpm2", model: "voxcpm2-mlx-bf16", modelId: "aufklarer/VoxCPM2" }],
    });
    expect(catalog.models[0].id).toBe("voxcpm2");
    expect(catalog.models[0].loaded).toBe(false);
  });

  it("tolerates a route that is missing or empty", () => {
    expect(normalizeRuntimeTtsCatalog(null).models).toEqual([]);
    expect(normalizeRuntimeTtsCatalog({ models: [] }).models).toEqual([]);
    expect(normalizeRuntimeTtsCatalog({ error: "no route" }).models).toEqual([]);
  });
});
