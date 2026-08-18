# Handoff bundles

Provenance, not code. Nothing here builds, runs, or is tested, and nothing in
`src/`, `server/` or `chartroom/` imports from it.

These sat at the top level next to `src/` and `server/` for most of the repo's
life, which made the first thing a new reader saw evenly weighted between what
ships and what was handed over. They are kept because they answer "what was
actually asked for", which the code cannot.

| Bundle | What it is |
| --- | --- |
| `project/` | The Claude Design handoff the authoring surface was built from. `HANDOFF.md` is the original brief; the `.html` files are prototypes. |
| `chats/` | The design conversation behind that handoff — where the intent lives, per `project/HANDOFF.md`. |
| `design_handoff_form_mode_rule_builder/` | The second handoff, for form mode and the rule builder. |

Paths inside these files are relative to this directory and still resolve — the
bundles moved together and their names did not change.

One thing worth knowing before you diff them against the app: `project/_ds/` and
`src/styles/aperture/` are *not* two copies of one design system that drifted.
Six of the seven token files are byte-identical; `fonts.css` differs because the
app self-hosts Inter rather than fetching it, and the reasoning is written down
in `src/styles/aperture/tokens/fonts.css`. The app's copy is the live one.
