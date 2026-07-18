import {
  createMobileApiClient,
  MobileApiError,
  mobileNumber,
  mobileRecord,
  mobileOptionalText,
  type MobileSession,
} from "@takosjp/takosumi-mobile-kit";
import {
  loadTakosMobileCapsules,
  type TakosMobileCapsulePreview,
} from "./apps.ts";
import {
  loadTakosMobileThreadMessages,
  type TakosMobileThreadMessagePreview,
} from "./chat.ts";
import {
  summarizeTakosMobileNotification,
  type TakosMobileNotificationPreview,
} from "./notifications.ts";

export type { TakosMobileThreadMessagePreview } from "./chat.ts";
export type { TakosMobileCapsulePreview } from "./apps.ts";
export type { TakosMobileNotificationPreview } from "./notifications.ts";

export interface TakosMobileHome {
  readonly userName?: string;
  readonly workspaceCount?: number;
  readonly appCount?: number;
  readonly unreadNotifications?: number;
  readonly chatTarget?: TakosMobileChatTarget;
  readonly threadList?: readonly TakosMobileThreadPreview[];
  readonly recentThreads?: readonly TakosMobileThreadPreview[];
  readonly agentTasks?: readonly TakosMobileAgentTaskPreview[];
  readonly memories?: readonly TakosMobileMemoryPreview[];
  readonly apps?: readonly TakosMobileAppPreview[];
  readonly capsules?: readonly TakosMobileCapsulePreview[];
  readonly recentNotifications?: readonly TakosMobileNotificationPreview[];
}

export interface TakosMobileChatTarget {
  readonly spaceId: string;
  readonly spaceName?: string;
}

export interface TakosMobileThreadPreview {
  readonly id: string;
  readonly title: string;
  readonly updatedAt?: string;
  readonly routePath: string;
  readonly recentMessages?: readonly TakosMobileThreadMessagePreview[];
  readonly lastMessage?: TakosMobileThreadMessagePreview;
}

export interface TakosMobileAppPreview {
  readonly id: string;
  readonly interfaceId?: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly spaceId?: string;
  readonly spaceName?: string;
  readonly status?: string;
  readonly launcherPath: string;
  readonly launchTarget: TakosMobileAppLaunchTarget;
}

export type TakosMobileAppLaunchTarget =
  | { readonly kind: "host"; readonly path: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "unavailable" };

export interface TakosMobileAgentTaskPreview {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: string;
  readonly priority?: string;
  readonly threadTitle?: string;
  readonly latestRunStatus?: string;
  readonly updatedAt?: string;
  readonly routePath: string;
}

export interface TakosMobileMemoryPreview {
  readonly id: string;
  readonly type: "episode" | "semantic" | "procedural";
  readonly text: string;
  readonly category?: string;
  readonly importance?: number;
  readonly createdAt?: string;
  readonly routePath: string;
}

export async function loadTakosMobileHome(
  session: MobileSession,
): Promise<TakosMobileHome> {
  const client = createMobileApiClient({ session });
  const [me, spaces, unread, notifications] = await Promise.all([
    optionalJson<TakosMe>(() => client.json("/api/auth/me")),
    optionalJson<TakosSpaces>(() => client.json("/api/spaces")),
    optionalJson<TakosUnread>(() =>
      client.json("/api/notifications/unread-count"),
    ),
    optionalJson<TakosNotifications>(() =>
      client.json("/api/notifications?limit=3"),
    ),
  ]);
  const chatTarget = summarizeChatTarget(spaces?.spaces);
  let threads: TakosThreads | undefined;
  let agentTasks: TakosAgentTasks | undefined;
  let memories: TakosMemories | undefined;
  let capsules: readonly TakosMobileCapsulePreview[] | undefined;
  let launcherSurfaces: TakosApps | undefined;
  if (chatTarget) {
    [threads, agentTasks, memories, capsules, launcherSurfaces] =
      await Promise.all([
        optionalJson<TakosThreads>(() =>
          client.json(
            `/api/spaces/${encodePathSegment(chatTarget.spaceId)}/threads?status=active`,
          ),
        ),
        optionalJson<TakosAgentTasks>(() =>
          client.json(
            `/api/spaces/${encodePathSegment(chatTarget.spaceId)}/agent-tasks?limit=4`,
          ),
        ),
        optionalJson<TakosMemories>(() =>
          client.json(
            `/api/spaces/${encodePathSegment(chatTarget.spaceId)}/memories?limit=4`,
          ),
        ),
        optionalJson(() =>
          loadTakosMobileCapsules({
            session,
            spaceId: chatTarget.spaceId,
          }),
        ),
        optionalJson<TakosApps>(() =>
          client.json("/api/apps", {
            headers: { "x-takos-space-id": chatTarget.spaceId },
          }),
        ),
      ]);
  }
  const threadList =
    chatTarget && Array.isArray(threads?.threads)
      ? threads.threads
          .map((thread) => summarizeThread(thread, chatTarget.spaceId))
          .filter((thread): thread is TakosMobileThreadPreview =>
            Boolean(thread),
          )
          .slice(0, 12)
      : undefined;
  const recentThreads = threadList
    ? await hydrateThreadPreviews(session, threadList.slice(0, 3))
    : undefined;
  const routeSpaceId = chatTarget?.spaceId ?? "me";

  return {
    userName:
      me?.user?.display_name ??
      me?.user?.username ??
      me?.user?.email ??
      undefined,
    workspaceCount: Array.isArray(spaces?.spaces)
      ? spaces.spaces.length
      : undefined,
    appCount: capsules?.length,
    unreadNotifications:
      typeof unread?.unread_count === "number"
        ? unread.unread_count
        : undefined,
    chatTarget,
    threadList,
    recentThreads,
    agentTasks: Array.isArray(agentTasks?.tasks)
      ? agentTasks.tasks
          .map((task) => summarizeAgentTask(task, routeSpaceId))
          .filter((task): task is TakosMobileAgentTaskPreview => Boolean(task))
      : undefined,
    memories: Array.isArray(memories?.memories)
      ? memories.memories
          .map((memory) => summarizeMemory(memory))
          .filter((memory): memory is TakosMobileMemoryPreview =>
            Boolean(memory),
          )
      : undefined,
    apps: capsules
      ? summarizeInstalledApps(
          capsules,
          launcherSurfaces?.apps,
          session.hostUrl,
          chatTarget,
        )
      : undefined,
    capsules,
    recentNotifications: Array.isArray(notifications?.notifications)
      ? notifications.notifications
          .map((notification) => summarizeTakosMobileNotification(notification))
          .filter(
            (notification): notification is TakosMobileNotificationPreview =>
              Boolean(notification),
          )
      : undefined,
  };
}

