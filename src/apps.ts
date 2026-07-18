import {
  createMobileApiClient,
  mobileRecord,
  mobileOptionalText,
  type FetchLike,
  type MobileSession,
} from "@takosjp/takosumi-mobile-kit";

/** Canonical public Git pointer used by Takosumi Source/Capsule planning. */
export interface TakosMobileGitAddress {
  readonly url: string;
  readonly ref: string;
  readonly path: string;
}

const DEFAULT_INSTALL_CONFIG_ID = "cfg-default-opentofu-capsule";
const DEFAULT_INSTALL_CONFIG_NAME = "opentofu-capsule";

export interface TakosMobileCapsulePreview {
  readonly id: string;
  readonly spaceId: string;
  readonly sourceId: string;
  readonly name: string;
  readonly status?: string;
  readonly source?: TakosMobileGitAddress;
  readonly routePath: string;
}

export interface TakosMobileGitCapsulePlan {
  readonly spaceId: string;
  readonly sourceId: string;
  readonly capsuleId: string;
  readonly runId: string;
  readonly runStatus: string;
  readonly source: TakosMobileGitAddress;
  readonly title: string;
  readonly raw: unknown;
}

export interface TakosMobileCapsuleMutationResult {
  readonly capsuleId?: string;
  readonly runId?: string;
  readonly status?: string;
  readonly raw: unknown;
}

type MobileControlInput = {
  readonly session: MobileSession;
  readonly fetch?: FetchLike;
};

export interface PlanTakosMobileGitCapsuleInput extends MobileControlInput {
  readonly spaceId: string;
  readonly source: TakosMobileGitAddress;
  readonly variables?: Record<string, unknown>;
}

export interface PlanTakosMobileCapsuleUpdateInput extends MobileControlInput {
  readonly spaceId: string;
  readonly capsuleId: string;
  readonly sourceId: string;
  readonly source: TakosMobileGitAddress;
}

function prefix(spaceId: string): string {
  return `/api/spaces/${encodeURIComponent(spaceId)}`;
}

function requireTrimmed(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function assertHttpsGitUrl(gitUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(gitUrl);
  } catch {
    throw new Error("Git URL must be an HTTPS URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Git URL must be an HTTPS URL without credentials.");
  }
}

function assertSafeModulePath(modulePath: string): void {
  if (
    modulePath.startsWith("/") ||
    modulePath.includes("\\") ||
    modulePath.includes("\0") ||
    modulePath.split("/").some((part) => part === "..")
  ) {
    throw new Error("Module path must be repository-relative.");
  }
}

