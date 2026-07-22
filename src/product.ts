import type { MobileProductAdapter } from "@takosjp/mobile-kit";

export const productAdapter: MobileProductAdapter = {
  product: "takos",
  appName: "Takos",
  hostNoun: "Takos host",
  urlPlaceholder: "https://workspace.example.com",
  primaryActionLabel: "Connect to Takos",
  // Takos brand red, kept equal to the `theme-color` the Takos web app
  // declares in `takos/web/index.html`.
  accentColor: "#E53935",
  mobileScheme: "takos",
  oidcScopes: [
    "openid",
    "profile",
    "offline_access",
    "spaces:read",
    "spaces:write",
    "threads:read",
    "threads:write",
    "runs:read",
    "runs:write",
    "agents:execute",
    "memories:read",
    "memories:write",
  ],
};
