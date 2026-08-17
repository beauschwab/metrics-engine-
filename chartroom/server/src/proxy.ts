/**
 * The chat proxy — /api/chat now fronts the Python agent service (ADR-36).
 *
 * The studio keeps one origin and its frozen SSE protocol (ADR-37); this
 * module streams the agent service's frames through untouched. When the
 * service is unreachable, the degrade is the same honest posture as every
 * other model-shaped absence: an `unavailable` event naming what still works,
 * never a 502 (ADR-35).
 */

export const AGENT_URL = () => process.env.CHARTROOM_AGENT_URL || 'http://127.0.0.1:8789';

const AGENT_DOWN = {
  type: 'unavailable',
  message: 'The agent service is not running (chartroom-agent, :8789). The rest of the '
    + 'studio works without me — the linter and data critic are deterministic.',
};

const frame = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;

/**
 * Stream the agent service's SSE frames for one chat turn. Always yields at
 * least one frame; a connection failure becomes the `unavailable` frame.
 */
export async function* chatFrames(
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_URL()}/agent/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch {
    yield frame(AGENT_DOWN);
    return;
  }
  if (!res.ok || !res.body) {
    yield frame(AGENT_DOWN);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      // Pass-through: the agent service already speaks the frozen framing.
      yield decoder.decode(value, { stream: true });
    }
  } catch {
    if (!signal?.aborted) yield frame({ type: 'error', message: 'the agent stream dropped — try again' });
  }
}
