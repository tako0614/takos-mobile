import {
  createMobileApiClient,
  mobileOptionalText,
  mobileRecord,
  type FetchLike,
  type MobileSession,
} from "@takosjp/mobile-kit";

/** Canonical public Git pointer accepted by the Takos app-installation facade. */
export interface TakosMobileGitAddress {
  readonly url: string;
  readonly ref: string;
  readonly path: string;
}

export interface TakosMobileCapsulePreview {
  readonly id: string;
  readonly spaceId: string;
  readonly name: string;
  readonly status?: string;
  readonly source?: TakosMobileGitAddress;
  readonly routePath: string;
}

type TakosMobileCapsulePlanOperation = "install" | "upgrade";

/**
 * Exact plan evidence returned by the Takos facade.
 *
 * The mobile client treats `expected` as an opaque, same-host capability. It
 * never reconstructs a Takosumi Source/Capsule/Run request or selects an
 * InstallConfig itself.
 */
export interface TakosMobileGitCapsulePlan {
  readonly operation: TakosMobileCapsulePlanOperation;
  readonly spaceId: string;
  readonly capsuleId: string;
  readonly runId: string;
  readonly runStatus: string;
  readonly source: TakosMobileGitAddress;
  readonly title: string;
  readonly expected: Readonly<Record<string, unknown>>;
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
  readonly source: TakosMobileGitAddress;
}

function capsulePrefix(spaceId: string): string {
  return `/api/spaces/${encodeURIComponent(spaceId)}/capsules`;
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

function capsuleId(value: Record<string, unknown>): string | undefined {
  return mobileOptionalText(value.capsule_id);
}

function sourceFromCapsule(
  value: Record<string, unknown>,
): TakosMobileGitAddress | undefined {
  const source = mobileRecord(value.source);
  if (!source) return undefined;
  if (mobileOptionalText(source.type) !== "git") return undefined;
  const url = mobileOptionalText(source.url);
  const ref = mobileOptionalText(source.ref);
  const path = mobileOptionalText(source.path) ?? ".";
  if (!url || !ref) return undefined;
  try {
    return normalizeGitAddress({ url, ref, path });
  } catch {
    return undefined;
  }
}

export async function loadTakosMobileCapsules(
  input: MobileControlInput & { readonly spaceId: string },
): Promise<readonly TakosMobileCapsulePreview[]> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const envelope = mobileRecord(
    await client.json(capsulePrefix(spaceId)),
  );
  if (!Array.isArray(envelope?.capsules)) {
    throw new Error("Takos response is missing Capsules.");
  }

  const out: TakosMobileCapsulePreview[] = [];
  for (const value of envelope.capsules) {
    const capsule = mobileRecord(value);
    if (!capsule) continue;
    const id = capsuleId(capsule);
    const name =
      mobileOptionalText(capsule.name) ??
      mobileOptionalText(capsule.app_id);
    if (!id || !name) continue;
    const source = sourceFromCapsule(capsule);
    out.push({
      id,
      spaceId,
      name,
      status: mobileOptionalText(capsule.status),
      ...(source ? { source } : {}),
      routePath: "/apps",
    });
  }
  return out;
}

function exactPlanEvidence(value: unknown): {
  readonly expected: Readonly<Record<string, unknown>>;
  readonly capsuleId: string;
  readonly runId: string;
  readonly runStatus: string;
} {
  const envelope = mobileRecord(value);
  const expected = mobileRecord(envelope?.expected);
  if (!expected) {
    throw new Error("Takos response is missing exact plan evidence.");
  }
  const capsule = mobileRecord(envelope?.capsule);
  const run = mobileRecord(envelope?.run);
  const capsuleId =
    mobileOptionalText(expected.capsuleId) ??
    mobileOptionalText(expected.capsule_id) ??
    mobileOptionalText(capsule?.id);
  const runId =
    mobileOptionalText(expected.runId) ??
    mobileOptionalText(expected.run_id) ??
    mobileOptionalText(run?.id);
  if (!capsuleId || !runId) {
    throw new Error("Takos response contains incomplete plan evidence.");
  }
  return {
    expected,
    capsuleId,
    runId,
    runStatus: mobileOptionalText(run?.status) ?? "planned",
  };
}

export async function planTakosMobileGitCapsule(
  input: PlanTakosMobileGitCapsuleInput,
): Promise<TakosMobileGitCapsulePlan> {
  const spaceId = requireTrimmed(input.spaceId, "Workspace is required.");
  const source = normalizeGitAddress(input.source);
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const raw = await client.json(`${capsulePrefix(spaceId)}/git-url/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      git_url: source.url,
      ref: source.ref,
      module_path: source.path,
      ...(input.variables ? { variables: input.variables } : {}),
    }),
  });
  const exact = exactPlanEvidence(raw);
  const envelope = mobileRecord(raw);
  const capsule = mobileRecord(envelope?.capsule);
  return {
    operation: "install",
    spaceId,
    capsuleId: exact.capsuleId,
    runId: exact.runId,
    runStatus: exact.runStatus,
    source,
    title: mobileOptionalText(capsule?.name) ?? sourceName(source.url),
    expected: exact.expected,
    raw,
  };
}

export async function applyTakosMobileCapsulePlan(
  input: MobileControlInput & { readonly plan: TakosMobileGitCapsulePlan },
): Promise<TakosMobileCapsuleMutationResult> {
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const base = `${capsulePrefix(input.plan.spaceId)}/git-url`;
  const revision = input.plan.operation === "upgrade";
  const response = await client.json(
    `${base}${revision ? "/revision" : ""}/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(revision
          ? {
              capsule_id: input.plan.capsuleId,
              operation: "upgrade",
            }
          : {}),
        expected: input.plan.expected,
      }),
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
  const source = normalizeGitAddress(input.source);
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const raw = await client.json(
    `${capsulePrefix(spaceId)}/git-url/revision/plan`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capsule_id: capsuleId,
        operation: "upgrade",
        git_url: source.url,
        ref: source.ref,
        module_path: source.path,
      }),
    },
  );
  const exact = exactPlanEvidence(raw);
  if (exact.capsuleId !== capsuleId) {
    throw new Error("Takos plan evidence belongs to another Capsule.");
  }
  return {
    operation: "upgrade",
    spaceId,
    capsuleId,
    runId: exact.runId,
    runStatus: exact.runStatus,
    source,
    title: sourceName(source.url),
    expected: exact.expected,
    raw,
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
    `${capsulePrefix(spaceId)}/${encodeURIComponent(capsuleId)}`,
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
    capsuleId:
      mobileOptionalText(record.capsuleId) ??
      mobileOptionalText(record.capsule_id) ??
      mobileOptionalText(capsule?.id) ??
      fallbackCapsuleId,
    runId:
      mobileOptionalText(record.runId) ??
      mobileOptionalText(record.run_id) ??
      mobileOptionalText(run?.id),
    status:
      mobileOptionalText(record.status) ??
      mobileOptionalText(run?.status) ??
      mobileOptionalText(capsule?.status),
    raw: response,
  };
}
