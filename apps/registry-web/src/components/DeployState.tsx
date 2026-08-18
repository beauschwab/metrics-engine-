/**
 * What production is running, and whether you have moved past it.
 *
 * The surface autosaves, and since releases exist that is finally safe — nothing
 * a client reads changes when an author types. But it left a gap the author
 * feels immediately: **saved is not deployed**, and until now the header only
 * ever said `saved · r7`, which reads exactly like "shipped".
 *
 * So this says the other half. Not "is there a newer release" — that is a
 * release manager's question — but *is what I am looking at what production is
 * running*, which is the question every author has before they walk away from an
 * edit.
 *
 * It does not offer a deploy button. Cutting and promoting are governed acts
 * with an acknowledgement seam behind them (see `server/runtime.ts`), and a
 * button in an editor is the wrong shape for a thing that should be reviewed.
 * Telling the truth about the current state is the whole job here.
 */

import type { Deployment } from 'keel-engine/persistence';

interface Props {
  deployment: Deployment | null;
  /** False while the registry is unreachable — then this says nothing at all. */
  online: boolean;
}

export function DeployState({ deployment, online }: Props) {
  // No registry, or nothing ever promoted. Both are ordinary states, and an
  // indicator that shows a placeholder in them is an indicator people learn to
  // ignore in the state that matters.
  if (!online || !deployment) return null;

  const ahead = deployment.ahead.length;
  const live = ahead === 0;

  const title = live
    ? `Every document matches ${deployment.channel} · release r${deployment.release}, `
      + `promoted by ${deployment.promotedBy || 'unknown'} at ${deployment.promotedAt}`
    : `${deployment.channel} serves release r${deployment.release}. `
      + `Ahead of it here: ${deployment.ahead.join(', ')}. `
      + 'Cut a release and promote it to deploy these.';

  return (
    <span className="mdl-deploy" data-live={live} data-testid="mdl-deploy-state" title={title}>
      <span className="mdl-deploy-channel">{deployment.channel}</span>
      <span className="mdl-deploy-release tnum">r{deployment.release}</span>
      {/* A separator, because `r1 1 ahead` runs the release number into the
          count and reads as one number. */}
      <span className="mdl-deploy-sep" aria-hidden="true">·</span>
      {/* Said in words, not implied by a colour: "deployed" and "three ahead"
          are different situations and the reader should not have to work out
          which one a dot means. */}
      <span className="mdl-deploy-drift">
        {live ? 'live' : `${ahead} ahead`}
      </span>
    </span>
  );
}
