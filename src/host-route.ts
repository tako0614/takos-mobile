import { normalizeHostUrl, type MobileSession } from "@takosjp/mobile-kit";

/** What the shared shell hands a product for one host route. */
export interface HostRouteHandoffInput {
  readonly session: MobileSession;
  readonly path: string;
  readonly url: string;
}

/**
 * Opens a connected Takos host's own screen (workspace, chat, apps,
 * notifications, a Capsule's route) in the system browser. This is the
 * "route handoff" behind the shortcuts, the home cards, tapped notifications
 * and `takos://open?path=…` / `?url=…` links. The browser has its own Takos
 * web session; the mobile bearer token is never passed to it.
 *
 * mobile-kit has already resolved `url` from an absolute path on the
 * connected host (and, for links, refused other origins and credential
 * parameters). The origin is checked again here before anything opens.
 */
export function createHostRouteHandoff(
  openInBrowser: (url: string) => Promise<void>,
): (input: HostRouteHandoffInput) => Promise<void> {
  return async ({ session, url }) => {
    const hostUrl = normalizeHostUrl(session.hostUrl);
    const target = new URL(url);
    if (target.origin !== hostUrl || target.username || target.password) {
      throw new Error("The link is not on the connected Takos host.");
    }
    await openInBrowser(target.toString());
  };
}
