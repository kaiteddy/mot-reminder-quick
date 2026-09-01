/**
 * Printing a document from a phone.
 *
 * The desktop prints by dropping the PDF into a hidden iframe and calling print() on that. No
 * mobile browser can do it: neither iOS Safari nor Android Chrome renders a PDF inside an iframe,
 * so there is nothing there to print — and because print() throws nothing, the failure is silent.
 * The button simply appears dead.
 *
 * The two platforms then need opposite things:
 *
 *  - iOS opens the PDF in its own viewer, whose share sheet has Print. Hand it the file inline.
 *  - Android Chrome also renders it inline, but that viewer has NO print control at all: you get
 *    a document you can scroll and nothing else. So download it instead — the file then opens in
 *    the phone's PDF app (Drive or Files), which does have Print.
 *
 * Kept here rather than in a page because more than one screen prints the same documents: the
 * workshop job sheet and the full document view. A second copy of this reasoning would be a
 * second thing to forget.
 */

export const isAndroidPhone = () => /Android/i.test(navigator.userAgent);

export const isApplePhone = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac; the touch points give it away.
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

export const isHandheld = () => isAndroidPhone() || isApplePhone();

/**
 * Print `documentId` if we're on a phone.
 *
 * Returns true when it has handled it, false on a desktop — where the caller should fall through
 * to its own iframe print, which works there and gives a proper print dialog.
 */
export function printDocumentOnHandheld(
  documentId: number,
  notify?: (message: string) => void,
): boolean {
  if (!isHandheld()) return false;

  const url = `/api/documents/${documentId}/pdf${isAndroidPhone() ? "?download=1" : ""}`;

  if (isAndroidPhone()) {
    // A download needs no new tab, so no popup blocker to lose — and saying where it went saves
    // hunting for it.
    window.location.href = url;
    notify?.("Downloaded — open it from your downloads to print");
    return true;
  }

  const win = window.open(url, "_blank");
  // Some in-app browsers refuse the new tab outright, and a window opened after an await has
  // lost the user gesture anyway. The document is saved either way, so going there in this tab
  // costs nothing.
  if (!win) window.location.href = url;
  return true;
}
