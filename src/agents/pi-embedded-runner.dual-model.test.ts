import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_PROVIDER } from "./defaults.js";
import * as modelSelection from "./model-selection.js";
import * as modelMod from "./pi-embedded-runner/model.js";
import { runEmbeddedPiAgent } from "./pi-embedded-runner/run.js";
import * as attemptMod from "./pi-embedded-runner/run/attempt.js";

// Mock dependencies
vi.mock("./pi-embedded-runner/model.js");
vi.mock("./model-auth.js", () => ({
  getApiKeyForModel: () => Promise.resolve({ apiKey: "mock-key", mode: "token" }),
  ensureAuthProfileStore: () => ({ profiles: {} }),
  resolveAuthProfileOrder: () => [],
}));
vi.mock("./process/command-queue.js", () => ({
  enqueueCommandInLane: (_lane: any, fn: any) => fn(),
}));

describe("runEmbeddedPiAgent (Dual-Model)", () => {
  const mockModel = { id: "primary-model", provider: "mock" };
  const mockExecutionModel = { id: "execution-model", provider: "mock-exec" };

  beforeEach(() => {
    vi.resetAllMocks();

    // Default model resolution mock
    vi.spyOn(modelMod, "resolveModel").mockImplementation((provider, modelId) => {
      const authStorage = { setRuntimeApiKey: vi.fn() };
      if (provider === "mock-exec" || modelId === "execution-model") {
        return {
          model: mockExecutionModel as any,
          authStorage: authStorage as any,
          modelRegistry: {} as any,
        };
      }
      return { model: mockModel as any, authStorage: authStorage as any, modelRegistry: {} as any };
    });

    // Default attempt mock
    vi.spyOn(attemptMod, "runEmbeddedAttempt").mockResolvedValue({
      aborted: false,
      timedOut: false,
      promptError: null,
      sessionIdUsed: "test-session",
      messagesSnapshot: [],
      assistantTexts: [],
      toolMetas: [],
      lastAssistant: undefined,
      didSendViaMessagingTool: false,
      messagingToolSentTexts: [],
      messagingToolSentTargets: [],
      cloudCodeAssistFormatError: false,
    });
  });

  it("should verify execution model is resolved when configured", async () => {
    const config = {
      agents: {
        defaults: {
          model: {
            primary: "mock/primary-model",
            execution: "mock-exec/execution-model",
          },
        },
      },
    };

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      prompt: "hello",
      config: config as any,
      workspaceDir: "/tmp",
      provider: "mock", // Explicitly set provider
      model: "primary-model", // Explicitly set model
    });

    // Verify resolveModel was called for the execution model
    expect(modelMod.resolveModel).toHaveBeenCalledWith(
      "mock-exec",
      "execution-model",
      expect.any(String),
      config,
    );

    // Verify runEmbeddedAttempt received the execution model
    expect(attemptMod.runEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        executionModel: mockExecutionModel,
        executionProvider: "mock-exec",
        executionModelId: "execution-model",
      }),
    );
  });

  it("should not resolve execution model if not configured", async () => {
    const config = {
      agents: {
        defaults: {
          model: {
            primary: "mock/primary-model",
            // no execution model
          },
        },
      },
    };

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      prompt: "hello",
      config: config as any,
      workspaceDir: "/tmp",
      provider: "mock",
      model: "primary-model",
    });

    // Should only resolve primary
    expect(modelMod.resolveModel).toHaveBeenCalledTimes(1);
    expect(attemptMod.runEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        executionModel: undefined,
      }),
    );
  });

  it("should warn and proceed if execution model resolution fails", async () => {
    // Mock execution model resolution failure
    vi.spyOn(modelMod, "resolveModel").mockImplementation((provider, modelId) => {
      const authStorage = { setRuntimeApiKey: vi.fn() };
      if (modelId === "missing-model") {
        return { model: undefined, error: "Not found" } as any;
      }
      return { model: mockModel as any, authStorage: authStorage as any, modelRegistry: {} as any };
    });

    const config = {
      agents: {
        defaults: {
          model: {
            primary: "mock/primary-model",
            execution: "mock/missing-model",
          },
        },
      },
    };

    await runEmbeddedPiAgent({
      sessionId: "test-session",
      prompt: "hello",
      config: config as any,
      workspaceDir: "/tmp",
      provider: "mock",
      model: "primary-model",
    });

    // Should still run, but executionModel should be undefined
    expect(attemptMod.runEmbeddedAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        executionModel: undefined,
      }),
    );
  });
});