async function optionalJson<T>(load: () => Promise<T>): Promise<T | undefined> {
  try {
    return await load();
  } catch (error) {
    if (
      error instanceof MobileApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      throw error;
    }
    return undefined;
  }
}

interface TakosMe {
  readonly user?: {
    readonly email?: string;
    readonly username?: string;
    readonly display_name?: string;
  };
}

interface TakosSpaces {
  readonly spaces?: readonly unknown[];
}

interface TakosThreads {
  readonly threads?: readonly unknown[];
}

interface TakosApps {
  readonly apps?: readonly unknown[];
}

interface TakosAgentTasks {
  readonly tasks?: readonly unknown[];
}

interface TakosMemories {
  readonly memories?: readonly unknown[];
}

interface TakosUnread {
  readonly unread_count?: number;
}

interface TakosNotifications {
  readonly notifications?: readonly unknown[];
}

function summarizeAgentTask(
  task: unknown,
  spaceId: string,
): TakosMobileAgentTaskPreview | undefined {
  if (!task || typeof task !== "object") return undefined;
  const record = task as Record<string, unknown>;
  const id = mobileOptionalText(record.id);
  const title = mobileOptionalText(record.title);
  if (!id || !title) return undefined;
  const resumeTarget = mobileRecord(record.resume_target);
  const threadId =
    mobileOptionalText(resumeTarget?.thread_id) ??
    mobileOptionalText(record.thread_id);
  const latestRun = mobileRecord(record.latest_run);
  return {
    id,
    title,
    description: mobileOptionalText(record.description)?.slice(0, 160),
    status: mobileOptionalText(record.status),
    priority: mobileOptionalText(record.priority),
    threadTitle: mobileOptionalText(record.thread_title),
    latestRunStatus: mobileOptionalText(latestRun?.status),
    updatedAt:
      mobileOptionalText(record.updated_at) ??
      mobileOptionalText(record.created_at),
    routePath: threadId
      ? `/chat/${encodePathSegment(spaceId)}/${encodePathSegment(threadId)}`
      : "/chat",
  };
}

function summarizeMemory(
  memory: unknown,
): TakosMobileMemoryPreview | undefined {
  if (!memory || typeof memory !== "object") return undefined;
  const record = memory as Record<string, unknown>;
  const id = mobileOptionalText(record.id);
  const type = readMemoryType(record.type);
  const text =
    mobileOptionalText(record.summary) ?? mobileOptionalText(record.content);
  if (!id || !type || !text) return undefined;
  return {
    id,
    type,
    text: text.slice(0, 180),
    category: mobileOptionalText(record.category),
    importance: mobileNumber(record.importance),
    createdAt: mobileOptionalText(record.created_at),
    routePath: "/memory",
  };
}

interface AuthorizedUiSurface {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: string;
  readonly launchTarget: Exclude<
    TakosMobileAppLaunchTarget,
    { readonly kind: "unavailable" }
  >;
}

