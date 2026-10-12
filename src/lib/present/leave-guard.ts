// Unsaved-changes guard for the report editor: which link clicks leave the page through the
// client-side router (beforeunload does not fire for those, so the editor asks itself).

export const LEAVE_UNSAVED_MESSAGE = "Du har ändringar som inte är sparade. Vill du lämna sidan?";

export interface LinkClick {
  href: string;
  target: string | null;
  download: boolean;
  /** MouseEvent.button: 0 = main button. */
  button: number;
  /** Ctrl, Cmd, Shift or Alt held: the browser opens a new tab or window instead. */
  modified: boolean;
  defaultPrevented: boolean;
}

export interface PageLocation {
  origin: string;
  pathname: string;
  search: string;
}

/**
 * Whether the click navigates this tab to another page of the app. Links to other origins
 * are left to beforeunload (the browser's own prompt), new tabs and in-page anchors keep the
 * editor open.
 */
export function linkLeavesPage(click: LinkClick, here: PageLocation): boolean {
  if (click.defaultPrevented || click.button !== 0 || click.modified || click.download) {
    return false;
  }
  if (click.target !== null && click.target !== "" && click.target !== "_self") return false;
  let url: URL;
  try {
    url = new URL(click.href, `${here.origin}${here.pathname}${here.search}`);
  } catch {
    return false;
  }
  if (url.origin !== here.origin) return false;
  return url.pathname !== here.pathname || url.search !== here.search;
}
