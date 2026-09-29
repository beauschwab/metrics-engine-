/** The clipboard is a courtesy, not a contract: a write that fails is silent. */
export function copyText(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    // Nothing to do; the reader still has the selection.
  }
}
