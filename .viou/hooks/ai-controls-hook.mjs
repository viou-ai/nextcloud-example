#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const viouBridgeConfig = {"hookId":"ai-controls-v1","bridgeVersion":7,"manifestSchemaVersion":1,"manifestPath":".viou/ai-controls.json","maxStdinBytes":67108864,"providerContracts":{"cursor":{"durationMsFields":{"session_ended":["duration_ms"],"tool_call_completed":["duration"]},"envelopeFields":{"actor":{"providerEmail":["user_email"]},"event":{"providerEventId":["event_id"],"status":["status"],"toolUseId":["tool_use_id"]},"metrics":{"prompt":["prompt"],"toolInput":["tool_input"],"toolOutput":["tool_output"]},"model":{"id":["model_id"],"label":["model"]},"session":{"id":["conversation_id","session_id"]},"tool":{"name":["tool_name"]},"turn":{"id":["generation_id"],"mode":["composer_mode"]}},"eventNames":{"agent_finished":"stop","prompt_submitted":"beforeSubmitPrompt","session_ended":"sessionEnd","session_started":"sessionStart","tool_call_completed":"postToolUse","tool_call_requested":"preToolUse"},"hookEvents":[{"eventKind":"session_started"},{"eventKind":"session_ended"},{"eventKind":"prompt_submitted"},{"eventKind":"tool_call_requested","matcher":"*"},{"eventKind":"tool_call_completed","matcher":"*"},{"eventKind":"agent_finished"}],"hookEventNameFields":["hook_event_name","hookEventName"],"reasoningEffortModelParamIds":["reasoning","effort"],"reasoningEffortObjectPaths":[]},"codex":{"durationMsFields":{},"envelopeFields":{"actor":{"providerEmail":["user_email"]},"event":{"providerEventId":["event_id"],"status":["status"],"toolUseId":["tool_use_id"]},"metrics":{"prompt":["prompt"],"toolInput":["tool_input"],"toolOutput":["tool_response"]},"model":{"id":["model_id"],"label":["model"]},"session":{"id":["session_id"]},"tool":{"name":["tool_name"]},"turn":{"id":["turn_id"],"mode":["permission_mode"]}},"eventNames":{"agent_finished":"Stop","prompt_submitted":"UserPromptSubmit","session_started":"SessionStart","tool_call_completed":"PostToolUse","tool_call_requested":"PreToolUse"},"hookEvents":[{"eventKind":"session_started"},{"eventKind":"prompt_submitted"},{"eventKind":"tool_call_requested","matcher":"*"},{"eventKind":"tool_call_completed","matcher":"*"},{"eventKind":"agent_finished"}],"hookEventNameFields":["hook_event_name"],"reasoningEffortModelParamIds":[],"reasoningEffortObjectPaths":[]},"claude_code":{"durationMsFields":{"tool_call_completed":["duration_ms"]},"envelopeFields":{"actor":{"providerEmail":["user_email"]},"event":{"providerEventId":["event_id"],"status":["status"],"toolUseId":["tool_use_id"]},"metrics":{"prompt":["prompt"],"toolInput":["tool_input"],"toolOutput":["tool_response"]},"model":{"id":["model_id"],"label":["model"]},"session":{"id":["session_id"]},"tool":{"name":["tool_name"]},"turn":{"id":["prompt_id"],"mode":["permission_mode"]}},"eventNames":{"agent_finished":"Stop","prompt_submitted":"UserPromptSubmit","session_ended":"SessionEnd","session_started":"SessionStart","tool_call_completed":"PostToolUse","tool_call_requested":"PreToolUse"},"hookEvents":[{"eventKind":"session_started"},{"eventKind":"session_ended"},{"eventKind":"prompt_submitted"},{"eventKind":"tool_call_requested","matcher":"*"},{"eventKind":"tool_call_completed","matcher":"*"},{"eventKind":"agent_finished"}],"hookEventNameFields":["hook_event_name"],"reasoningEffortModelParamIds":[],"reasoningEffortObjectPaths":["effort.level"]}},"requestTimeoutMs":5000};
const {
  bridgeVersion,
  hookId,
  manifestPath,
  manifestSchemaVersion,
  maxStdinBytes,
  providerContracts,
  requestTimeoutMs,
} = viouBridgeConfig;
const debugEnabled = process.env.VIOU_AI_CONTROLS_DEBUG === "1";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compact(record) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== null && value !== undefined,
    ),
  );
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function pick(record, keys) {
  if (!isRecord(record)) {
    return null;
  }

  for (const key of keys) {
    const value = text(record[key]);

    if (value) {
      return value;
    }
  }

  return null;
}

