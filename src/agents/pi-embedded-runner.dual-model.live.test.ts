import * as codingAgent from "@mariozechner/pi-coding-agent";
import fs from "node:fs/promises";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runEmbeddedAttempt } from "./pi-embedded-runner/run/attempt.js";
import * as sandboxMod from "./sandbox.js";
import * as sessionManagerCacheMod from "./session-manager-cache.js";
import * as sessionManagerInitMod from "./session-manager-init.js";
import * as sessionLockMod from "./session-write-lock.js";

// Mock external dependencies to isolate runEmbeddedAttempt logic
vi.mock("node:fs/promises");
vi.mock("@mariozechner/pi-coding-agent");
vi.mock("./sandbox.js");
vi.mock("./session-write-lock.js");
vi.mock("./session-manager-cache.js");
vi.mock("./session-manager-init.js");
vi.mock("./pi-embedded-subscribe.js", () => ({
  subscribeEmbeddedPiSession: () => ({
    assistantTexts: [],
    toolMetas: [],
    unsubscribe: vi.fn(),
    waitForCompactionRetry: vi.fn(),
    getMessagingToolSentTexts: () => [],
    getMessagingToolSentTargets: () => [],
    didSendViaMessagingTool: () => false,
    isCompacting: () => false,
  }),
}));

describe("runEmbeddedAttempt (Dual-Model Integration)", () => {
  const mockSession = {
    sessionId: "test-session",
    agent: {
      streamFn: vi.fn(),
      replaceMessages: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
      abort: vi.fn(),
      steer: vi.fn(),
      isStreaming: false,
      executionModel: undefined, // property to check
    },
    messages: [],
    dispose: vi.fn(),
    abort: vi.fn(),
    steer: vi.fn(),
    isStreaming: false,
  };

  beforeEach(() => {
    vi.resetAllMocks();

    // FS mocks
    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "stat").mockResolvedValue({} as any);

    // Sandbox mock
    vi.spyOn(sandboxMod, "resolveSandboxContext").mockResolvedValue({ enabled: false } as any);

    // Session lock mock
    vi.spyOn(sessionLockMod, "acquireSessionWriteLock").mockResolvedValue({
      release: vi.fn(),
    } as any);

    // Session manager mocks
    vi.spyOn(sessionManagerCacheMod, "prewarmSessionFile").mockResolvedValue();
    vi.spyOn(sessionManagerCacheMod, "trackSessionManagerAccess").mockReturnValue();
    vi.spyOn(sessionManagerInitMod, "prepareSessionManagerForRun").mockResolvedValue();

    // Pi-coding-agent mocks
    vi.spyOn(codingAgent.SessionManager, "open").mockReturnValue({
      getLeafEntry: () => null,
      buildSessionContext: () => ({ messages: [] }),
      flushPendingToolResults: vi.fn(),
    } as any);

    vi.spyOn(codingAgent.SettingsManager, "create").mockReturnValue({} as any);
    vi.spyOn(codingAgent, "createAgentSession").mockResolvedValue({
      session: mockSession as any,
    });
  });

  it("should inject executionModel into the created session agent", async () => {
    const mockModel = { id: "primary", provider: "mock" };
    const mockExecutionModel = { id: "execution", provider: "mock-exec" };

    await runEmbeddedAttempt({
      sessionId: "test-session",
      prompt: "do something",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp",
      provider: "mock",
      modelId: "primary",
      model: mockModel as any,
      executionModel: mockExecutionModel as any, // PASSING EXEC MODEL
      thinkLevel: "off",
      timeoutMs: 1000,
      runId: "run-1",
      authStorage: {} as any,
      modelRegistry: {} as any,
    });

    // Check if createAgentSession was called (standard check)
    expect(codingAgent.createAgentSession).toHaveBeenCalled();

    // CRITICAL CHECK: Verify the monkey-patching happened
    // We check the reference we returned from the mock
    expect(mockSession.agent.executionModel).toBe(mockExecutionModel);
  });

  it("should not inject executionModel if not provided", async () => {
    const mockModel = { id: "primary", provider: "mock" };

    await runEmbeddedAttempt({
      sessionId: "test-session",
      prompt: "do something",
      sessionFile: "/tmp/session.json",
      workspaceDir: "/tmp",
      provider: "mock",
      modelId: "primary",
      model: mockModel as any,
      // NO EXEC MODEL
      thinkLevel: "off",
      timeoutMs: 1000,
      runId: "run-2",
      authStorage: {} as any,
      modelRegistry: {} as any,
    });

    expect(codingAgent.createAgentSession).toHaveBeenCalled();
    expect(mockSession.agent.executionModel).toBeUndefined();
  });
});