function summarizeAuthorizedUiSurface(
  value: unknown,
  hostUrl: string,
): AuthorizedUiSurface | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.owner_kind !== "Capsule" ||
    record.interface_type !== "interface.ui.surface" ||
    record.interface_version !== "1"
  ) {
    return undefined;
  }
  const id = mobileOptionalText(record.id);
  const ownerId = mobileOptionalText(record.owner_id);
  const name = mobileOptionalText(record.name);
  const launchTarget = readAppLaunchTarget(record.url, hostUrl);
  if (!id || !ownerId || !name || launchTarget.kind === "unavailable") {
    return undefined;
  }
  return {
    id,
    ownerId,
    name,
    description: mobileOptionalText(record.description)?.slice(0, 120),
    category: mobileOptionalText(record.category),
    launchTarget,
  };
}

function summarizeInstalledApps(
  capsules: readonly TakosMobileCapsulePreview[],
  surfaceValues: readonly unknown[] | undefined,
  hostUrl: string,
  chatTarget: TakosMobileChatTarget | undefined,
): readonly TakosMobileAppPreview[] {
  const surfaceByCapsuleId = new Map<string, AuthorizedUiSurface>();
  if (Array.isArray(surfaceValues)) {
    for (const value of surfaceValues) {
      const surface = summarizeAuthorizedUiSurface(value, hostUrl);
      if (surface && !surfaceByCapsuleId.has(surface.ownerId)) {
        surfaceByCapsuleId.set(surface.ownerId, surface);
      }
    }
  }
  return capsules.map((capsule) => {
    const surface = surfaceByCapsuleId.get(capsule.id);
    return {
      id: capsule.id,
      ...(surface ? { interfaceId: surface.id } : {}),
      name: surface?.name ?? capsule.name,
      ...(surface?.description ? { description: surface.description } : {}),
      ...(surface?.category ? { category: surface.category } : {}),
      spaceId: capsule.spaceId,
      ...(chatTarget?.spaceName ? { spaceName: chatTarget.spaceName } : {}),
      status: capsule.status,
      launcherPath: capsule.routePath,
      launchTarget: surface?.launchTarget ?? { kind: "unavailable" },
    };
  });
}

function summarizeChatTarget(
  spaces: readonly unknown[] | undefined,
): TakosMobileChatTarget | undefined {
  if (!Array.isArray(spaces)) return undefined;
  for (const space of spaces) {
    const target = summarizeSpaceAsChatTarget(space);
    if (target?.spaceId === "me") return target;
  }
  return spaces
    .map((space) => summarizeSpaceAsChatTarget(space))
    .find((target): target is TakosMobileChatTarget => Boolean(target));
}

function summarizeSpaceAsChatTarget(
  space: unknown,
): TakosMobileChatTarget | undefined {
  if (!space || typeof space !== "object") return undefined;
  const record = space as Record<string, unknown>;
  const spaceId =
    record.kind === "user" || record.is_personal === true
      ? "me"
      : (mobileOptionalText(record.slug) ?? mobileOptionalText(record.id));
  if (!spaceId) return undefined;
  return {
    spaceId,
    spaceName: mobileOptionalText(record.name),
  };
}

function summarizeThread(
  thread: unknown,
  spaceId: string,
): TakosMobileThreadPreview | undefined {
  if (!thread || typeof thread !== "object") return undefined;
  const record = thread as Record<string, unknown>;
  const id = mobileOptionalText(record.id);
  if (!id) return undefined;
  return {
    id,
    title: mobileOptionalText(record.title) ?? "Untitled chat",
    updatedAt:
      mobileOptionalText(record.updated_at) ??
      mobileOptionalText(record.created_at),
    routePath: `/chat/${encodePathSegment(spaceId)}/${encodePathSegment(id)}`,
  };
}

async function hydrateThreadPreviews(
  session: MobileSession,
  threads: readonly TakosMobileThreadPreview[],
): Promise<readonly TakosMobileThreadPreview[]> {
  return await Promise.all(
    threads.map(async (thread) => {
      const page = await optionalJson(() =>
        loadTakosMobileThreadMessages({
          session,
          threadId: thread.id,
          limit: 5,
          latest: true,
        }),
      );
      const recentMessages = page?.messages ?? [];
      const lastMessage = recentMessages[recentMessages.length - 1];
      return recentMessages.length > 0
        ? { ...thread, recentMessages, lastMessage }
        : thread;
    }),
  );
}

function readAppLaunchTarget(
  value: unknown,
  hostUrl: string,
): TakosMobileAppLaunchTarget {
  if (typeof value !== "string") return { kind: "unavailable" };
  const raw = value.trim();
  if (!raw) return { kind: "unavailable" };
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return { kind: "host", path: raw };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { kind: "unavailable" };
    }
    if (url.username || url.password) return { kind: "unavailable" };
    const host = new URL(hostUrl);
    if (url.origin === host.origin) {
      return {
        kind: "host",
        path: `${url.pathname}${url.search}${url.hash}`,
      };
    }
    return { kind: "external", url: url.toString() };
  } catch {
    return { kind: "unavailable" };
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function readMemoryType(
  value: unknown,
): TakosMobileMemoryPreview["type"] | undefined {
  return value === "episode" || value === "semantic" || value === "procedural"
    ? value
    : undefined;
}
