import solid from "vite-plugin-solid";
import { createTauriMobileViteConfig } from "@takosjp/takosumi-mobile-kit/vite";

const devPort = 1420;

export default createTauriMobileViteConfig({
  devPort,
  importMetaUrl: import.meta.url,
  resolveMobileKitFromPackage: true,
  plugins: [solid()],
});
