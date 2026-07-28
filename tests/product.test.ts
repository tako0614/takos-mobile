import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { productAdapter } from "../src/product.ts";

test("Takos mobile does not advertise host creation without a releasable distribution", () => {
  expect(productAdapter).not.toHaveProperty("hostCenterLabel");
  expect(productAdapter).not.toHaveProperty("hostCenterUrl");
  expect(productAdapter).not.toHaveProperty("hostCenterSource");
});

test("Takos mobile requests Takos API and Capsule delegation scopes", () => {
  expect(productAdapter.oidcScopes).toEqual(
    expect.arrayContaining([
      "openid",
      "profile",
      "email",
      "offline_access",
      "capsules:read",
      "capsules:write",
      "spaces:read",
      "spaces:write",
      "threads:read",
      "threads:write",
      "runs:read",
      "runs:write",
    ]),
  );
});

test("Takos mobile has an exact callback scheme and a fail-closed WebView CSP", () => {
  const config = JSON.parse(
    readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
  ) as {
    readonly app?: { readonly security?: { readonly csp?: unknown } };
    readonly plugins?: {
      readonly "deep-link"?: {
        readonly mobile?: readonly { readonly scheme?: readonly string[] }[];
      };
    };
  };
  const csp = config.app?.security?.csp;
  expect(productAdapter.mobileScheme).toBe("takos");
  expect(config.plugins?.["deep-link"]?.mobile?.[0]?.scheme).toContain("takos");
  expect(typeof csp).toBe("string");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("http://ipc.localhost");
  expect(csp).not.toContain("http://*");
});

test("Takos desktop stores the Stronghold seed in an OS credential store", () => {
  const cargo = readFileSync(
    new URL("../src-tauri/Cargo.toml", import.meta.url),
    "utf8",
  );
  const pluginCargo = readFileSync(
    new URL("../src-tauri/plugins/keystore/Cargo.toml", import.meta.url),
    "utf8",
  );
  const rustEntry = readFileSync(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  const plugin = readFileSync(
    new URL("../src-tauri/plugins/keystore/src/lib.rs", import.meta.url),
    "utf8",
  );

  expect(cargo).toContain(
    'tauri-plugin-keystore = { path = "plugins/keystore" }',
  );
  expect(pluginCargo).toContain('keyring = { version = "3.6.3"');
  expect(rustEntry).toContain(".plugin(tauri_plugin_keystore::init())");
  expect(plugin).not.toContain("#![cfg(mobile)]");
});
