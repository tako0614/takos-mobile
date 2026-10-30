import { expect, test } from "bun:test";
import {
  createMobileClientController,
  mobileSessionStorageKey,
  type FetchLike,
  type MobileSession,
  type NativeBridge,
} from "@takosjp/mobile-kit";
import { productAdapter } from "../src/product.ts";
import { createHostRouteHandoff } from "../src/host-route.ts";

// TASK-0119 step 5: what Takosumi sends and what this app does with it.
// Takosumi fills the trusted templates for this app (scheme `takos`,
// package/bundle `jp.takos.mobile`) with the screen URL's origin, URL-encoded:
//   takos://connect?host_url={origin}
//   takos://connect?host_url={origin}&product=takos
const A = "https://a.takos.example";
const B = "https://b.takos.example";

function takosumiConnectLink(origin: string, withProduct: boolean): string {
  const link = `takos://connect?host_url=${encodeURIComponent(origin)}`;
  return withProduct ? `${link}&product=takos` : link;
}

test("both Takosumi connect templates find the host and stop before sign-in", async () => {
  for (const withProduct of [false, true]) {
    const { controller } = setup();
    await controller.handleLaunchPayload(takosumiConnectLink(A, withProduct));
    expect(controller.getState().discovery?.hostUrl).toBe(A);
    expect(controller.getState().session).toBeUndefined();
    controller.stop();
  }
});

test("a connect link for another host while signed in asks and keeps the current session", async () => {
  const { controller, browser } = setup();
  await signIn(controller, A);

  await controller.handleLaunchPayload(takosumiConnectLink(B, true));
  expect(controller.getState().session?.hostUrl).toBe(A);
  expect(controller.getState().session?.accessToken).toBe("a.takos.example-session");
  expect(controller.getState().discovery?.hostUrl).toBe(B);

  await controller.signInWithPassword("pw");
  expect(controller.getState().session?.hostUrl).toBe(B);
  expect(controller.getState().discovery).toBeUndefined();
  const accountA = controller.getState().accounts.find((a) => a.hostUrl === A)!;
  await controller.switchAccount(accountA.id);
  expect(controller.getState().session?.accessToken).toBe("a.takos.example-session");
  expect(browser).toEqual([]);
  controller.stop();
});

test("a connect link for the host in use just opens the app", async () => {
  const { controller, requests, browser } = setup();
  await signIn(controller, A);
  const before = requests.length;
  await controller.handleLaunchPayload(takosumiConnectLink(A, false));
  expect(controller.getState().discovery).toBeUndefined();
  expect(controller.getState().session?.hostUrl).toBe(A);
  expect(requests.length).toBe(before);
  expect(browser).toEqual([]);
  controller.stop();
});

test("route links open that screen of the connected host in the browser", async () => {
  const { controller, browser } = setup();
  await signIn(controller, A);

  await controller.handleLaunchPayload(`takos://open?path=%2Fchat&host_url=${encodeURIComponent(A)}`);
  await controller.handleLaunchPayload("takos://open?path=%2Fchat%2Fme%2Fthread-1%3Fview%3Dfull");
  // A Takosumi screen URL (`{url}`) on the host.
  await controller.handleLaunchPayload(`takos://open?url=${encodeURIComponent(`${A}/`)}`);
  expect(browser).toEqual([
    `${A}/chat`,
    `${A}/chat/me/thread-1?view=full`,
    `${A}/`,
  ]);
  expect(controller.getState().pendingRoute).toBeUndefined();
  controller.stop();
});

test("a route link waits for sign-in and then opens on that host", async () => {
  const { controller, browser } = setup();
  await controller.handleLaunchPayload(
    `takos://open?path=%2Fapps&host_url=${encodeURIComponent(A)}`,
  );
  expect(controller.getState().discovery?.hostUrl).toBe(A);
  expect(browser).toEqual([]);
  await controller.signInWithPassword("pw");
  expect(browser).toEqual([`${A}/apps`]);
  controller.stop();
});

test("a route link for another saved host asks before switching", async () => {
  const { controller, browser } = setup();
  await signIn(controller, A);
  await controller.handleLaunchPayload(takosumiConnectLink(B, true));
  await controller.signInWithPassword("pw");
  expect(controller.getState().session?.hostUrl).toBe(B);

  await controller.handleLaunchPayload(
    `takos://open?path=%2Fnotifications&host_url=${encodeURIComponent(A)}`,
  );
  expect(controller.getState().session?.hostUrl).toBe(B);
  expect(controller.getState().discovery?.hostUrl).toBe(A);
  expect(browser).toEqual([]);

  const accountA = controller.getState().accounts.find((a) => a.hostUrl === A)!;
  await controller.switchAccount(accountA.id);
  expect(controller.getState().session?.hostUrl).toBe(A);
  expect(browser).toEqual([`${A}/notifications`]);
  controller.stop();
});