function jsonCharacterLength(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === "string") {
    return value.length;
  }

  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function payloadValue(payload, keys) {
  if (!isRecord(payload)) {
    return null;
  }

  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null) {
      return payload[key];
    }
  }

  return null;
}

function payloadValueAtPath(payload, fieldPath) {
  if (!isRecord(payload)) {
    return null;
  }

  let current = payload;

  for (const segment of fieldPath.split(".")) {
    if (
      !isRecord(current) ||
      current[segment] === undefined ||
      current[segment] === null
    ) {
      return null;
    }

    current = current[segment];
  }

  return current;
}

function providerContract(provider) {
  return providerContracts[provider] ?? null;
}

function envelopeFieldValue(payload, provider, section, field) {
  return payloadValue(
    payload,
    providerContract(provider)?.envelopeFields?.[section]?.[field] ?? [],
  );
}

function envelopeFieldText(payload, provider, section, field) {
  return text(envelopeFieldValue(payload, provider, section, field));
}

function payloadEventName(payload, provider) {
  return pick(payload, providerContract(provider)?.hookEventNameFields ?? []);
}

const cursorHookEventNames = new Set(
  Object.values(providerContract("cursor")?.eventNames ?? {}),
);

function shouldSuppressClaudeDuplicate({
  hookEventName,
  payload,
  sourceEventName,
}) {
  return (
    text(payload.cursor_version) !== null ||
    text(payload.cursorVersion) !== null ||
    (hookEventName !== null &&
      hookEventName !== sourceEventName &&
      cursorHookEventNames.has(hookEventName))
  );
}

function arg(name) {
  const index = process.argv.indexOf(name);

  return index >= 0 ? text(process.argv[index + 1]) : null;
}

function debug(message, details) {
  if (!debugEnabled) {
    return;
  }

  const suffix = details === undefined ? "" : " " + JSON.stringify(details);
  console.error("Viou AI Controls hook: " + message + suffix);
}

function gitOutput(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd: cwd ?? undefined,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    }).trim();
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readManifest(repoRoot) {
  const manifest = repoRoot
    ? readJsonFile(path.join(repoRoot, manifestPath))
    : null;

  if (!isRecord(manifest)) {
    return null;
  }

  const repository = isRecord(manifest.repository) ? manifest.repository : {};

  if (
    manifest.schemaVersion !== manifestSchemaVersion ||
    !text(manifest.setupKey) ||
    !text(repository.fullName)
  ) {
    return null;
  }

  return manifest;
}

function rootFromCandidate(candidate) {
  if (!candidate) {
    return null;
  }

  const normalizedCandidate = candidate.replace(/^\/([A-Za-z]:[\\/])/u, "$1");
  const repoRoot = text(
    gitOutput(["-C", normalizedCandidate, "rev-parse", "--show-toplevel"]),
  );

  return readManifest(repoRoot) ? repoRoot : null;
}

function scriptDirectoryRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, "..", "..");

  return readManifest(repoRoot) ? repoRoot : null;
}

function resolveRepoRoot() {
  // The checked-in script location is the strongest signal because provider
  // configs may inherit stale environment variables from another workspace.
  // Provider payload root fields are ignored until a provider documents a
  // stable contract we can rely on.
  return (
    scriptDirectoryRoot() ??
    rootFromCandidate(text(process.env.VIOU_AI_CONTROLS_RESOLVED_REPO_ROOT)) ??
    rootFromCandidate(text(process.env.VIOU_AI_CONTROLS_REPO_ROOT)) ??
    rootFromCandidate(process.cwd())
  );
}

function sanitizeRemoteUrl(remoteUrl) {
  try {
    const url = new URL(remoteUrl);
    url.username = "";
    url.password = "";

    return url.toString();
  } catch {
    return remoteUrl.replace(/^(https?:\/\/)[^/@]+@/u, "$1");
  }
}

function remoteUrl(cwd) {
  const originUrl = text(gitOutput(["remote", "get-url", "origin"], cwd));

  if (originUrl) {
    return originUrl;
  }

  const firstRemote = text(gitOutput(["remote"], cwd))
    ?.split(/\r?\n/u)
    .find(Boolean);

  return firstRemote
    ? text(gitOutput(["remote", "get-url", firstRemote], cwd))
    : null;
}

