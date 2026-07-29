/**
 * The editor's visual layer.
 *
 * Colour appears only where meaning is encoded: pills, gutter marks and
 * diagnostics carry hue, everything else — chrome, keys, punctuation, line
 * numbers — is greyscale. Elevation comes from surface value, never shadow;
 * shadows on a dark ground read as smudge.
 */

import { EditorView } from '@codemirror/view';
import { HUE } from '../engine/vocab';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const C = {
  canvas: '#1A1C21',
  panel: '#1F2228',
  raised: '#2A2E36',
  border: '#363B44',
  borderStrong: '#3D424C',
  text: '#E7EBF1',
  muted: '#A6B1BC',
  dim: '#ADB5BF',
  faint: '#828D99',
  lineNo: '#8A94A0',
};

export const mdlTheme = EditorView.theme(
  {
    '&': {
      color: C.text,
      backgroundColor: C.canvas,
      fontSize: '13px',
      height: '100%',
    },
    '&.cm-focused': { outline: 'none' },

    '.cm-scroller': {
      fontFamily: MONO,
      lineHeight: '22px',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: '10px 0 24px 0',
      caretColor: HUE.signal,
    },
    '.cm-line': {
      padding: '0 16px 0 6px',
      minHeight: '22px',
    },

    '.cm-cursor, .cm-dropCursor': { borderLeftColor: HUE.signal, borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(242,179,0,.20)',
    },

    // ---- gutters -------------------------------------------------------
    '.cm-gutters': {
      backgroundColor: C.canvas,
      color: C.lineNo,
      border: 'none',
      fontSize: '11px',
    },
    '.cm-lineNumbers .cm-gutterElement': {
      minWidth: '38px',
      padding: '0 8px 0 4px',
      color: C.lineNo,
      fontVariantNumeric: 'tabular-nums',
    },
    '.cm-mdl-sev-gutter .cm-gutterElement': {
      width: '14px',
      padding: 0,
      textAlign: 'center',
      fontSize: '10px',
    },
    // A refactor prompt is quieter than any diagnostic — it is not a problem.
    '.cm-mdl-hint': { color: C.faint, opacity: 0.55, cursor: 'help' },
    '.cm-mdl-hint:hover': { opacity: 1 },

    // ---- signed-off banner ---------------------------------------------
    '.cm-mdl-banner': {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      margin: '4px 16px 2px 6px',
      padding: '5px 10px',
      background: 'rgba(242,179,0,.08)',
      borderLeft: `2px solid ${HUE.signal}`,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color: C.muted,
    },
    '.cm-mdl-banner-mark': { color: HUE.signal, fontSize: '7px' },
    '.cm-mdl-banner-ticket': {
      fontFamily: MONO,
      fontSize: '11px',
      color: HUE.signal,
    },
    '.cm-mdl-mark-gutter .cm-gutterElement': {
      width: '14px',
      padding: '0 4px 0 2px',
    },
    // Small and quiet: a peripheral read of a line's shape, not a second signal.
    '.cm-mdl-marks': {
      display: 'flex',
      alignItems: 'center',
      gap: '1px',
      height: '22px',
    },
    '.cm-mdl-mark': {
      display: 'block',
      width: '2px',
      height: '11px',
      opacity: 0.85,
      flex: 'none',
    },
    '.cm-mdl-active-gutter': {
      backgroundColor: 'rgba(69,182,240,.045)',
      boxShadow: 'inset 2px 0 0 0 rgba(69,182,240,.45)',
    },

    // ---- syntax --------------------------------------------------------
    '.cm-mdl-key': { color: C.muted },
    '.cm-mdl-value': { color: C.text },
    '.cm-mdl-punct': { color: C.dim },
    '.cm-mdl-active-line': {
      backgroundColor: 'rgba(69,182,240,.045)',
      boxShadow: 'inset 2px 0 0 0 rgba(69,182,240,.45)',
    },
    '.cm-mdl-ghost': { color: C.faint, opacity: 0.75 },

    // ---- pills ---------------------------------------------------------
    // Enough radius to read as an object, not so much it becomes a tag cloud.
    '.cm-pill': {
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: '4px',
      border: '1px solid var(--pill-border)',
      backgroundColor: 'var(--pill-bg)',
      color: 'var(--pill-hue)',
      fontFamily: MONO,
      position: 'relative',
      cursor: 'pointer',
      lineHeight: '18px',
      animation: 'mdl-pill-in 120ms ease-out',
    },
    '.cm-pill-glyph': { marginRight: '0' },
    '.cm-pill-func .cm-pill-glyph, .cm-pill-dimension .cm-pill-glyph, .cm-pill-column .cm-pill-glyph': {
      marginRight: '3px',
    },
    '.cm-pill-tier': {
      position: 'absolute',
      top: '-1px',
      right: '-1px',
      width: '5px',
      height: '5px',
      borderRadius: '50%',
      background: HUE.signal,
      display: 'block',
    },
    '.cm-pill-unresolved': { borderStyle: 'dashed' },
    '.cm-pill-deprecated': { opacity: 0.7 },
    '.cm-pill-stale': { animation: 'mdl-stale 1.6s ease-in-out infinite' },
    '.cm-pill-focused': { boxShadow: '0 0 0 2px rgba(242,179,0,.55)' },
    '.cm-pill:focus-visible': { outline: 'none', boxShadow: '0 0 0 2px rgba(242,179,0,.55)' },

    // ---- diagnostics ---------------------------------------------------
    // Underline the offending range only. A full-line highlight would obscure
    // the pills, which are the thing being read.
    '.cm-lintRange': {
      backgroundImage: 'none',
      textDecorationLine: 'underline',
      textDecorationStyle: 'wavy',
      textDecorationSkipInk: 'none',
      textUnderlineOffset: '3px',
    },
    '.cm-lintRange-error': { textDecorationColor: HUE.unresolved },
    '.cm-lintRange-warning': { textDecorationColor: HUE.warn },
    '.cm-lintRange-info': { textDecorationColor: HUE.measure },

    '.cm-tooltip.cm-tooltip-lint': {
      backgroundColor: C.raised,
      border: `1px solid ${C.borderStrong}`,
      borderRadius: '2px',
      boxShadow: '0 12px 32px rgba(0,0,0,.55)',
      maxWidth: '380px',
    },
    '.cm-diagnostic': {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '12px',
      padding: '8px 10px',
      borderLeft: 'none',
      color: C.text,
    },
    '.cm-diagnostic-error': { borderLeft: `2px solid ${HUE.unresolved}` },
    '.cm-diagnostic-warning': { borderLeft: `2px solid ${HUE.warn}` },
    '.cm-diagnostic-info': { borderLeft: `2px solid ${HUE.measure}` },
    '.cm-diagnosticAction': {
      backgroundColor: 'transparent',
      color: HUE.signal,
      border: '1px solid rgba(242,179,0,.35)',
      borderRadius: '1px',
      padding: '1px 6px',
      marginLeft: '0',
      marginTop: '6px',
      fontSize: '11px',
      cursor: 'pointer',
    },

    // ---- completion ----------------------------------------------------
    '.cm-tooltip': {
      border: `1px solid ${C.borderStrong}`,
      backgroundColor: C.raised,
    },
    '.cm-tooltip.cm-mdl-completion': {
      width: '340px',
      borderRadius: '2px',
      boxShadow: '0 8px 24px rgba(0,0,0,.5)',
      overflow: 'hidden',
    },
    '.cm-mdl-completion[data-scope]::before': {
      content: 'attr(data-scope)',
      display: 'block',
      padding: '4px 8px',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '9px',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: C.faint,
      borderBottom: `1px solid ${C.border}`,
    },
    '.cm-tooltip-autocomplete > ul': {
      fontFamily: MONO,
      fontSize: '12px',
      maxHeight: '260px',
    },
    '.cm-tooltip-autocomplete > ul > li': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 8px',
      color: C.text,
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(242,179,0,.14)',
      color: C.text,
    },
    '.cm-completionLabel': { flex: 'none' },
    '.cm-completionDetail': {
      marginLeft: 'auto',
      fontStyle: 'normal',
      fontSize: '11px',
      color: C.muted,
      fontVariantNumeric: 'tabular-nums',
      paddingLeft: '10px',
    },
    '.cm-completionIcon': {
      width: '14px',
      opacity: 1,
      fontSize: '11px',
      textAlign: 'center',
      padding: 0,
      marginRight: 0,
    },
    '.cm-completionIcon-mdlMeasure::after': { content: "'⟨⟩'", color: HUE.measure },
    '.cm-completionIcon-mdlFunc::after': { content: "'ƒ'", color: HUE.func },
    '.cm-completionIcon-mdlColumn::after': { content: "'·'", color: HUE.column },
    '.cm-completionIcon-mdlDimension::after': { content: "'▤'", color: HUE.dimension },
    '.cm-completionIcon-mdlEnum::after': { content: "'▸'", color: HUE.signal },
    '.cm-completionIcon-mdlCurrent::after': { content: "'✓'", color: HUE.signal },

    // ---- quick actions -------------------------------------------------
    '.cm-mdl-actions': {
      width: '260px',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '4px 0',
    },
    '.cm-mdl-actions-head': {
      padding: '4px 10px',
      fontSize: '9px',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: C.faint,
    },
    '.cm-mdl-action': {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      width: '100%',
      background: 'transparent',
      border: 'none',
      textAlign: 'left',
      padding: '5px 10px',
      fontSize: '12px',
      fontFamily: 'inherit',
      color: C.text,
      cursor: 'pointer',
    },
    '.cm-mdl-action:hover': { backgroundColor: 'rgba(242,179,0,.14)' },
    '.cm-mdl-action-hint': {
      marginLeft: 'auto',
      fontFamily: MONO,
      fontSize: '10px',
      color: C.faint,
    },
    '.cm-mdl-action-input': {
      width: 'calc(100% - 20px)',
      margin: '2px 10px 4px 10px',
      background: C.canvas,
      border: `1px solid ${HUE.signal}`,
      borderRadius: '1px',
      color: C.text,
      fontFamily: MONO,
      fontSize: '12px',
      padding: '4px 6px',
      outline: 'none',
    },
    '.cm-mdl-actions-note': {
      padding: '2px 10px 4px 10px',
      fontSize: '10px',
      color: C.faint,
    },

    // ---- peek pane -----------------------------------------------------
    '.cm-mdl-peek': {
      margin: '4px 0 8px 6px',
      maxWidth: '620px',
      background: C.panel,
      border: `1px solid ${C.borderStrong}`,
      borderLeft: `2px solid ${HUE.measure}`,
      borderRadius: '2px',
      padding: '10px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      lineHeight: '17px',
    },
    '.cm-mdl-peek-head': { display: 'flex', alignItems: 'center', gap: '8px' },
    '.cm-mdl-peek-eyebrow': {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '9px',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: C.faint,
    },
    '.cm-mdl-peek-name': { color: HUE.measure, fontFamily: MONO, fontSize: '12px' },
    '.cm-mdl-peek-close': {
      background: 'transparent',
      border: 'none',
      color: C.faint,
      cursor: 'pointer',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      padding: 0,
    },
    '.cm-mdl-peek-label': { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px', color: C.text },
    '.cm-mdl-peek-desc': { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px', color: C.muted },
    '.cm-mdl-peek-expr': { fontFamily: MONO, fontSize: '12px', color: C.text },
    '.cm-mdl-peek-value': {
      fontFamily: MONO,
      fontSize: '13px',
      color: HUE.signal,
      fontVariantNumeric: 'tabular-nums',
    },
  },
  { dark: true },
);