test("unsafe route links are refused before anything opens", async () => {
  const { controller, browser } = setup();
  await signIn(controller, A);
  for (const link of [
    "takos://open?path=%2F%5Cevil.example",
    "takos://open?path=%2F%2Fevil.example",
    "takos://open?url=javascript%3Aalert(1)",
    "takos://open?path=%2Foauth%2Fcallback%3Fcode%3Dattacker",
    "takos://open?path=%2F%23access_token%3Dt",
    "takos://open?path=%2Fchat%3Ftoken%3Dt",
    `takos://open?path=%2F&host_url=${encodeURIComponent("http://evil.example")}`,
    `takos://open?url=${encodeURIComponent("https://evil.example/x")}&host_url=${encodeURIComponent(A)}`,
  ]) {
    await controller.handleLaunchPayload(link);
    expect(controller.getState().session?.hostUrl, link).toBe(A);
    expect(controller.getState().discovery, link).toBeUndefined();
    expect(controller.getState().pendingRoute, link).toBeUndefined();
  }
  expect(browser).toEqual([]);
  controller.stop();
});

test("the route handoff refuses a URL on another host", async () => {
  const opened: string[] = [];
  const handoff = createHostRouteHandoff(async (url) => void opened.push(url));
  await expect(
    handoff({ session: session(A), path: "/", url: `${B}/` }),
  ).rejects.toThrow("not on the connected Takos host");
  expect(opened).toEqual([]);
});

test("an install from before multi-account keeps its session after the update", async () => {
  const bridge = memoryBridge();
  const { fetch } = takosHosts();
  // The single-session shape and key that earlier releases stored.
  await bridge.secureStore!.set(
    mobileSessionStorageKey(productAdapter),
    JSON.stringify({
      hostUrl: A,
      product: "takos",
      oidcIssuer: A,
      oidcClientId: "takos-mobile",
      accessToken: "legacy-access",
      tokenType: "Bearer",
      refreshToken: "legacy-refresh",
      scope: "openid profile offline_access",
      createdAt: "2026-10-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
  );
  const homes: string[] = [];
  const loadHome = async (current: MobileSession) => {
    homes.push(current.accessToken);
    return {};
  };
  const first = createMobileClientController({
    adapter: productAdapter, nativeBridge: bridge, fetch, loadHome,
  });
  await first.start();
  expect(first.getState().session?.accessToken).toBe("legacy-access");
  expect(first.getState().session?.refreshToken).toBe("legacy-refresh");
  expect(first.getState().accounts.map((a) => a.hostUrl)).toEqual([A]);
  first.stop();

  const second = createMobileClientController({
    adapter: productAdapter, nativeBridge: bridge, fetch, loadHome,
  });
  await second.start();
  expect(second.getState().session?.accessToken).toBe("legacy-access");
  expect(homes).toEqual(["legacy-access", "legacy-access"]);
  second.stop();
});

function setup() {
  const bridge = memoryBridge();
  const { fetch, requests } = takosHosts();
  const browser: string[] = [];
  const controller = createMobileClientController({
    adapter: productAdapter,
    nativeBridge: bridge,
    fetch,
    openHostRoute: createHostRouteHandoff(async (url) => void browser.push(url)),
  });
  return { controller, bridge, requests, browser };
}

async function signIn(
  controller: ReturnType<typeof createMobileClientController>,
  hostUrl: string,
) {
  await controller.connectWithInput(hostUrl);
  await controller.signInWithPassword("pw");
  expect(controller.getState().session?.hostUrl).toBe(hostUrl);
}

function session(hostUrl: string): MobileSession {
  return {
    hostUrl,
    product: "takos",
    accessToken: "t",
    tokenType: "Bearer",
    createdAt: "2026-10-30T00:00:00.000Z",
  };
}

/** Two Takos hosts that each mint their own host session. */
function takosHosts(): { fetch: FetchLike; requests: string[] } {
  const requests: string[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (url.pathname === "/.well-known/takos") {
      return Response.json({
        product: "takos",
        auth: { oidc: false, password: true },
        endpoints: {
          mobilePasswordLogin: "/api/auth/mobile/login",
          mobileLogout: "/api/auth/logout",
        },
      });
    }
    if (url.pathname === "/api/auth/mobile/login" && init?.method === "POST") {
      return Response.json({
        access_token: `${url.hostname}-session`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch, requests };
}

function memoryBridge(): NativeBridge {
  const secure = new Map<string, string>();
  const plain = new Map<string, string>();
  return {
    capabilities: {
      launchPayload: true,
      launchPayloadEvents: false,
      externalBrowser: true,
      inAppBrowser: false,
      qrScanner: false,
      localNotifications: false,
      pushNotifications: false,
      biometricAuth: false,
      callIntent: false,
      clipboardText: false,
      secureStorage: true,
      persistentStorage: true,
    },
    storage: {
      kind: "device-persistent",
      get: async (key) => plain.get(key),
      set: async (key, value) => void plain.set(key, value),
      delete: async (key) => void plain.delete(key),
    },
    secureStore: {
      kind: "secure",
      get: async (key) => secure.get(key),
      set: async (key, value) => void secure.set(key, value),
      delete: async (key) => void secure.delete(key),
    },
    getLaunchPayload: async () => undefined,
    openExternalUrl: async () => undefined,
  };
}