function normalizedGitIdentity(value: unknown): string | null {
  const input = mobileOptionalText(value);
  if (!input) return null;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    ) {
      return null;
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\.git\/?$/iu, "").replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedModulePath(value: string): string {
  const path = value.trim() || ".";
  assertSafeModulePath(path);
  return path === "."
    ? "."
    : path.replace(/^\.\//u, "").replace(/\/+$/u, "") || ".";
}

function sourceName(gitUrl: string): string {
  const parsed = new URL(gitUrl);
  return (
    parsed.pathname
      .split("/")
      .filter(Boolean)
      .at(-1)
      ?.replace(/\.git$/iu, "") || "capsule"
  );
}

function normalizeGitAddress(
  source: TakosMobileGitAddress,
): TakosMobileGitAddress {
  const url = requireTrimmed(source.url, "Git URL is required.");
  assertHttpsGitUrl(url);
  const ref = requireTrimmed(source.ref, "Git ref is required.");
  const path = normalizedModulePath(source.path);
  return { url, ref, path };
}

function runFrom(value: unknown): Record<string, unknown> {
  const run = mobileRecord(mobileRecord(value)?.run);
  if (!run || !mobileOptionalText(run.id)) {
    throw new Error("Takosumi response is missing a Run.");
  }
  return run;
}

async function waitForRun(
  client: ReturnType<typeof createMobileApiClient>,
  spaceId: string,
  initial: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let run = initial;
  let delayMs = 500;
  const startedAt = Date.now();
  for (;;) {
    const status = mobileOptionalText(run.status) ?? "queued";
    if (status === "succeeded" || status === "waiting_approval") return run;
    if (["failed", "cancelled", "expired"].includes(status)) {
      throw new Error(`Run ${mobileOptionalText(run.id) ?? ""} ${status}.`);
    }
    if (Date.now() - startedAt > 180_000) {
      throw new Error(`Run is still ${status}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(Math.round(delayMs * 1.4), 3_000);
    const runId = mobileOptionalText(run.id)!;
    run = runFrom(
      await client.json(`${prefix(spaceId)}/runs/${encodeURIComponent(runId)}`),
    );
  }
}

/**
 * Select execution policy only from a Takosumi DB-owned InstallConfig.
 * First-party configs are associated by the Store discovery identity
 * (canonical Git URL + module path). Store ref hints never select execution
 * policy; the explicit Source/Run owns the requested ref. Display names never
 * associate a config with a source. Name matching is reserved for the stable
 * generic OpenTofu fallback.
 */
export function selectTakosMobileInstallConfigId(
  configs: readonly unknown[],
  requested: TakosMobileGitAddress,
): string | undefined {
  const sourceAddress = normalizeGitAddress(requested);
  const requestedGit = normalizedGitIdentity(sourceAddress.url);
  const exactIds: string[] = [];
  const parsed = configs
    .map((value) => mobileRecord(value))
    .filter((value): value is Record<string, unknown> => value !== null);

  for (const config of parsed) {
    const id = mobileOptionalText(config.id);
    const source = mobileRecord(mobileRecord(config.store)?.source);
    const git = mobileOptionalText(source?.url);
    const path = mobileOptionalText(source?.path);
    if (!id || !git || !path) continue;
    let configuredPath: string;
    try {
      configuredPath = normalizedModulePath(path);
    } catch {
      continue;
    }
    if (
      normalizedGitIdentity(git) === requestedGit &&
      configuredPath === sourceAddress.path
    ) {
      exactIds.push(id);
    }
  }
  if (exactIds.length > 1) {
    throw new Error(
      "Takosumi returned multiple InstallConfigs for the same canonical Git URL and module path.",
    );
  }
  if (exactIds.length === 1) return exactIds[0];

  const stableFallback = parsed.find(
    (config) =>
      mobileOptionalText(config.id) === DEFAULT_INSTALL_CONFIG_ID &&
      !mobileRecord(config.store),
  );
  const stableFallbackId = mobileOptionalText(stableFallback?.id);
  if (stableFallbackId) return stableFallbackId;

  const namedFallback = parsed.find(
    (config) =>
      mobileOptionalText(config.name) === DEFAULT_INSTALL_CONFIG_NAME &&
      Boolean(mobileOptionalText(config.id)) &&
      !mobileRecord(config.store),
  );
  return mobileOptionalText(namedFallback?.id);
}

async function installConfigIdForGitAddress(
  client: ReturnType<typeof createMobileApiClient>,
  spaceId: string,
  source: TakosMobileGitAddress,
): Promise<string> {
  const response = mobileRecord(
    await client.json(`${prefix(spaceId)}/capsule-configs`),
  );
  const configs = response?.installConfigs;
  if (!Array.isArray(configs)) {
    throw new Error("Takosumi InstallConfig list is unavailable.");
  }
  const id = selectTakosMobileInstallConfigId(configs, source);
  if (id) return id;
  throw new Error(
    "Takosumi has no InstallConfig matching this Git source and no generic fallback.",
  );
}

export async function loadTakosMobileCapsules(
  input: MobileControlInput & { readonly spaceId: string },
): Promise<readonly TakosMobileCapsulePreview[]> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const [capsuleEnvelope, sourceEnvelope] = await Promise.all([
    client.json(`${prefix(spaceId)}/capsules`),
    client.json(`${prefix(spaceId)}/sources`),
  ]);
  const sources = mobileRecord(sourceEnvelope)?.sources;
  const sourcesById = new Map<string, Record<string, unknown>>();
  if (Array.isArray(sources)) {
    for (const value of sources) {
      const source = mobileRecord(value);
      const id = mobileOptionalText(source?.id);
      if (source && id) sourcesById.set(id, source);
    }
  }
  const capsules = mobileRecord(capsuleEnvelope)?.capsules;
  if (!Array.isArray(capsules)) return [];
  const out: TakosMobileCapsulePreview[] = [];
  for (const value of capsules) {
    const capsule = mobileRecord(value);
    const id = mobileOptionalText(capsule?.id);
    const sourceId = mobileOptionalText(capsule?.sourceId);
    const name = mobileOptionalText(capsule?.name);
    if (!id || !sourceId || !name) continue;
    const source = sourcesById.get(sourceId);
    const url = mobileOptionalText(source?.url);
    const ref = mobileOptionalText(source?.defaultRef);
    const path = mobileOptionalText(source?.defaultPath);
    out.push({
      id,
      spaceId,
      sourceId,
      name,
      status: mobileOptionalText(capsule?.status),
      ...(url && ref && path ? { source: { url, ref, path } } : {}),
      routePath: "/apps",
    });
  }
  return out;
}

export async function planTakosMobileGitCapsule(
  input: PlanTakosMobileGitCapsuleInput,
): Promise<TakosMobileGitCapsulePlan> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const sourceAddress = normalizeGitAddress(input.source);
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const name = sourceName(sourceAddress.url);
  const installConfigId = await installConfigIdForGitAddress(
    client,
    spaceId,
    sourceAddress,
  );
  const sourceEnvelope = mobileRecord(
    await client.json(`${prefix(spaceId)}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        url: sourceAddress.url,
        defaultRef: sourceAddress.ref,
        defaultPath: sourceAddress.path,
        autoSync: false,
      }),
    }),
  );
  const source = mobileRecord(sourceEnvelope?.source);
  const sourceId = mobileOptionalText(source?.id);
  if (!sourceId) throw new Error("Takosumi response is missing a Source.");
  const syncEnvelope = await client.json(
    `${prefix(spaceId)}/sources/${encodeURIComponent(sourceId)}/sync`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "manual_plan" }),
    },
  );
  await waitForRun(client, spaceId, runFrom(syncEnvelope));
  const capsuleEnvelope = mobileRecord(
    await client.json(`${prefix(spaceId)}/capsules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        environment: "production",
        sourceId,
        installConfigId,
        ...(sourceAddress.path !== "."
          ? { modulePath: sourceAddress.path }
          : {}),
        ...(input.variables ? { vars: input.variables } : {}),
      }),
    }),
  );
  const capsule = mobileRecord(capsuleEnvelope?.capsule);
  const capsuleId = mobileOptionalText(capsule?.id);
  if (!capsuleId) throw new Error("Takosumi response is missing a Capsule.");
  const planEnvelope = await client.json(
    `${prefix(spaceId)}/capsules/${encodeURIComponent(capsuleId)}/plan`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  const run = await waitForRun(client, spaceId, runFrom(planEnvelope));
  const runId = mobileOptionalText(run.id)!;
  return {
    spaceId,
    sourceId,
    capsuleId,
    runId,
    runStatus: mobileOptionalText(run.status) ?? "succeeded",
    source: sourceAddress,
    title: name,
    raw: planEnvelope,
  };
}

export async function applyTakosMobileCapsulePlan(
  input: MobileControlInput & { readonly plan: TakosMobileGitCapsulePlan },
): Promise<TakosMobileCapsuleMutationResult> {
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  if (input.plan.runStatus === "waiting_approval") {
    await client.json(
      `${prefix(input.plan.spaceId)}/runs/${encodeURIComponent(input.plan.runId)}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Approved in Takos mobile" }),
      },
    );
  }
  const response = await client.json(
    `${prefix(input.plan.spaceId)}/runs/${encodeURIComponent(input.plan.runId)}/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  return summarizeMutation(response, input.plan.capsuleId);
}

export async function installTakosMobileGitCapsule(
  input: PlanTakosMobileGitCapsuleInput,
): Promise<TakosMobileCapsuleMutationResult> {
  const plan = await planTakosMobileGitCapsule(input);
  return await applyTakosMobileCapsulePlan({
    session: input.session,
    fetch: input.fetch,
    plan,
  });
}

export async function planTakosMobileCapsuleUpdate(
  input: PlanTakosMobileCapsuleUpdateInput,
): Promise<TakosMobileGitCapsulePlan> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const capsuleId = requireTrimmed(input.capsuleId, "Capsule id is required.");
  const sourceId = requireTrimmed(input.sourceId, "Source id is required.");
  const sourceAddress = normalizeGitAddress(input.source);
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  await client.json(
    `${prefix(spaceId)}/sources/${encodeURIComponent(sourceId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: sourceAddress.url,
        defaultRef: sourceAddress.ref,
        defaultPath: sourceAddress.path,
      }),
    },
  );
  const syncEnvelope = await client.json(
    `${prefix(spaceId)}/sources/${encodeURIComponent(sourceId)}/sync`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "manual_plan" }),
    },
  );
  await waitForRun(client, spaceId, runFrom(syncEnvelope));
  const planEnvelope = await client.json(
    `${prefix(spaceId)}/capsules/${encodeURIComponent(capsuleId)}/plan`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  const run = await waitForRun(client, spaceId, runFrom(planEnvelope));
  return {
    spaceId,
    sourceId,
    capsuleId,
    runId: mobileOptionalText(run.id)!,
    runStatus: mobileOptionalText(run.status) ?? "succeeded",
    source: sourceAddress,
    title: sourceName(sourceAddress.url),
    raw: planEnvelope,
  };
}

export async function removeTakosMobileCapsule(
  input: MobileControlInput & {
    readonly spaceId: string;
    readonly capsuleId: string;
  },
): Promise<TakosMobileCapsuleMutationResult> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const capsuleId = requireTrimmed(input.capsuleId, "Capsule id is required.");
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json(
    `${prefix(spaceId)}/capsules/${encodeURIComponent(capsuleId)}`,
    { method: "DELETE" },
  );
  return summarizeMutation(response, capsuleId);
}

function summarizeMutation(
  response: unknown,
  fallbackCapsuleId?: string,
): TakosMobileCapsuleMutationResult {
  const record = mobileRecord(response) ?? {};
  const capsule = mobileRecord(record.capsule);
  const run = mobileRecord(record.run);
  return {
    capsuleId: mobileOptionalText(capsule?.id) ?? fallbackCapsuleId,
    runId: mobileOptionalText(run?.id),
    status:
      mobileOptionalText(run?.status) ?? mobileOptionalText(capsule?.status),
    raw: response,
  };
}