function repositoryMetadata(repoRoot, manifest) {
  const branch = text(gitOutput(["branch", "--show-current"], repoRoot));
  const repoRemoteUrl = remoteUrl(repoRoot);
  const status = gitOutput(["status", "--porcelain"], repoRoot);

  return {
    branch,
    dirty: status === null ? null : status.length > 0,
    fullName: pick(isRecord(manifest?.repository) ? manifest.repository : {}, [
      "fullName",
    ]),
    headSha: text(gitOutput(["rev-parse", "HEAD"], repoRoot)),
    remoteUrl: repoRemoteUrl ? sanitizeRemoteUrl(repoRemoteUrl) : null,
  };
}

function actor(repoRoot) {
  return compact({
    gitEmail: text(gitOutput(["config", "user.email"], repoRoot)),
    name: text(gitOutput(["config", "user.name"], repoRoot)),
    username:
      text(gitOutput(["config", "github.user"], repoRoot)) ??
      text(gitOutput(["config", "user.username"], repoRoot)),
  });
}

function parsePayloadJson(content) {
  try {
    const normalizedContent =
      content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    const parsed = JSON.parse(normalizedContent);

    if (isRecord(parsed)) {
      return { payload: parsed, payloadStatus: "parsed" };
    }

    debug("ignored non-object JSON hook payload");
    return { payload: {}, payloadStatus: "non_object_json" };
  } catch {
    debug("ignored invalid JSON hook payload");
    return { payload: {}, payloadStatus: "invalid_json" };
  }
}

function discardInput() {
  process.stdin.destroy();
}

async function readInput() {
  const chunks = [];
  let retainedBytes = 0;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxStdinBytes - retainedBytes;

    if (buffer.byteLength > remaining) {
      debug("ignored hook payload because stdin exceeded byte limit", {
        maxStdinBytes,
      });
      discardInput();
      return { payload: {}, payloadStatus: "oversized" };
    }

    chunks.push(buffer);
    retainedBytes += buffer.byteLength;
  }

  return chunks.length > 0
    ? parsePayloadJson(Buffer.concat(chunks).toString("utf8"))
    : { payload: {}, payloadStatus: "parsed" };
}

function reasoningEffort({ payload, provider }) {
  const contract = providerContract(provider);
  const modelParams =
    isRecord(payload) && Array.isArray(payload.model_params)
      ? payload.model_params
      : [];

  for (const paramId of contract?.reasoningEffortModelParamIds ?? []) {
    const match = modelParams.find(
      (entry) => isRecord(entry) && text(entry.id) === paramId,
    );
    const value = isRecord(match) ? text(match.value) : null;

    if (value) {
      return value;
    }
  }

  for (const fieldPath of contract?.reasoningEffortObjectPaths ?? []) {
    const value = text(payloadValueAtPath(payload, fieldPath));

    if (value) {
      return value;
    }
  }

  return null;
}

