/**
 * The definition-agent proxy — /api/chat fronts the agent service (ADR-56).
 *
 * The authoring surface keeps one origin and the studio's frozen SSE protocol
 * (ADR-37); this module streams the agent service's frames through untouched.
 * The service is the same chartroom-agent process the studio uses, started
 * with `AGENT_SURFACE=registry` so its tools are registry-mcp under an
 * `agent:` identity — a roster that cannot save, cut or promote.
 *
 * When the service is unreachable, the degrade is the same honest posture as
 * every other model-shaped absence: an `unavailable` event naming what still
 * works, never a 502.
 */

export const AGENT_URL = (): string => process.env.KEEL_AGENT_URL || 'http://127.0.0.1:8790';

const AGENT_DOWN = {
  type: 'unavailable',
  message: 'The definition agent service is not running (chartroom-agent with '
    + 'AGENT_SURFACE=registry, :8790). The rest of the surface works without it — '
    + 'the diagnostics and the impact assessment are deterministic.',
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