function durationMs({ eventKind, payload, provider }) {
  const fields =
    providerContract(provider)?.durationMsFields?.[eventKind] ?? [];
  const value = payloadValue(payload, fields);

  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function metrics({ eventKind, payload, payloadStatus, provider }) {
  if (payloadStatus !== "parsed") {
    return {
      inputCharacters: null,
      outputCharacters: null,
    };
  }

  const isToolEvent =
    eventKind === "tool_call_requested" || eventKind === "tool_call_completed";

  return {
    inputCharacters:
      eventKind === "prompt_submitted"
        ? jsonCharacterLength(
            envelopeFieldValue(payload, provider, "metrics", "prompt"),
          )
        : isToolEvent
          ? jsonCharacterLength(
              envelopeFieldValue(payload, provider, "tool", "name"),
            ) +
            jsonCharacterLength(
              envelopeFieldValue(payload, provider, "metrics", "toolInput"),
            )
          : 0,
    outputCharacters:
      eventKind === "tool_call_completed"
        ? jsonCharacterLength(
            envelopeFieldValue(payload, provider, "metrics", "toolOutput"),
          )
        : 0,
  };
}

function mappedEnvelopeFields({ eventKind, payload, payloadStatus, provider }) {
  return {
    event: compact({
      durationMs: durationMs({ eventKind, payload, provider }),
      kind: eventKind,
      providerEventId: envelopeFieldText(
        payload,
        provider,
        "event",
        "providerEventId",
      ),
      status: envelopeFieldText(payload, provider, "event", "status"),
      toolUseId: envelopeFieldText(payload, provider, "event", "toolUseId"),
    }),
    metrics: metrics({ eventKind, payload, payloadStatus, provider }),
    model: compact({
      id: envelopeFieldText(payload, provider, "model", "id"),
      label: envelopeFieldText(payload, provider, "model", "label"),
      reasoningEffort: reasoningEffort({ payload, provider }),
    }),
    session: compact({
      id: envelopeFieldText(payload, provider, "session", "id"),
      isBackground: false,
    }),
    tool: compact({
      name: envelopeFieldText(payload, provider, "tool", "name"),
    }),
    turn: compact({
      id: envelopeFieldText(payload, provider, "turn", "id"),
      mode: envelopeFieldText(payload, provider, "turn", "mode"),
    }),
  };
}

function buildEnvelope({
  eventKind,
  manifest,
  payload,
  payloadStatus,
  provider,
  repoRoot,
  sourceEventName,
}) {
  return {
    actor: compact({
      ...actor(repoRoot),
      providerEmail: envelopeFieldText(
        payload,
        provider,
        "actor",
        "providerEmail",
      ),
    }),
    ...mappedEnvelopeFields({ eventKind, payload, payloadStatus, provider }),
    occurredAt: new Date().toISOString(),
    payloadStatus,
    repository: repositoryMetadata(repoRoot, manifest),
    schemaVersion: 1,
    setupKey: pick(manifest, ["setupKey"]),
    source: compact({
      bridgeVersion,
      hookEventName: payloadEventName(payload, provider) ?? sourceEventName,
      provider,
    }),
  };
}

function endpointUrl({ manifest }) {
  const baseUrl =
    text(process.env.VIOU_AI_CONTROLS_BASE_URL) ??
    pick(manifest, ["endpointBaseUrl"]);
  const endpointPath =
    pick(manifest, ["endpointPath"]) ?? "/api/ai-controls/events";

  return baseUrl ? baseUrl.replace(/\/$/u, "") + endpointPath : null;
}

async function main() {
  try {
    const hookSource = arg("--hook-source");
    const eventKind = arg("--event-kind");
    const sourceEventName = arg("--source-event-name");

    if (arg("--viou-hook-id") !== hookId) {
      discardInput();
      return;
    }

    const repoRoot = resolveRepoRoot();
    const manifest = readManifest(repoRoot);
    const setupKey = pick(manifest, ["setupKey"]);

    if (
      !hookSource ||
      !sourceEventName ||
      !eventKind ||
      !providerContract(hookSource) ||
      !setupKey ||
      !repoRoot
    ) {
      debug("skipping hook because required configuration is missing", {
        hasEventKind: Boolean(eventKind),
        hasHookSource: Boolean(hookSource),
        hasProviderContract: Boolean(providerContract(hookSource)),
        hasRepoRoot: Boolean(repoRoot),
        hasSetupKey: Boolean(setupKey),
        hasSourceEventName: Boolean(sourceEventName),
      });
      discardInput();
      return;
    }

    const { payload, payloadStatus } = await readInput();
    const hookEventName = payloadEventName(payload, hookSource);

    if (hookSource === "claude_code") {
      if (
        shouldSuppressClaudeDuplicate({
          hookEventName,
          payload,
          sourceEventName,
        })
      ) {
        debug("suppressing Cursor-triggered Claude Code hook duplicate", {
          hookSource,
          sourceEventName,
        });
        return;
      }

      if (payloadStatus === "parsed" && hookEventName !== sourceEventName) {
        debug("skipping Claude Code hook because payload event did not match", {
          hookEventName,
          sourceEventName,
        });
        return;
      }
    }

    const endpoint = endpointUrl({ manifest });

    if (!endpoint) {
      debug("skipping hook because endpoint could not be resolved", {
        hookSource,
      });
      return;
    }

    const body = buildEnvelope({
      eventKind,
      manifest,
      payload,
      payloadStatus,
      provider: hookSource,
      repoRoot,
      sourceEventName,
    });

    try {
      const response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      if (!response.ok) {
        debug("tracking request failed", { status: response.status });
      }
    } catch (error) {
      debug("tracking request failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    debug("hook failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

await main();
