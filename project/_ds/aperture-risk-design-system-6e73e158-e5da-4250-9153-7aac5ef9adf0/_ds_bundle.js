/* @ds-bundle: {"format":3,"namespace":"ApertureRiskDesignSystem_6e73e1","components":[{"name":"AIInsight","sourcePath":"components/ai/AIInsight.jsx"},{"name":"AIPromptBar","sourcePath":"components/ai/AIPromptBar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"Select","sourcePath":"components/core/Select.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"Tabs","sourcePath":"components/core/Tabs.jsx"},{"name":"ColumnChart","sourcePath":"components/data/ColumnChart.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"DonutGauge","sourcePath":"components/data/DonutGauge.jsx"},{"name":"ForecastChart","sourcePath":"components/data/ForecastChart.jsx"},{"name":"LimitBar","sourcePath":"components/data/LimitBar.jsx"},{"name":"LineChart","sourcePath":"components/data/LineChart.jsx"},{"name":"ScorecardKPI","sourcePath":"components/data/ScorecardKPI.jsx"},{"name":"Sparkline","sourcePath":"components/data/Sparkline.jsx"},{"name":"StatTile","sourcePath":"components/data/StatTile.jsx"},{"name":"Tracker","sourcePath":"components/data/Tracker.jsx"},{"name":"VarianceBar","sourcePath":"components/data/VarianceBar.jsx"},{"name":"DriverFlow","sourcePath":"components/flow/DriverFlow.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"NumberStepper","sourcePath":"components/forms/NumberStepper.jsx"},{"name":"RadioGroup","sourcePath":"components/forms/RadioGroup.jsx"},{"name":"Slider","sourcePath":"components/forms/Slider.jsx"},{"name":"DataGrid","sourcePath":"components/grid/DataGrid.jsx"}],"sourceHashes":{"components/ai/AIInsight.jsx":"06d46f184e8c","components/ai/AIPromptBar.jsx":"064eaf89b70b","components/core/Badge.jsx":"9ba49b7bd516","components/core/Button.jsx":"fa1ae66f6c00","components/core/IconButton.jsx":"fdfcd8c5d48e","components/core/Input.jsx":"2afffe0f18a3","components/core/Panel.jsx":"1c33b90996da","components/core/Select.jsx":"9ead1bda57f7","components/core/Switch.jsx":"4894d9b7ee43","components/core/Tabs.jsx":"c562b55a6958","components/data/ColumnChart.jsx":"48d871d73e65","components/data/DataTable.jsx":"09349d35ba2a","components/data/DonutGauge.jsx":"942b0db69465","components/data/ForecastChart.jsx":"22f98e512999","components/data/LimitBar.jsx":"68cdfc7c2bc5","components/data/LineChart.jsx":"aef80c63d8a7","components/data/ScorecardKPI.jsx":"6721feebbb71","components/data/Sparkline.jsx":"62b592602276","components/data/StatTile.jsx":"ddbef20acc60","components/data/Tracker.jsx":"378b2816db65","components/data/VarianceBar.jsx":"a4d78e640f51","components/flow/DriverFlow.jsx":"fe28a0bcbbeb","components/forms/Checkbox.jsx":"7c1dfafc0f9f","components/forms/NumberStepper.jsx":"78c610e471e1","components/forms/RadioGroup.jsx":"0ea6f9702aa8","components/forms/Slider.jsx":"40f93e7a4fed","components/grid/DataGrid.jsx":"b18893421d88","ui_kits/risk-terminal/AlertsScreen.jsx":"0733a3af4e48","ui_kits/risk-terminal/AppShell.jsx":"59cc15e685af","ui_kits/risk-terminal/BalanceSheetScreen.jsx":"71a4c47b758b","ui_kits/risk-terminal/CopilotRail.jsx":"4597d67bf8b0","ui_kits/risk-terminal/HoldingsScreen.jsx":"7ac70360be53","ui_kits/risk-terminal/OverviewScreen.jsx":"4a75e9b01ee7","ui_kits/risk-terminal/ScenarioScreen.jsx":"621671498815","ui_kits/risk-terminal/charts.jsx":"e364cc4810b5","ui_kits/risk-terminal/terminal-data.js":"b0eb7097be6b"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ApertureRiskDesignSystem_6e73e1 = window.ApertureRiskDesignSystem_6e73e1 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/ai/AIInsight.jsx
try { (() => {
/**
 * AIInsight — a copilot-authored callout. Violet AI accent, optional
 * confidence and source chips, and an action row. Used inline in panels
 * or stacked in the copilot rail.
 */
function AIInsight({
  title,
  children,
  severity = 'info',
  confidence,
  sources = [],
  actions = null,
  compact = false,
  style = {}
}) {
  const sevDot = {
    info: 'var(--ai-500)',
    positive: 'var(--up-500)',
    warning: 'var(--warning-500)',
    critical: 'var(--danger-500)'
  }[severity] || 'var(--ai-500)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      background: 'color-mix(in srgb, var(--ai-500) 6%, var(--surface-1))',
      border: '1px solid color-mix(in srgb, var(--ai-500) 32%, var(--border-default))',
      borderRadius: 'var(--radius-md)',
      padding: compact ? '11px 13px' : '13px 15px',
      display: 'flex',
      flexDirection: 'column',
      gap: compact ? 6 : 9,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      borderRadius: 2,
      background: 'var(--ai-soft)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement(SparkIcon, null)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--text-heading)',
      flex: 1,
      minWidth: 0
    }
  }, title), confidence != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      color: 'var(--ai-500)',
      background: 'var(--ai-soft)',
      padding: '2px 7px',
      borderRadius: 'var(--radius-xs)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums'
    }
  }, confidence, "% conf"), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: sevDot,
      flexShrink: 0
    }
  })), children && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      lineHeight: 1.5,
      color: 'var(--text-secondary)'
    }
  }, children), (sources.length > 0 || actions) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 5,
      flexWrap: 'wrap',
      minWidth: 0
    }
  }, sources.map((s, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      fontSize: 10,
      color: 'var(--text-tertiary)',
      background: 'var(--surface-2)',
      border: '1px solid var(--border-subtle)',
      padding: '1px 7px',
      borderRadius: 'var(--radius-xs)',
      whiteSpace: 'nowrap'
    }
  }, s))), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexShrink: 0
    }
  }, actions)));
}
function SparkIcon() {
  return /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 14 14",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M7 1.2l1.3 3.1 3.1 1.3-3.1 1.3L7 10l-1.3-3.1L2.6 5.6l3.1-1.3L7 1.2z",
    fill: "var(--ai-500)"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M11.4 9.1l.55 1.25 1.25.55-1.25.55-.55 1.25-.55-1.25-1.25-.55 1.25-.55.55-1.25z",
    fill: "var(--ai-500)",
    opacity: "0.7"
  }));
}
Object.assign(__ds_scope, { AIInsight });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/ai/AIInsight.jsx", error: String((e && e.message) || e) }); }

// components/ai/AIPromptBar.jsx
try { (() => {
/**
 * AIPromptBar — the copilot input. Violet-accented field with a spark
 * glyph, placeholder, optional suggestion chips, and a send affordance.
 */
function AIPromptBar({
  placeholder = 'Ask about your portfolio…',
  value,
  onChange,
  onSubmit,
  suggestions = [],
  busy = false,
  style = {}
}) {
  const [focus, setFocus] = React.useState(false);
  const [internal, setInternal] = React.useState('');
  const val = value != null ? value : internal;
  const set = v => {
    onChange ? onChange(v) : setInternal(v);
  };
  const submit = () => {
    if (val && val.trim() && onSubmit) onSubmit(val.trim());
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 9,
      height: 38,
      padding: '0 8px 0 12px',
      background: 'var(--gray-900)',
      border: `1px solid ${focus ? 'var(--ai-500)' : 'color-mix(in srgb, var(--ai-500) 22%, var(--border-default))'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focus ? 'var(--glow-ai)' : 'none',
      transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 14 14",
    fill: "none",
    style: {
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M7 1.2l1.3 3.1 3.1 1.3-3.1 1.3L7 10l-1.3-3.1L2.6 5.6l3.1-1.3L7 1.2z",
    fill: "var(--ai-500)"
  })), /*#__PURE__*/React.createElement("input", {
    value: val,
    placeholder: placeholder,
    onChange: e => set(e.target.value),
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    onKeyDown: e => {
      if (e.key === 'Enter') submit();
    },
    style: {
      all: 'unset',
      flex: 1,
      minWidth: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      color: 'var(--text-primary)'
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: submit,
    disabled: busy || !val || !val.trim(),
    "aria-label": "Send",
    style: {
      all: 'unset',
      cursor: busy || !val || !val.trim() ? 'default' : 'pointer',
      width: 26,
      height: 26,
      borderRadius: 'var(--radius-xs)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: val && val.trim() ? 'var(--ai-500)' : 'var(--surface-2)',
      color: val && val.trim() ? '#15121f' : 'var(--text-tertiary)',
      transition: 'background var(--dur-fast) var(--ease-out)'
    }
  }, busy ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 12,
      height: 12,
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      borderRadius: 999,
      display: 'inline-block',
      animation: 'aperture-spin 0.6s linear infinite'
    }
  }) : /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 14 14",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 7h9M7.5 3.5L11 7l-3.5 3.5",
    stroke: "currentColor",
    strokeWidth: "1.6",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })))), suggestions.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, suggestions.map((s, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    type: "button",
    onClick: () => {
      set(s);
      onSubmit && onSubmit(s);
    },
    style: {
      all: 'unset',
      cursor: 'pointer',
      fontSize: 11,
      color: 'var(--text-secondary)',
      background: 'var(--surface-1)',
      border: '1px solid var(--border-default)',
      padding: '4px 9px',
      borderRadius: 'var(--radius-xs)',
      whiteSpace: 'nowrap',
      transition: 'border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)'
    },
    onMouseEnter: e => {
      e.currentTarget.style.borderColor = 'var(--ai-500)';
      e.currentTarget.style.color = 'var(--text-primary)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.borderColor = 'var(--border-default)';
      e.currentTarget.style.color = 'var(--text-secondary)';
    }
  }, s))));
}
Object.assign(__ds_scope, { AIPromptBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/ai/AIPromptBar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Badge — small status/label pill. Tones map to semantics.
 * Use `dot` for a leading status dot; `soft` (default) for tinted fill.
 */
function Badge({
  children,
  tone = 'neutral',
  solid = false,
  dot = false,
  size = 'md',
  style = {},
  ...rest
}) {
  const tones = {
    neutral: {
      fg: 'var(--text-secondary)',
      soft: 'var(--surface-2)',
      solid: 'var(--gray-600)',
      dotc: 'var(--gray-400)'
    },
    brand: {
      fg: 'var(--yellow-400)',
      soft: 'var(--yellow-soft)',
      solid: 'var(--yellow-500)',
      dotc: 'var(--yellow-500)'
    },
    up: {
      fg: 'var(--up-500)',
      soft: 'var(--up-soft)',
      solid: 'var(--up-500)',
      dotc: 'var(--up-500)'
    },
    down: {
      fg: 'var(--down-500)',
      soft: 'var(--down-soft)',
      solid: 'var(--down-500)',
      dotc: 'var(--down-500)'
    },
    warning: {
      fg: 'var(--warning-500)',
      soft: 'var(--warning-soft)',
      solid: 'var(--warning-500)',
      dotc: 'var(--warning-500)'
    },
    danger: {
      fg: 'var(--danger-500)',
      soft: 'var(--danger-soft)',
      solid: 'var(--danger-500)',
      dotc: 'var(--danger-500)'
    },
    info: {
      fg: 'var(--info-500)',
      soft: 'var(--info-soft)',
      solid: 'var(--info-500)',
      dotc: 'var(--info-500)'
    },
    ai: {
      fg: 'var(--ai-500)',
      soft: 'var(--ai-soft)',
      solid: 'var(--ai-500)',
      dotc: 'var(--ai-500)'
    }
  };
  const t = tones[tone] || tones.neutral;
  const pad = size === 'sm' ? '1px 6px' : '2px 8px';
  const fs = size === 'sm' ? 10 : 11;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: pad,
      fontSize: fs,
      fontWeight: 600,
      lineHeight: 1.4,
      fontFamily: 'var(--font-sans)',
      fontVariantNumeric: 'tabular-nums',
      borderRadius: 'var(--radius-xs)',
      whiteSpace: 'nowrap',
      background: solid ? t.solid : t.soft,
      color: solid ? tone === 'brand' ? 'var(--text-on-accent)' : '#fff' : t.fg,
      border: solid ? 'none' : `1px solid color-mix(in srgb, ${t.fg} 22%, transparent)`,
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: 999,
      background: solid ? 'currentColor' : t.dotc,
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — primary action control for the Aperture terminal.
 * Variants: primary (yellow), secondary, ghost, danger.
 * Sizes: sm, md, lg.
 */
function Button({
  children,
  variant = 'secondary',
  size = 'md',
  iconLeft = null,
  iconRight = null,
  disabled = false,
  loading = false,
  full = false,
  style = {},
  ...rest
}) {
  const heights = {
    sm: 24,
    md: 30,
    lg: 38
  };
  const fonts = {
    sm: 12,
    md: 13,
    lg: 14
  };
  const pads = {
    sm: '0 10px',
    md: '0 13px',
    lg: '0 18px'
  };
  const variants = {
    primary: {
      background: 'var(--accent)',
      color: 'var(--text-on-accent)',
      border: '1px solid var(--accent-press)',
      fontWeight: 600
    },
    secondary: {
      background: 'var(--surface-2)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-default)',
      fontWeight: 500
    },
    ghost: {
      background: 'transparent',
      color: 'var(--text-secondary)',
      border: '1px solid transparent',
      fontWeight: 500
    },
    danger: {
      background: 'var(--danger-soft)',
      color: 'var(--danger-500)',
      border: '1px solid color-mix(in srgb, var(--danger-500) 35%, transparent)',
      fontWeight: 600
    }
  };
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: heights[size],
    padding: pads[size],
    fontFamily: 'var(--font-sans)',
    fontSize: fonts[size],
    lineHeight: 1,
    borderRadius: 'var(--radius-sm)',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    width: full ? '100%' : 'auto',
    whiteSpace: 'nowrap',
    transition: 'background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out)',
    userSelect: 'none',
    ...variants[variant],
    ...style
  };
  const hoverFilter = e => {
    if (!disabled && !loading) e.currentTarget.style.filter = 'brightness(1.12)';
  };
  const resetFilter = e => {
    e.currentTarget.style.filter = 'none';
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled || loading,
    style: base,
    onMouseEnter: hoverFilter,
    onMouseLeave: resetFilter
  }, rest), loading && /*#__PURE__*/React.createElement(Spinner, {
    size: fonts[size]
  }), !loading && iconLeft, children, !loading && iconRight);
}
function Spinner({
  size = 13
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      borderRadius: '999px',
      display: 'inline-block',
      animation: 'aperture-spin 0.6s linear infinite',
      opacity: 0.8
    }
  });
}
if (typeof document !== 'undefined' && !document.getElementById('aperture-spin-kf')) {
  const s = document.createElement('style');
  s.id = 'aperture-spin-kf';
  s.textContent = '@keyframes aperture-spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(s);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * IconButton — square icon-only control for toolbars and table rows.
 * Pass a Lucide <i data-lucide="…"/> or an SVG as children.
 */
function IconButton({
  children,
  size = 'md',
  variant = 'ghost',
  active = false,
  disabled = false,
  label,
  style = {},
  ...rest
}) {
  const dims = {
    sm: 24,
    md: 28,
    lg: 34
  };
  const d = dims[size];
  const variants = {
    ghost: {
      background: active ? 'var(--surface-active)' : 'transparent',
      color: active ? 'var(--accent-text)' : 'var(--text-tertiary)',
      border: '1px solid transparent'
    },
    outline: {
      background: 'var(--surface-2)',
      color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
      border: '1px solid var(--border-default)'
    }
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    style: {
      width: d,
      height: d,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 'var(--radius-sm)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
      ...variants[variant],
      ...style
    },
    onMouseEnter: e => {
      if (!disabled && !active) {
        e.currentTarget.style.background = 'var(--surface-2)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }
    },
    onMouseLeave: e => {
      if (!disabled && !active) {
        e.currentTarget.style.background = variants[variant].background;
        e.currentTarget.style.color = variants[variant].color;
      }
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Input — text/number field for the terminal. Supports leading icon,
 * trailing affix (e.g. unit), invalid state, and sizes.
 */
function Input({
  size = 'md',
  iconLeft = null,
  affix = null,
  invalid = false,
  numeric = false,
  full = false,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const heights = {
    sm: 24,
    md: 30,
    lg: 38
  };
  const fonts = {
    sm: 12,
    md: 13,
    lg: 14
  };
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 7,
      height: heights[size],
      padding: '0 10px',
      width: full ? '100%' : 'auto',
      background: 'var(--gray-900)',
      border: `1px solid ${invalid ? 'var(--danger-500)' : focus ? 'var(--accent)' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focus ? invalid ? 'var(--ring-danger)' : 'var(--ring-focus)' : 'none',
      transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
      ...containerStyle
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      color: 'var(--text-tertiary)',
      flexShrink: 0
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    onFocus: e => {
      setFocus(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      all: 'unset',
      flex: 1,
      minWidth: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: fonts[size],
      color: 'var(--text-primary)',
      textAlign: numeric ? 'right' : 'left',
      fontVariantNumeric: numeric ? 'tabular-nums' : 'normal',
      ...style
    }
  }, rest)), affix && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: fonts[size] - 1,
      color: 'var(--text-tertiary)',
      flexShrink: 0,
      fontVariantNumeric: 'tabular-nums'
    }
  }, affix));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Panel — the standard surface container. A bordered card with an
 * optional header (eyebrow label + actions) and body padding.
 * Exported as `Panel`; this is the workhorse layout primitive.
 */
function Panel({
  title,
  eyebrow,
  actions = null,
  children,
  noPad = false,
  raised = false,
  accent = false,
  style = {},
  bodyStyle = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("section", _extends({
    style: {
      background: 'var(--surface-1)',
      border: `1px solid ${accent ? 'color-mix(in srgb, var(--accent) 40%, var(--border-default))' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: raised ? 'var(--shadow-md)' : 'var(--inset-top-light)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      ...style
    }
  }, rest), (title || eyebrow || actions) && /*#__PURE__*/React.createElement("header", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '11px 14px',
      borderBottom: '1px solid var(--border-subtle)',
      minHeight: 44
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2,
      minWidth: 0
    }
  }, eyebrow && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, eyebrow), title && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 600,
      color: 'var(--text-heading)',
      letterSpacing: 'var(--tracking-tight)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, title)), actions && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      flexShrink: 0
    }
  }, actions)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: noPad ? 0 : 'var(--pad-panel)',
      flex: 1,
      ...bodyStyle
    }
  }, children));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/core/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Select — styled native dropdown. Pass options as
 * [{value, label}] or children <option>.
 */
function Select({
  options,
  value,
  onChange,
  size = 'md',
  invalid = false,
  full = false,
  iconLeft = null,
  style = {},
  children,
  ...rest
}) {
  const heights = {
    sm: 24,
    md: 30,
    lg: 38
  };
  const fonts = {
    sm: 12,
    md: 13,
    lg: 14
  };
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'inline-flex',
      alignItems: 'center',
      height: heights[size],
      width: full ? '100%' : 'auto',
      background: 'var(--gray-900)',
      border: `1px solid ${invalid ? 'var(--danger-500)' : focus ? 'var(--accent)' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: focus ? 'var(--ring-focus)' : 'none',
      transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
      ...style
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      color: 'var(--text-tertiary)',
      paddingLeft: 9
    }
  }, iconLeft), /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      all: 'unset',
      boxSizing: 'border-box',
      width: '100%',
      height: '100%',
      padding: `0 28px 0 ${iconLeft ? 7 : 10}px`,
      fontFamily: 'var(--font-sans)',
      fontSize: fonts[size],
      color: 'var(--text-primary)',
      cursor: 'pointer'
    }
  }, rest), options ? options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value,
    style: {
      background: 'var(--surface-overlay)'
    }
  }, o.label)) : children), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 9,
      pointerEvents: 'none',
      color: 'var(--text-tertiary)',
      display: 'inline-flex'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M3 4.5L6 7.5L9 4.5",
    stroke: "currentColor",
    strokeWidth: "1.4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Select.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Switch — compact toggle for terminal settings (e.g. live updates,
 * hedged view). Yellow when on.
 */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  size = 'md',
  label,
  ...rest
}) {
  const dims = size === 'sm' ? {
    w: 30,
    h: 17,
    k: 12
  } : {
    w: 36,
    h: 20,
    k: 15
  };
  const toggle = () => {
    if (!disabled && onChange) onChange(!checked);
  };
  const sw = /*#__PURE__*/React.createElement("span", _extends({
    role: "switch",
    "aria-checked": checked,
    onClick: toggle,
    style: {
      position: 'relative',
      width: dims.w,
      height: dims.h,
      borderRadius: 'var(--radius-sm)',
      background: checked ? 'var(--accent)' : 'var(--gray-700)',
      border: `1px solid ${checked ? 'var(--accent-press)' : 'var(--border-strong)'}`,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background var(--dur-base) var(--ease-out)',
      flexShrink: 0,
      display: 'inline-block'
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: '50%',
      left: checked ? `calc(100% - ${dims.k + 2}px)` : '2px',
      transform: 'translateY(-50%)',
      width: dims.k,
      height: dims.k,
      borderRadius: 1,
      background: checked ? 'var(--text-on-accent)' : 'var(--gray-300)',
      transition: 'left var(--dur-base) var(--ease-out)',
      boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
    }
  }));
  if (!label) return sw;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      cursor: disabled ? 'not-allowed' : 'pointer'
    }
  }, sw, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/core/Tabs.jsx
try { (() => {
/**
 * Tabs — view switcher. `underline` (default) for primary section nav,
 * `segmented` for compact inline filters (e.g. 1D / 1W / 1M / YTD).
 */
function Tabs({
  items = [],
  value,
  onChange,
  variant = 'underline',
  size = 'md',
  style = {}
}) {
  const active = value != null ? value : items[0] && items[0].value;
  if (variant === 'segmented') {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'inline-flex',
        padding: 2,
        gap: 2,
        background: 'var(--gray-900)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        ...style
      }
    }, items.map(it => {
      const on = it.value === active;
      return /*#__PURE__*/React.createElement("button", {
        key: it.value,
        type: "button",
        onClick: () => onChange && onChange(it.value),
        style: {
          all: 'unset',
          cursor: 'pointer',
          padding: size === 'sm' ? '3px 9px' : '4px 11px',
          fontSize: size === 'sm' ? 11 : 12,
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          fontVariantNumeric: 'tabular-nums',
          borderRadius: 'var(--radius-xs)',
          color: on ? 'var(--text-on-accent)' : 'var(--text-secondary)',
          background: on ? 'var(--accent)' : 'transparent',
          transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)'
        }
      }, it.label);
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 18,
      borderBottom: '1px solid var(--border-subtle)',
      ...style
    }
  }, items.map(it => {
    const on = it.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      type: "button",
      onClick: () => onChange && onChange(it.value),
      style: {
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '0 1px 9px',
        marginBottom: -1,
        fontSize: size === 'sm' ? 12 : 13,
        fontWeight: on ? 600 : 500,
        fontFamily: 'var(--font-sans)',
        color: on ? 'var(--text-heading)' : 'var(--text-tertiary)',
        borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
        transition: 'color var(--dur-fast) var(--ease-out)'
      }
    }, it.label, it.count != null && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 'var(--radius-xs)',
        background: on ? 'var(--yellow-soft)' : 'var(--surface-2)',
        color: on ? 'var(--accent-text)' : 'var(--text-tertiary)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, it.count));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/data/ColumnChart.jsx
try { (() => {
/**
 * ColumnChart — IBCS-notation column chart with optional line overlay and
 * hover detail disclosure. Fill encodes data type per IBCS:
 *   actual → solid · prev → muted solid · plan → hollow outline · forecast → hatch
 * Negative values draw below the zero baseline. Pass `overlay` (a same-length
 * number series) to draw a sky-blue line over the columns — e.g. a target,
 * plan, or second metric. Hovering a column reveals a tooltip.
 */
function ColumnChart({
  data = [],
  overlay,
  overlayLabel = 'Target',
  overlayColor = 'var(--sky-500)',
  height = 96,
  barWidth = 14,
  gap = 8,
  accent = false,
  showValues = false,
  showLabels = true,
  zeroLine = true,
  formatValue = v => v,
  style = {}
}) {
  const [hover, setHover] = React.useState(null);
  const vals = data.map(d => d.value);
  const all = overlay ? vals.concat(overlay) : vals;
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const labelH = showLabels ? 15 : 0;
  const valueH = showValues ? 13 : 0;
  const plotH = height - labelH - valueH;
  const zeroY = valueH + max / span * plotH;
  const W = data.length * barWidth + (data.length - 1) * gap;
  const acFill = accent ? 'var(--accent)' : 'var(--gray-100)';
  const uid = 'ibcs' + Math.round(max) + data.length;
  const colCenter = i => i * (barWidth + gap) + barWidth / 2;
  const yOf = v => valueH + (1 - (v - min) / span) * plotH;
  const fillFor = t => {
    if (t === 'plan') return 'none';
    if (t === 'forecast') return `url(#${uid}-hatch)`;
    if (t === 'prev') return 'var(--gray-600)';
    return acFill;
  };
  const overlayPts = overlay ? overlay.map((v, i) => [colCenter(i), yOf(v)]) : null;
  const overlayLine = overlayPts ? overlayPts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') : '';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      ...style
    },
    onMouseLeave: () => setHover(null)
  }, /*#__PURE__*/React.createElement("svg", {
    width: "100%",
    height: height,
    viewBox: `0 0 ${W} ${height}`,
    preserveAspectRatio: "xMinYMid meet",
    style: {
      display: 'block',
      overflow: 'visible'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("pattern", {
    id: `${uid}-hatch`,
    width: "4",
    height: "4",
    patternTransform: "rotate(45)",
    patternUnits: "userSpaceOnUse"
  }, /*#__PURE__*/React.createElement("rect", {
    width: "4",
    height: "4",
    fill: "transparent"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "4",
    stroke: accent ? 'var(--accent)' : 'var(--gray-300)',
    strokeWidth: "2"
  }))), zeroLine && /*#__PURE__*/React.createElement("line", {
    x1: "0",
    y1: zeroY,
    x2: W,
    y2: zeroY,
    stroke: "var(--border-strong)",
    strokeWidth: "1"
  }), data.map((d, i) => {
    const x = i * (barWidth + gap);
    const h = Math.abs(d.value) / span * plotH;
    const y = d.value >= 0 ? zeroY - h : zeroY;
    const isPlan = d.type === 'plan';
    const on = hover === i;
    return /*#__PURE__*/React.createElement("g", {
      key: i
    }, showValues && /*#__PURE__*/React.createElement("text", {
      x: x + barWidth / 2,
      y: (d.value >= 0 ? y : y + h) + (d.value >= 0 ? -3 : 11),
      textAnchor: "middle",
      fontSize: "9",
      fontWeight: "600",
      fill: "var(--text-secondary)",
      style: {
        fontVariantNumeric: 'tabular-nums'
      }
    }, formatValue(d.value)), /*#__PURE__*/React.createElement("rect", {
      x: x,
      y: y,
      width: barWidth,
      height: Math.max(h, 0.5),
      fill: fillFor(d.type),
      stroke: isPlan ? accent ? 'var(--accent)' : 'var(--gray-300)' : 'none',
      strokeWidth: isPlan ? 1.4 : 0,
      opacity: hover != null && !on ? 0.55 : 1
    }), showLabels && /*#__PURE__*/React.createElement("text", {
      x: x + barWidth / 2,
      y: height - 3,
      textAnchor: "middle",
      fontSize: "9",
      fill: on ? 'var(--text-secondary)' : 'var(--text-tertiary)'
    }, d.label), /*#__PURE__*/React.createElement("rect", {
      x: x - gap / 2,
      y: 0,
      width: barWidth + gap,
      height: height,
      fill: "transparent",
      onMouseEnter: () => setHover(i),
      style: {
        cursor: 'default'
      }
    }));
  }), overlayPts && /*#__PURE__*/React.createElement("g", {
    style: {
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: overlayLine,
    fill: "none",
    stroke: overlayColor,
    strokeWidth: "1.75",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), overlayPts.map((p, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: p[0],
    cy: p[1],
    r: hover === i ? 3.4 : 2.2,
    fill: overlayColor,
    stroke: "var(--surface-1)",
    strokeWidth: "1"
  })))), hover != null && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: `${colCenter(hover) / W * 100}%`,
      top: 0,
      transform: 'translate(-50%, calc(-100% - 6px))',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: '6px 9px',
      minWidth: 92,
      pointerEvents: 'none',
      zIndex: 5,
      whiteSpace: 'nowrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--text-tertiary)',
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      marginBottom: 2
    }
  }, data[hover].label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: 1,
      background: data[hover].type === 'plan' ? 'transparent' : acFill,
      border: data[hover].type === 'plan' ? '1.4px solid var(--gray-300)' : 'none'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, formatValue(data[hover].value)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9.5,
      color: 'var(--text-tertiary)',
      textTransform: 'capitalize'
    }
  }, data[hover].type || 'actual')), overlay && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginTop: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 2,
      background: overlayColor
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: 'var(--sky-400)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, formatValue(overlay[hover])), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9.5,
      color: 'var(--text-tertiary)'
    }
  }, overlayLabel))));
}
Object.assign(__ds_scope, { ColumnChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ColumnChart.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
/**
 * DataTable — dense, terminal-style table. Columns drive alignment and
 * formatting; numeric columns get tabular figures and right-align.
 * Sticky header, row hover, and an optional selected row with a yellow rail.
 */
function DataTable({
  columns = [],
  rows = [],
  rowKey = (r, i) => r.id ?? i,
  selectedKey,
  onRowClick,
  dense = false,
  stickyHeader = true,
  style = {}
}) {
  const [hover, setHover] = React.useState(null);
  const rh = dense ? 26 : 30;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      overflow: 'auto',
      ...style
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      position: stickyHeader ? 'sticky' : 'static',
      top: 0,
      zIndex: 1,
      textAlign: c.numeric || c.align === 'right' ? 'right' : c.align || 'left',
      padding: dense ? '0 10px' : '0 12px',
      height: 30,
      background: 'var(--gray-900)',
      borderBottom: '1px solid var(--border-default)',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)',
      whiteSpace: 'nowrap',
      width: c.width
    }
  }, c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => {
    const k = rowKey(r, i);
    const selected = selectedKey != null && k === selectedKey;
    const hovered = hover === k;
    return /*#__PURE__*/React.createElement("tr", {
      key: k,
      onMouseEnter: () => setHover(k),
      onMouseLeave: () => setHover(null),
      onClick: () => onRowClick && onRowClick(r, i),
      style: {
        height: rh,
        cursor: onRowClick ? 'pointer' : 'default',
        background: selected ? 'var(--yellow-softer)' : hovered ? 'var(--surface-2)' : 'transparent',
        boxShadow: selected ? 'inset 2px 0 0 var(--accent)' : 'none',
        transition: 'background var(--dur-fast) var(--ease-out)'
      }
    }, columns.map(c => {
      const raw = r[c.key];
      const content = c.render ? c.render(raw, r, i) : raw;
      return /*#__PURE__*/React.createElement("td", {
        key: c.key,
        style: {
          textAlign: c.numeric || c.align === 'right' ? 'right' : c.align || 'left',
          padding: dense ? '0 10px' : '0 12px',
          borderBottom: '1px solid var(--border-subtle)',
          fontSize: dense ? 12 : 13,
          color: c.muted ? 'var(--text-tertiary)' : 'var(--text-primary)',
          fontVariantNumeric: c.numeric ? 'tabular-nums' : 'normal',
          fontWeight: c.strong ? 600 : 400,
          whiteSpace: 'nowrap'
        }
      }, content);
    }));
  }))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/DonutGauge.jsx
try { (() => {
/**
 * DonutGauge — compact ring gauge for a single ratio (risk score,
 * allocation, utilization). Center shows the value; color can be fixed
 * or threshold-driven.
 */
function DonutGauge({
  value = 0,
  max = 100,
  size = 84,
  thickness = 8,
  label,
  center,
  color = 'var(--accent)',
  threshold = false,
  hover = true,
  detail,
  style = {}
}) {
  const [tip, setTip] = React.useState(false);
  const [pin, setPin] = React.useState(false);
  const show = tip || pin;
  const ratio = Math.max(0, Math.min(value / max, 1));
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  let c = color;
  if (threshold) c = ratio >= 1 ? 'var(--danger-500)' : ratio >= 0.8 ? 'var(--warning-500)' : 'var(--up-500)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 7,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      cursor: hover ? 'pointer' : 'default'
    },
    onMouseEnter: hover ? () => setTip(true) : undefined,
    onMouseLeave: () => setTip(false),
    onClick: hover ? () => setPin(p => !p) : undefined
  }, /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    style: {
      transform: 'rotate(-90deg)'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: "var(--gray-800)",
    strokeWidth: thickness
  }), /*#__PURE__*/React.createElement("circle", {
    cx: size / 2,
    cy: size / 2,
    r: r,
    fill: "none",
    stroke: c,
    strokeWidth: thickness,
    strokeLinecap: "butt",
    strokeDasharray: circ,
    strokeDashoffset: circ * (1 - ratio),
    style: {
      transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out)'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: size * 0.26,
      fontWeight: 600,
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1
    }
  }, center != null ? center : Math.round(ratio * 100))), show && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      top: 0,
      transform: 'translate(-50%, calc(-100% - 6px))',
      background: 'var(--surface-overlay)',
      border: `1px solid ${pin ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: '6px 9px',
      pointerEvents: 'none',
      zIndex: 6,
      whiteSpace: 'nowrap'
    }
  }, detail != null ? detail : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, (+value).toLocaleString(), " / ", (+max).toLocaleString(), " \xB7 ", (ratio * 100).toFixed(0), "%"))), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, label));
}
Object.assign(__ds_scope, { DonutGauge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DonutGauge.jsx", error: String((e && e.message) || e) }); }

// components/data/ForecastChart.jsx
try { (() => {
/**
 * ForecastChart — IBCS-style accumulated-result chart. A solid ACTUAL line
 * runs to the "current month" divider, then splits into a three-scenario
 * FORECAST fan (optimistic / average / pessimistic) drawn with dashed
 * forecast notation and a faint band between the extremes. End markers and a
 * hover tooltip disclose the three scenario values (click to pin). Measures
 * its container so geometry stays crisp.
 */
function ForecastChart({
  actual = [],
  optimistic = [],
  average = [],
  pessimistic = [],
  labels = [],
  splitLabel = 'current month',
  height = 230,
  yTicks = 5,
  yFormat = v => v + 'M',
  color = 'var(--gray-100)',
  style = {}
}) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(680);
  const [hi, setHi] = React.useState(null);
  const [pin, setPin] = React.useState(null);
  React.useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(e => {
      const cw = e[0].contentRect.width;
      if (cw) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const A = actual.length; // actual points 0..A-1
  const F = average.length; // forecast points share index A-1 (start = last actual)
  const total = A + F - 1; // total timeline points
  const n = total;
  const split = A - 1;
  const cAvg = 'var(--sky-500)',
    cOpt = 'var(--up-500)',
    cPess = 'var(--down-500)';
  const allVals = actual.concat(optimistic, average, pessimistic);
  const rawMin = Math.min(...allVals),
    rawMax = Math.max(...allVals);
  const padv = (rawMax - rawMin || 1) * 0.1;
  const min = rawMin - padv,
    max = rawMax + padv,
    span = max - min || 1;
  const ml = 8,
    mr = 44,
    mt = 12,
    mb = 22;
  const plotW = Math.max(w - ml - mr, 10);
  const plotH = Math.max(height - mt - mb, 10);
  const X = i => ml + (n <= 1 ? 0 : i / (n - 1) * plotW);
  const Y = v => mt + (1 - (v - min) / span) * plotH;

  // forecast arrays are indexed from the split: timeline index = split + k
  const fX = k => X(split + k);
  const pathFrom = arr => arr.map((v, k) => `${k ? 'L' : 'M'}${fX(k).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const actualPath = actual.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const band = `${optimistic.map((v, k) => `${k ? 'L' : 'M'}${fX(k).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')} ` + `${pessimistic.slice().reverse().map((v, k) => `L${fX(F - 1 - k).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')} Z`;
  const ticks = Array.from({
    length: yTicks + 1
  }, (_, k) => min + k / yTicks * span);
  const xEvery = Math.max(1, Math.ceil(n / 8));
  const active = hi != null ? hi : pin;
  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * w;
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(X(i) - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setHi(best);
  };
  const fk = active != null ? active - split : -1;
  const inForecast = fk >= 0;
  const aValue = active != null && active < A ? actual[active] : null;
  const Tri = ({
    x,
    y,
    up,
    fill
  }) => /*#__PURE__*/React.createElement("path", {
    d: up ? `M${x} ${y - 5} L${x + 4.5} ${y + 3} L${x - 4.5} ${y + 3} Z` : `M${x} ${y + 5} L${x + 4.5} ${y - 3} L${x - 4.5} ${y - 3} Z`,
    fill: fill,
    stroke: "var(--surface-1)",
    strokeWidth: "1"
  });
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      width: '100%',
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: height,
    style: {
      display: 'block',
      cursor: 'pointer'
    },
    onMouseMove: onMove,
    onMouseLeave: () => setHi(null),
    onClick: () => setPin(p => p === hi ? null : hi)
  }, ticks.map((t, k) => {
    const y = Y(t);
    return /*#__PURE__*/React.createElement("g", {
      key: k
    }, /*#__PURE__*/React.createElement("line", {
      x1: ml,
      y1: y,
      x2: ml + plotW,
      y2: y,
      stroke: "var(--border-subtle)",
      strokeWidth: "1",
      strokeDasharray: k === 0 ? '0' : '2 3'
    }), /*#__PURE__*/React.createElement("text", {
      x: ml + plotW + 7,
      y: y + 3,
      textAnchor: "start",
      fontSize: "9.5",
      fill: "var(--text-tertiary)",
      style: {
        fontVariantNumeric: 'tabular-nums'
      }
    }, yFormat(Math.round(t))));
  }), labels.map((lb, i) => i % xEvery === 0 || i === n - 1 ? /*#__PURE__*/React.createElement("text", {
    key: i,
    x: X(i),
    y: height - 6,
    textAnchor: "middle",
    fontSize: "9.5",
    fill: active === i ? 'var(--text-secondary)' : 'var(--text-tertiary)'
  }, lb) : null), /*#__PURE__*/React.createElement("line", {
    x1: X(split),
    y1: mt,
    x2: X(split),
    y2: mt + plotH,
    stroke: "var(--border-strong)",
    strokeWidth: "1",
    strokeDasharray: "3 3"
  }), /*#__PURE__*/React.createElement("text", {
    x: X(split) - 5,
    y: mt + 34,
    fontSize: "8.5",
    fill: "var(--text-tertiary)",
    textAnchor: "end",
    transform: `rotate(-90, ${X(split) - 5}, ${mt + 34})`,
    style: {
      letterSpacing: '0.05em'
    }
  }, splitLabel), /*#__PURE__*/React.createElement("path", {
    d: band,
    fill: "color-mix(in srgb, var(--sky-500) 7%, transparent)",
    stroke: "none"
  }), /*#__PURE__*/React.createElement("path", {
    d: pathFrom(optimistic),
    fill: "none",
    stroke: cOpt,
    strokeWidth: "1.5",
    strokeDasharray: "2 3",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: pathFrom(pessimistic),
    fill: "none",
    stroke: cPess,
    strokeWidth: "1.5",
    strokeDasharray: "2 3",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: pathFrom(average),
    fill: "none",
    stroke: cAvg,
    strokeWidth: "1.9",
    strokeDasharray: "5 4",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement("path", {
    d: actualPath,
    fill: "none",
    stroke: color,
    strokeWidth: "2.1",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), /*#__PURE__*/React.createElement(Tri, {
    x: fX(F - 1),
    y: Y(optimistic[F - 1]),
    up: true,
    fill: cOpt
  }), /*#__PURE__*/React.createElement("rect", {
    x: fX(F - 1) - 3.6,
    y: Y(average[F - 1]) - 3.6,
    width: "7.2",
    height: "7.2",
    fill: cAvg,
    stroke: "var(--surface-1)",
    strokeWidth: "1"
  }), /*#__PURE__*/React.createElement(Tri, {
    x: fX(F - 1),
    y: Y(pessimistic[F - 1]),
    up: false,
    fill: cPess
  }), active != null && /*#__PURE__*/React.createElement("line", {
    x1: X(active),
    y1: mt,
    x2: X(active),
    y2: mt + plotH,
    stroke: pin === active ? 'var(--accent)' : 'var(--border-strong)',
    strokeWidth: "1"
  })), active != null && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: `${X(active) / w * 100}%`,
      top: 12,
      transform: `translate(${X(active) > w * 0.62 ? 'calc(-100% - 12px)' : '12px'}, 0)`,
      background: 'var(--surface-overlay)',
      border: `1px solid ${pin === active ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      padding: '8px 11px',
      pointerEvents: 'none',
      zIndex: 6,
      whiteSpace: 'nowrap',
      minWidth: 150
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--text-tertiary)',
      letterSpacing: '0.04em',
      marginBottom: 5
    }
  }, inForecast ? 'Forecast · ' : 'Actual · ', labels[active]), inForecast ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(Row, {
    dot: cOpt,
    shape: "tri-up",
    label: "Optimistic",
    value: yFormat(optimistic[fk])
  }), /*#__PURE__*/React.createElement(Row, {
    dot: cAvg,
    shape: "sq",
    label: "Average",
    value: yFormat(average[fk])
  }), /*#__PURE__*/React.createElement(Row, {
    dot: cPess,
    shape: "tri-dn",
    label: "Pessimistic",
    value: yFormat(pessimistic[fk])
  })) : /*#__PURE__*/React.createElement(Row, {
    dot: color,
    shape: "line",
    label: "Actual",
    value: yFormat(aValue)
  })));
}
function Row({
  dot,
  shape,
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      display: 'inline-flex',
      justifyContent: 'center',
      flexShrink: 0
    }
  }, shape === 'sq' ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      background: dot,
      display: 'inline-block'
    }
  }) : shape === 'line' ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 2,
      background: dot,
      display: 'inline-block'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      width: 0,
      height: 0,
      borderLeft: '4px solid transparent',
      borderRight: '4px solid transparent',
      [shape === 'tri-up' ? 'borderBottom' : 'borderTop']: `6px solid ${dot}`
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: 'var(--text-secondary)',
      flex: 1
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, value));
}
Object.assign(__ds_scope, { ForecastChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ForecastChart.jsx", error: String((e && e.message) || e) }); }

// components/data/LimitBar.jsx
try { (() => {
/**
 * LimitBar — horizontal utilization/limit gauge. Fills proportional to
 * value/max and colors by threshold (ok → warning → breach). The warning
 * line is marked; hovering the bar discloses a detail tooltip (value, cap,
 * status). Pass `detail` to override the tooltip body.
 */
function LimitBar({
  value = 0,
  max = 100,
  warn = 0.8,
  breach = 1,
  label,
  display,
  detail,
  showPct = true,
  hover = true,
  height = 6,
  style = {}
}) {
  const [tip, setTip] = React.useState(false);
  const [pin, setPin] = React.useState(false);
  const show = tip || pin;
  const ratio = Math.max(0, value / max);
  const pct = Math.min(ratio, 1) * 100;
  const state = ratio >= breach ? 'breach' : ratio >= warn ? 'warn' : 'ok';
  const colors = {
    ok: 'var(--up-500)',
    warn: 'var(--warning-500)',
    breach: 'var(--danger-500)'
  };
  const labels = {
    ok: 'Within limit',
    warn: 'Near cap',
    breach: 'Breach'
  };
  const c = colors[state];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
      ...style
    }
  }, (label || showPct) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, label), showPct && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: c,
      fontVariantNumeric: 'tabular-nums',
      flexShrink: 0
    }
  }, display != null ? display : `${(ratio * 100).toFixed(0)}%`)), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    },
    onMouseEnter: hover ? () => setTip(true) : undefined,
    onMouseLeave: () => setTip(false),
    onClick: hover ? () => setPin(p => !p) : undefined
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height,
      background: 'var(--gray-800)',
      borderRadius: 'var(--radius-xs)',
      overflow: 'hidden',
      cursor: hover ? 'pointer' : 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      width: `${pct}%`,
      background: c,
      borderRadius: 'var(--radius-xs)',
      transition: 'width var(--dur-slow) var(--ease-out)'
    }
  }), warn < 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: -1,
      bottom: -1,
      left: `${warn * 100}%`,
      width: 1,
      background: 'var(--border-strong)'
    }
  })), show && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: `${pct}%`,
      top: 0,
      transform: 'translate(-50%, calc(-100% - 7px))',
      background: 'var(--surface-overlay)',
      border: `1px solid ${pin ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: '6px 9px',
      pointerEvents: 'none',
      zIndex: 6,
      whiteSpace: 'nowrap'
    }
  }, detail != null ? detail : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: c
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: 'var(--text-heading)'
    }
  }, labels[state])), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: 'var(--text-secondary)',
      fontVariantNumeric: 'tabular-nums',
      marginTop: 2
    }
  }, (+value).toLocaleString(), " / ", (+max).toLocaleString(), " \xB7 ", (ratio * 100).toFixed(0), "%")))));
}
Object.assign(__ds_scope, { LimitBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/LimitBar.jsx", error: String((e && e.message) || e) }); }

// components/data/LineChart.jsx
try { (() => {
/**
 * LineChart — a full line/area chart with circle markers and elegant axes.
 * Measures its container so geometry stays crisp (no stretch), draws a muted
 * y-axis with value ticks + an x-axis with category labels, plots circle
 * markers at every point, supports a sky-blue overlay series, and reveals a
 * crosshair + tooltip on hover (click to pin). The house line-chart.
 */
function LineChart({
  data = [],
  labels,
  overlay,
  overlayLabel = 'Plan',
  overlayColor = 'var(--sky-500)',
  color = 'var(--accent)',
  height = 180,
  yTicks = 4,
  yFormat = v => Math.round(v),
  area = true,
  markers = true,
  hover = true,
  style = {}
}) {
  const ref = React.useRef(null);
  const [w, setW] = React.useState(640);
  const [hi, setHi] = React.useState(null);
  const [pin, setPin] = React.useState(null);
  React.useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => {
      const cw = entries[0].contentRect.width;
      if (cw) setW(cw);
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const n = data.length;
  const all = overlay ? data.concat(overlay) : data;
  const rawMin = Math.min(...all),
    rawMax = Math.max(...all);
  // pad the domain a touch for breathing room
  const pad = (rawMax - rawMin || 1) * 0.08;
  const min = rawMin - pad,
    max = rawMax + pad;
  const span = max - min || 1;
  const ml = 42,
    mr = 12,
    mt = 10,
    mb = labels ? 22 : 10;
  const plotW = Math.max(w - ml - mr, 10);
  const plotH = Math.max(height - mt - mb, 10);
  const X = i => ml + (n <= 1 ? plotW / 2 : i / (n - 1) * plotW);
  const Y = v => mt + (1 - (v - min) / span) * plotH;
  const lineOf = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  const linePath = lineOf(data);
  const areaPath = `${linePath} L${X(n - 1).toFixed(1)} ${(mt + plotH).toFixed(1)} L${X(0).toFixed(1)} ${(mt + plotH).toFixed(1)} Z`;
  const uid = 'lc' + Math.round(rawMax) + n;
  const ticks = Array.from({
    length: yTicks + 1
  }, (_, k) => min + k / yTicks * span);
  const markerEvery = n > 40 ? Math.ceil(n / 20) : 1;
  const xLabelEvery = labels ? Math.max(1, Math.ceil(labels.length / 8)) : 1;
  const active = hi != null ? hi : pin;
  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * w;
    let best = 0,
      bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(X(i) - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setHi(best);
  };
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      position: 'relative',
      width: '100%',
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: w,
    height: height,
    style: {
      display: 'block',
      cursor: hover ? 'pointer' : 'default'
    },
    onMouseMove: hover ? onMove : undefined,
    onMouseLeave: () => setHi(null),
    onClick: hover ? () => setPin(p => p === hi ? null : hi) : undefined
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: uid,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: color,
    stopOpacity: "0.20"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: color,
    stopOpacity: "0"
  }))), ticks.map((t, k) => {
    const y = Y(t);
    return /*#__PURE__*/React.createElement("g", {
      key: k
    }, /*#__PURE__*/React.createElement("line", {
      x1: ml,
      y1: y,
      x2: ml + plotW,
      y2: y,
      stroke: "var(--border-subtle)",
      strokeWidth: "1",
      strokeDasharray: k === 0 ? '0' : '2 3'
    }), /*#__PURE__*/React.createElement("text", {
      x: ml - 8,
      y: y + 3,
      textAnchor: "end",
      fontSize: "9.5",
      fill: "var(--text-tertiary)",
      style: {
        fontVariantNumeric: 'tabular-nums'
      }
    }, yFormat(t)));
  }), /*#__PURE__*/React.createElement("line", {
    x1: ml,
    y1: mt,
    x2: ml,
    y2: mt + plotH,
    stroke: "var(--border-default)",
    strokeWidth: "1"
  }), labels && labels.map((lb, i) => i % xLabelEvery === 0 || i === n - 1 ? /*#__PURE__*/React.createElement("text", {
    key: i,
    x: X(i),
    y: height - 6,
    textAnchor: "middle",
    fontSize: "9.5",
    fill: active === i ? 'var(--text-secondary)' : 'var(--text-tertiary)'
  }, lb) : null), area && /*#__PURE__*/React.createElement("path", {
    d: areaPath,
    fill: `url(#${uid})`
  }), overlay && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: lineOf(overlay),
    fill: "none",
    stroke: overlayColor,
    strokeWidth: "1.6",
    strokeDasharray: "4 3",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), markers && overlay.map((v, i) => i % markerEvery === 0 || i === n - 1 ? /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: X(i),
    cy: Y(v),
    r: "2.4",
    fill: "var(--surface-1)",
    stroke: overlayColor,
    strokeWidth: "1.4"
  }) : null)), /*#__PURE__*/React.createElement("path", {
    d: linePath,
    fill: "none",
    stroke: color,
    strokeWidth: "1.9",
    strokeLinejoin: "round",
    strokeLinecap: "round"
  }), markers && data.map((v, i) => i % markerEvery === 0 || i === n - 1 ? /*#__PURE__*/React.createElement("circle", {
    key: i,
    cx: X(i),
    cy: Y(v),
    r: active === i ? 3.6 : 2.6,
    fill: active === i ? color : 'var(--surface-1)',
    stroke: color,
    strokeWidth: "1.6"
  }) : null), active != null && /*#__PURE__*/React.createElement("line", {
    x1: X(active),
    y1: mt,
    x2: X(active),
    y2: mt + plotH,
    stroke: pin === active ? 'var(--accent)' : 'var(--border-strong)',
    strokeWidth: "1"
  })), active != null && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: `${X(active) / w * 100}%`,
      top: Y(data[active]) - 4,
      transform: `translate(${X(active) > w * 0.7 ? 'calc(-100% - 10px)' : '10px'}, -50%)`,
      background: 'var(--surface-overlay)',
      border: `1px solid ${pin === active ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: '6px 9px',
      pointerEvents: 'none',
      zIndex: 6,
      whiteSpace: 'nowrap'
    }
  }, labels && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 9.5,
      color: 'var(--text-tertiary)',
      letterSpacing: '0.04em',
      marginBottom: 2
    }
  }, labels[active]), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 2,
      background: color
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12.5,
      fontWeight: 600,
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, yFormat(data[active]))), overlay && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      marginTop: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 2,
      background: overlayColor
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: 'var(--sky-400)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, yFormat(overlay[active])), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9.5,
      color: 'var(--text-tertiary)'
    }
  }, overlayLabel))));
}
Object.assign(__ds_scope, { LineChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/LineChart.jsx", error: String((e && e.message) || e) }); }

// components/data/Sparkline.jsx
try { (() => {
/**
 * Sparkline — tiny inline trend chart (SVG). Auto-colors up/down by net
 * direction unless `color` is given. Optional area fill. With `hover`
 * (default on) it reveals a crosshair dot + tooltip on mouse-move, so a
 * sparkline doubles as a queryable micro-chart.
 */
function Sparkline({
  data = [],
  width = 90,
  height = 28,
  color,
  area = true,
  strokeWidth = 1.5,
  hover = true,
  labels,
  format = v => v,
  style = {}
}) {
  const [idx, setIdx] = React.useState(null);
  const [pin, setPin] = React.useState(null);
  if (!data.length) return /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    style: style
  });
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = strokeWidth + 1;
  const stepX = (width - pad * 2) / (data.length - 1 || 1);
  const pts = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y];
  });
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const up = data[data.length - 1] >= data[0];
  const stroke = color || (up ? 'var(--up-500)' : 'var(--down-500)');
  const uid = React.useId ? React.useId().replace(/:/g, '') : 'sp' + Math.random().toString(36).slice(2, 8);
  const areaPath = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${height - pad} L${pts[0][0].toFixed(1)} ${height - pad} Z`;
  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * width;
    let best = 0,
      bd = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p[0] - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setIdx(best);
  };
  const active = idx != null ? idx : pin;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'inline-block',
      width,
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: height,
    style: {
      display: 'block',
      overflow: 'visible',
      cursor: hover ? 'pointer' : 'default'
    },
    onMouseMove: hover ? onMove : undefined,
    onMouseLeave: () => setIdx(null),
    onClick: hover ? () => setPin(p => p === idx ? null : idx) : undefined
  }, area && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
    id: uid,
    x1: "0",
    y1: "0",
    x2: "0",
    y2: "1"
  }, /*#__PURE__*/React.createElement("stop", {
    offset: "0%",
    stopColor: stroke,
    stopOpacity: "0.22"
  }), /*#__PURE__*/React.createElement("stop", {
    offset: "100%",
    stopColor: stroke,
    stopOpacity: "0"
  }))), /*#__PURE__*/React.createElement("path", {
    d: areaPath,
    fill: `url(#${uid})`
  })), /*#__PURE__*/React.createElement("path", {
    d: line,
    fill: "none",
    stroke: stroke,
    strokeWidth: strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), active != null && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: pts[active][0],
    y1: 0,
    x2: pts[active][0],
    y2: height,
    stroke: pin === active ? 'var(--accent)' : 'var(--border-strong)',
    strokeWidth: "1"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: pts[active][0],
    cy: pts[active][1],
    r: strokeWidth + 1.4,
    fill: stroke,
    stroke: "var(--surface-1)",
    strokeWidth: "1.2"
  })), /*#__PURE__*/React.createElement("circle", {
    cx: pts[pts.length - 1][0],
    cy: pts[pts.length - 1][1],
    r: strokeWidth + 0.6,
    fill: stroke,
    opacity: active != null ? 0 : 1
  })), active != null && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: `${pts[active][0] / width * 100}%`,
      top: 0,
      transform: 'translate(-50%, calc(-100% - 5px))',
      background: 'var(--surface-overlay)',
      border: `1px solid ${pin === active ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-sm)',
      boxShadow: 'var(--shadow-md)',
      padding: '3px 7px',
      pointerEvents: 'none',
      zIndex: 6,
      whiteSpace: 'nowrap'
    }
  }, labels && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9.5,
      color: 'var(--text-tertiary)',
      marginRight: 6
    }
  }, labels[active]), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, format(data[active]))));
}
Object.assign(__ds_scope, { Sparkline });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Sparkline.jsx", error: String((e && e.message) || e) }); }

// components/data/StatTile.jsx
try { (() => {
/**
 * StatTile — a KPI metric block: eyebrow label, large tabular value,
 * a signed delta, and an optional sparkline. The workhorse of the
 * dashboard header strip.
 */
function StatTile({
  label,
  value,
  unit,
  delta,
  deltaDir,
  sub,
  spark,
  sparkColor,
  accent = false,
  style = {}
}) {
  // Infer direction from delta string if not provided.
  let dir = deltaDir;
  if (!dir && typeof delta === 'string') {
    if (delta.trim().startsWith('-') || delta.trim().startsWith('−')) dir = 'down';else if (delta.trim().startsWith('+')) dir = 'up';else dir = 'flat';
  }
  const dColor = dir === 'up' ? 'var(--up-500)' : dir === 'down' ? 'var(--down-500)' : 'var(--text-tertiary)';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 7,
      padding: '13px 15px',
      background: 'var(--surface-1)',
      border: `1px solid ${accent ? 'color-mix(in srgb, var(--accent) 45%, var(--border-default))' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--inset-top-light)',
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: accent ? 'var(--accent-text)' : 'var(--text-tertiary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 4,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 26,
      fontWeight: 600,
      letterSpacing: 'var(--tracking-display)',
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1
    }
  }, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-tertiary)'
    }
  }, unit)), spark && /*#__PURE__*/React.createElement(__ds_scope.Sparkline, {
    data: spark,
    color: sparkColor,
    width: 74,
    height: 26
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8
    }
  }, delta != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: dColor,
      fontVariantNumeric: 'tabular-nums',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3
    }
  }, arrow && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9
    }
  }, arrow), delta), sub && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-tertiary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, sub)));
}
Object.assign(__ds_scope, { StatTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/StatTile.jsx", error: String((e && e.message) || e) }); }

// components/data/Tracker.jsx
try { (() => {
/**
 * Tracker — a row of small segments encoding status over a sequence (days,
 * checks, SLA windows). Tremor-style. Each segment carries a status color and
 * a hover tooltip. Great for limit-status history, data-feed health, uptime.
 */
function Tracker({
  data = [],
  height = 26,
  gap = 2,
  radius = 1,
  style = {}
}) {
  const [hi, setHi] = React.useState(null);
  const colors = {
    ok: 'var(--up-500)',
    up: 'var(--up-500)',
    warn: 'var(--warning-500)',
    warning: 'var(--warning-500)',
    breach: 'var(--danger-500)',
    danger: 'var(--danger-500)',
    info: 'var(--sky-500)',
    accent: 'var(--accent)',
    empty: 'var(--gray-700)',
    neutral: 'var(--gray-600)'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap,
      height
    }
  }, data.map((d, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onMouseEnter: () => setHi(i),
    onMouseLeave: () => setHi(null),
    style: {
      flex: 1,
      height: '100%',
      borderRadius: radius,
      background: d.color || colors[d.status] || colors.empty,
      opacity: hi != null && hi !== i ? 0.6 : 1,
      transition: 'opacity var(--dur-fast)',
      cursor: 'default',
      minWidth: 2
    }
  }))), hi != null && (data[hi].label || data[hi].tooltip || data[hi].value != null) && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: `${(hi + 0.5) / data.length * 100}%`,
      top: 0,
      transform: 'translate(-50%, calc(-100% - 7px))',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      padding: '5px 9px',
      pointerEvents: 'none',
      zIndex: 6,
      whiteSpace: 'nowrap'
    }
  }, data[hi].label && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--text-tertiary)',
      marginBottom: data[hi].tooltip || data[hi].value != null ? 2 : 0
    }
  }, data[hi].label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: data[hi].color || colors[data[hi].status] || colors.empty
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, data[hi].tooltip || data[hi].value || data[hi].status))));
}
Object.assign(__ds_scope, { Tracker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Tracker.jsx", error: String((e && e.message) || e) }); }

// components/data/VarianceBar.jsx
try { (() => {
/**
 * VarianceBar — IBCS plus/minus variance element. A bar grows right from a
 * centered zero axis for favorable variance and left for unfavorable, with
 * a signed, tabular value. Positive = favorable (green) by default; set
 * `invert` for metrics where an increase is bad (cost, VaR, drawdown).
 */
function VarianceBar({
  value = 0,
  max,
  invert = false,
  suffix = '',
  prefix = '',
  decimals = 1,
  showValue = true,
  height = 14,
  width = 120,
  style = {}
}) {
  const favorable = invert ? value < 0 : value > 0;
  const color = value === 0 ? 'var(--text-tertiary)' : favorable ? 'var(--up-500)' : 'var(--down-500)';
  const scale = max || Math.max(Math.abs(value) * 1.15, 0.0001);
  const pct = Math.min(Math.abs(value) / scale, 1) * 50; // half-width max
  const pos = value >= 0;
  const sign = value > 0 ? '+' : value < 0 ? '\u2212' : '';
  const txt = `${sign}${prefix}${Math.abs(value).toFixed(decimals)}${suffix}`;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width,
      height,
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      top: 0,
      bottom: 0,
      width: 1,
      background: 'var(--border-strong)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 3,
      bottom: 3,
      [pos ? 'left' : 'right']: '50%',
      width: `${pct}%`,
      background: color
    }
  })), showValue && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color,
      fontVariantNumeric: 'tabular-nums',
      minWidth: 44,
      textAlign: 'right'
    }
  }, txt));
}
Object.assign(__ds_scope, { VarianceBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/VarianceBar.jsx", error: String((e && e.message) || e) }); }

// components/data/ScorecardKPI.jsx
try { (() => {
/**
 * ScorecardKPI — IBCS / Zebra-BI style KPI card. A headline actual value,
 * an explicit variance vs a reference (plan / prior year) shown both as a
 * signed Δ and a plus/minus bar, and an IBCS column trend (actual solid,
 * forecast hatched). Built for scorecard strips, not single hero numbers.
 */
function ScorecardKPI({
  label,
  value,
  unit,
  period = 'vs plan',
  deltaPct,
  deltaAbs,
  invert = false,
  trend = [],
  accent = false,
  style = {}
}) {
  const favorable = deltaPct == null ? null : invert ? deltaPct < 0 : deltaPct > 0;
  const dColor = favorable == null ? 'var(--text-tertiary)' : favorable ? 'var(--up-500)' : 'var(--down-500)';
  const tri = deltaPct > 0 ? '\u25B2' : deltaPct < 0 ? '\u25BC' : '';
  const sign = deltaPct > 0 ? '+' : deltaPct < 0 ? '\u2212' : '';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 9,
      padding: '13px 15px',
      background: 'var(--surface-1)',
      border: `1px solid ${accent ? 'color-mix(in srgb, var(--accent) 45%, var(--border-default))' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--inset-top-light)',
      minWidth: 0,
      ...style
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: 'var(--tracking-caps)',
      textTransform: 'uppercase',
      color: accent ? 'var(--accent-text)' : 'var(--text-tertiary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: 'var(--text-disabled)',
      flexShrink: 0
    }
  }, period)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 4,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 27,
      fontWeight: 600,
      letterSpacing: 'var(--tracking-display)',
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1
    }
  }, value), unit && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-tertiary)'
    }
  }, unit)), deltaPct != null && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      color: dColor,
      fontVariantNumeric: 'tabular-nums',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8
    }
  }, tri), sign, Math.abs(deltaPct), "%"), deltaAbs != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10.5,
      color: 'var(--text-tertiary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, deltaAbs))), deltaPct != null && /*#__PURE__*/React.createElement(__ds_scope.VarianceBar, {
    value: deltaPct,
    invert: invert,
    suffix: "%",
    width: 130,
    height: 12,
    style: {
      marginTop: -2
    }
  }), trend.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.ColumnChart, {
    data: trend,
    accent: accent,
    height: 56,
    barWidth: 12,
    gap: 6
  })));
}
Object.assign(__ds_scope, { ScorecardKPI });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/ScorecardKPI.jsx", error: String((e && e.message) || e) }); }

// components/flow/DriverFlow.jsx
try { (() => {
/**
 * DriverFlow — a node-graph for driver / decision trees (React Flow lineage,
 * ValQ-style). You position nodes on a canvas (x, y, w, h) and declare edges;
 * DriverFlow draws smooth bezier connectors and renders each node as a KPI
 * card (label, value, signed variance) with IBCS-ish notation. Operator nodes
 * (kind:"op") render as small +/−/×/= junctions. Pass `renderNode` to fully
 * customise a node.
 */
function DriverFlow({
  nodes = [],
  edges = [],
  width = 900,
  height = 420,
  autoLayout = false,
  nodeWidth = 152,
  nodeHeight = 74,
  hGap = 94,
  vGap = 22,
  renderNode,
  style = {}
}) {
  const needsLayout = autoLayout || nodes.some(n => n.x == null || n.y == null);
  const layout = React.useMemo(() => {
    if (!needsLayout) return {
      list: nodes,
      h: height
    };
    const sources = {};
    nodes.forEach(n => {
      sources[n.id] = [];
    });
    edges.forEach(e => {
      if (sources[e.to]) sources[e.to].push(e.from);
    });
    const tier = {};
    const visit = (id, seen) => {
      if (tier[id] != null) return tier[id];
      if (seen.has(id)) return 0;
      seen.add(id);
      const src = sources[id] || [];
      const t = src.length ? Math.max(...src.map(s => visit(s, seen))) + 1 : 0;
      tier[id] = t;
      return t;
    };
    nodes.forEach(n => visit(n.id, new Set()));
    const groups = {};
    nodes.forEach(n => {
      (groups[tier[n.id]] = groups[tier[n.id]] || []).push(n);
    });
    const counts = Object.values(groups).map(g => g.reduce((a, n) => a + (n.h || nodeHeight) + vGap, -vGap));
    const canvasH = Math.max(...counts, nodeHeight);
    const list = nodes.map(n => {
      const t = tier[n.id],
        g = groups[t],
        idx = g.indexOf(n);
      const groupH = g.reduce((a, m) => a + (m.h || nodeHeight) + vGap, -vGap);
      let y = 8 + (canvasH - groupH) / 2;
      for (let i = 0; i < idx; i++) y += (g[i].h || nodeHeight) + vGap;
      return {
        ...n,
        x: 6 + t * (nodeWidth + hGap),
        y,
        w: n.w || nodeWidth,
        h: n.h || nodeHeight
      };
    });
    return {
      list,
      h: canvasH + 16
    };
  }, [nodes, edges, needsLayout, nodeWidth, nodeHeight, hGap, vGap, height]);
  const useNodes = layout.list;
  const H = needsLayout ? Math.max(height, layout.h) : height;
  const byId = React.useMemo(() => Object.fromEntries(useNodes.map(n => [n.id, n])), [useNodes]);
  const anchor = (n, side) => {
    const w = n.w || 150,
      h = n.h || 58;
    if (side === 'right') return [n.x + w, n.y + h / 2];
    if (side === 'left') return [n.x, n.y + h / 2];
    if (side === 'top') return [n.x + w / 2, n.y];
    if (side === 'bottom') return [n.x + w / 2, n.y + h];
    return [n.x + w / 2, n.y + h / 2];
  };
  const path = (a, b) => {
    const dx = Math.max(Math.abs(b[0] - a[0]) * 0.45, 26);
    return `M${a[0]} ${a[1]} C${a[0] + dx} ${a[1]}, ${b[0] - dx} ${b[1]}, ${b[0]} ${b[1]}`;
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width,
      height: H,
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: width,
    height: H,
    style: {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("pattern", {
    id: "df-dots",
    width: "18",
    height: "18",
    patternUnits: "userSpaceOnUse"
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "1",
    cy: "1",
    r: "1",
    fill: "var(--border-subtle)"
  }))), /*#__PURE__*/React.createElement("rect", {
    width: width,
    height: H,
    fill: "url(#df-dots)"
  }), edges.map((e, i) => {
    const s = byId[e.from],
      t = byId[e.to];
    if (!s || !t) return null;
    const a = anchor(s, e.fromSide || 'right');
    const b = anchor(t, e.toSide || 'left');
    const accent = e.accent;
    return /*#__PURE__*/React.createElement("g", {
      key: i
    }, /*#__PURE__*/React.createElement("path", {
      d: path(a, b),
      fill: "none",
      stroke: accent ? 'var(--accent)' : 'var(--border-strong)',
      strokeWidth: accent ? 1.8 : 1.4,
      strokeOpacity: accent ? 0.9 : 0.8
    }), /*#__PURE__*/React.createElement("circle", {
      cx: b[0],
      cy: b[1],
      r: "2.4",
      fill: accent ? 'var(--accent)' : 'var(--gray-500)'
    }));
  })), useNodes.map(n => {
    const w = n.w || 150,
      h = n.h || 58;
    const common = {
      position: 'absolute',
      left: n.x,
      top: n.y,
      width: w,
      height: h
    };
    if (renderNode) return /*#__PURE__*/React.createElement("div", {
      key: n.id,
      style: common
    }, renderNode(n));
    if (n.kind === 'op') {
      return /*#__PURE__*/React.createElement("div", {
        key: n.id,
        style: {
          ...common,
          width: n.w || 26,
          height: n.h || 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 999,
          background: 'var(--surface-2)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-secondary)',
          fontSize: 13,
          fontWeight: 700
        }
      }, n.op);
    }
    return /*#__PURE__*/React.createElement(DriverNode, {
      key: n.id,
      node: n,
      style: common
    });
  }));
}
function DriverNode({
  node,
  style
}) {
  const [hovOpen, setHovOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const open = hovOpen || pinned;
  const accent = node.kind === 'result' || node.accent;
  const hasDetail = node.breakdown || node.note || node.spark;
  const d = node.delta;
  const dColor = d == null ? null : (node.invert ? d < 0 : d > 0) ? 'var(--up-500)' : 'var(--down-500)';
  const tri = d > 0 ? '\u25B2' : d < 0 ? '\u25BC' : '';
  const sign = d > 0 ? '+' : d < 0 ? '\u2212' : '';
  const sparkColor = accent ? 'var(--accent)' : 'var(--sky-500)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...style,
      pointerEvents: 'auto',
      cursor: hasDetail ? 'pointer' : 'default'
    },
    onMouseEnter: () => setHovOpen(true),
    onMouseLeave: () => setHovOpen(false),
    onClick: () => hasDetail && setPinned(p => !p)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 3,
      padding: '8px 11px',
      background: accent ? 'color-mix(in srgb, var(--accent) 8%, var(--surface-3))' : 'var(--surface-3)',
      border: `1px solid ${pinned ? 'var(--accent)' : accent ? 'color-mix(in srgb, var(--accent) 50%, var(--border-default))' : 'var(--border-default)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: open ? 'var(--shadow-md)' : 'var(--shadow-sm)',
      transition: 'box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: accent ? 'var(--accent-text)' : 'var(--text-tertiary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, node.label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 600,
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, node.value), d != null && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      fontWeight: 600,
      color: dColor,
      fontVariantNumeric: 'tabular-nums',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 7
    }
  }, tri), sign, Math.abs(d), "%")), node.sub && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9.5,
      color: 'var(--text-tertiary)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    }
  }, node.sub), node.spark && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Sparkline, {
    data: node.spark,
    width: (node.w || 150) - 22,
    height: 16,
    hover: false,
    color: sparkColor,
    area: false,
    strokeWidth: 1.4
  }))), open && hasDetail && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      top: '100%',
      transform: 'translate(-50%, 8px)',
      width: Math.max(node.w || 150, 168),
      background: 'var(--surface-overlay)',
      border: `1px solid ${pinned ? 'var(--accent)' : 'var(--border-strong)'}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      padding: '9px 11px',
      zIndex: 20,
      pointerEvents: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-tertiary)'
    }
  }, node.label), pinned && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 8.5,
      fontWeight: 600,
      color: 'var(--accent-text)',
      letterSpacing: '0.04em'
    }
  }, "PINNED")), node.breakdown && node.breakdown.map((b, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '2px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-secondary)'
    }
  }, b.k), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      fontWeight: 600,
      color: b.color || 'var(--text-primary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, b.v))), node.note && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10.5,
      color: 'var(--text-tertiary)',
      lineHeight: 1.45,
      marginTop: node.breakdown ? 6 : 0
    }
  }, node.note)));
}
Object.assign(__ds_scope, { DriverFlow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/flow/DriverFlow.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Checkbox — square check control. Yellow when checked; supports an
 * indeterminate state and an optional label.
 */
function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  disabled = false,
  label,
  size = 16,
  ...rest
}) {
  const on = checked || indeterminate;
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      userSelect: 'none'
    }
  }, /*#__PURE__*/React.createElement("span", _extends({
    onClick: () => !disabled && onChange && onChange(!checked),
    style: {
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: 'var(--radius-xs)',
      border: `1px solid ${on ? 'var(--accent-press)' : 'var(--border-strong)'}`,
      background: on ? 'var(--accent)' : 'var(--gray-900)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background var(--dur-fast), border-color var(--dur-fast)'
    }
  }, rest), indeterminate ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: size * 0.5,
      height: 2,
      background: 'var(--text-on-accent)',
      borderRadius: 1
    }
  }) : checked ? /*#__PURE__*/React.createElement("svg", {
    width: size * 0.66,
    height: size * 0.66,
    viewBox: "0 0 12 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6.2L5 8.5L9.5 3.5",
    stroke: "var(--text-on-accent)",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })) : null), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--text-secondary)'
    }
  }, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/NumberStepper.jsx
try { (() => {
/**
 * NumberStepper — numeric input with −/+ steppers. Tabular figures, optional
 * unit affix, min/max clamping. Good for quantities, weights, horizons.
 */
function NumberStepper({
  value = 0,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  affix,
  size = 'md',
  disabled = false,
  width = 120,
  format = v => v,
  style = {}
}) {
  const h = {
    sm: 24,
    md: 30,
    lg: 38
  }[size];
  const fs = {
    sm: 12,
    md: 13,
    lg: 14
  }[size];
  const clamp = v => Math.max(min, Math.min(max, +v.toFixed(6)));
  const setV = v => {
    if (!disabled && onChange) onChange(clamp(v));
  };
  const Btn = ({
    d,
    children
  }) => /*#__PURE__*/React.createElement("button", {
    type: "button",
    disabled: disabled || (d < 0 ? value <= min : value >= max),
    onClick: () => setV(value + d * step),
    style: {
      all: 'unset',
      cursor: disabled ? 'not-allowed' : 'pointer',
      width: h - 2,
      height: '100%',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-secondary)',
      flexShrink: 0
    },
    onMouseEnter: e => {
      if (!disabled) e.currentTarget.style.color = 'var(--text-primary)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = 'var(--text-secondary)';
    }
  }, children);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      height: h,
      width,
      background: 'var(--gray-900)',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-sm)',
      opacity: disabled ? 0.5 : 1,
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement(Btn, {
    d: -1
  }, /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6h7",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      borderLeft: '1px solid var(--border-subtle)',
      borderRight: '1px solid var(--border-subtle)',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("input", {
    value: value,
    onChange: e => {
      const n = parseFloat(e.target.value);
      if (!isNaN(n)) setV(n);else if (e.target.value === '' || e.target.value === '-') onChange && onChange(e.target.value);
    },
    inputMode: "decimal",
    style: {
      all: 'unset',
      width: '100%',
      textAlign: 'center',
      fontFamily: 'var(--font-sans)',
      fontSize: fs,
      fontWeight: 500,
      color: 'var(--text-primary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }), affix && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: fs - 1,
      color: 'var(--text-tertiary)',
      paddingRight: 2
    }
  }, affix)), /*#__PURE__*/React.createElement(Btn, {
    d: 1
  }, /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "11",
    viewBox: "0 0 12 12"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 2.5v7M2.5 6h7",
    stroke: "currentColor",
    strokeWidth: "1.5",
    strokeLinecap: "round"
  }))));
}
Object.assign(__ds_scope, { NumberStepper });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/NumberStepper.jsx", error: String((e && e.message) || e) }); }

// components/forms/RadioGroup.jsx
try { (() => {
/**
 * RadioGroup — single-choice control. Pass options [{value,label,hint}] and
 * a selected value. Rows by default; set `inline` for a horizontal layout.
 */
function RadioGroup({
  options = [],
  value,
  onChange,
  name,
  inline = false,
  disabled = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    role: "radiogroup",
    style: {
      display: 'flex',
      flexDirection: inline ? 'row' : 'column',
      gap: inline ? 18 : 10,
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, options.map(o => {
    const on = o.value === value;
    return /*#__PURE__*/React.createElement("label", {
      key: o.value,
      style: {
        display: 'inline-flex',
        alignItems: o.hint ? 'flex-start' : 'center',
        gap: 9,
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none'
      }
    }, /*#__PURE__*/React.createElement("span", {
      onClick: () => !disabled && onChange && onChange(o.value),
      style: {
        width: 16,
        height: 16,
        flexShrink: 0,
        marginTop: o.hint ? 1 : 0,
        borderRadius: 999,
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border-strong)'}`,
        background: 'var(--gray-900)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'border-color var(--dur-fast)'
      }
    }, on && /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: 999,
        background: 'var(--accent)'
      }
    })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        color: on ? 'var(--text-primary)' : 'var(--text-secondary)'
      }
    }, o.label), o.hint && /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'block',
        fontSize: 11,
        color: 'var(--text-tertiary)',
        marginTop: 1
      }
    }, o.hint)));
  }));
}
Object.assign(__ds_scope, { RadioGroup });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/RadioGroup.jsx", error: String((e && e.message) || e) }); }

// components/forms/Slider.jsx
try { (() => {
/**
 * Slider — single or dual-thumb range slider. Pass a number for a single
 * thumb, or [a, b] for a range. Brand-yellow fill, value bubbles, optional
 * marks. Controlled (value + onChange) or uncontrolled (defaultValue).
 */
function Slider({
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  range = Array.isArray(value) || Array.isArray(defaultValue),
  label,
  showValue = true,
  format = v => v,
  marks,
  disabled = false,
  style = {}
}) {
  const trackRef = React.useRef(null);
  const [internal, setInternal] = React.useState(defaultValue != null ? defaultValue : range ? [min, max] : min);
  const val = value != null ? value : internal;
  const set = nv => {
    if (onChange) onChange(nv);else setInternal(nv);
  };
  const [drag, setDrag] = React.useState(null);
  const clamp = v => Math.max(min, Math.min(max, v));
  const snap = v => clamp(Math.round(v / step) * step);
  const pctOf = v => (v - min) / (max - min) * 100;
  const valFromX = clientX => {
    const r = trackRef.current.getBoundingClientRect();
    let p = (clientX - r.left) / r.width;
    p = Math.max(0, Math.min(1, p));
    return snap(min + p * (max - min));
  };
  React.useEffect(() => {
    if (drag == null) return;
    const move = e => {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const nv = valFromX(cx);
      if (range) {
        const next = [...val];
        next[drag] = nv;
        if (next[0] > next[1]) next.reverse();
        set(next);
      } else set(nv);
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, val]);
  const onTrackDown = e => {
    if (disabled) return;
    const nv = valFromX(e.clientX);
    if (range) {
      const i = Math.abs(nv - val[0]) <= Math.abs(nv - val[1]) ? 0 : 1;
      const next = [...val];
      next[i] = nv;
      if (next[0] > next[1]) next.reverse();
      set(next);
      setDrag(i);
    } else {
      set(nv);
      setDrag('single');
    }
  };
  const lo = range ? pctOf(val[0]) : 0;
  const hi = range ? pctOf(val[1]) : pctOf(val);
  const Thumb = ({
    pct,
    idx,
    v
  }) => /*#__PURE__*/React.createElement("div", {
    onPointerDown: e => {
      if (disabled) return;
      e.stopPropagation();
      setDrag(idx);
    },
    style: {
      position: 'absolute',
      left: `${pct}%`,
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: 14,
      height: 14,
      borderRadius: 999,
      background: 'var(--gray-0)',
      border: '2px solid var(--accent)',
      boxShadow: 'var(--shadow-sm)',
      cursor: disabled ? 'not-allowed' : 'grab',
      touchAction: 'none',
      zIndex: 2
    }
  }, showValue && drag === idx && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 'calc(100% + 7px)',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'var(--surface-overlay)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-sm)',
      padding: '2px 6px',
      fontSize: 11,
      fontWeight: 600,
      color: 'var(--text-heading)',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      boxShadow: 'var(--shadow-md)'
    }
  }, format(v)));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, (label || showValue) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 8,
      marginBottom: 9
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--text-secondary)'
    }
  }, label), showValue && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      color: 'var(--text-primary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, range ? `${format(val[0])} – ${format(val[1])}` : format(val))), /*#__PURE__*/React.createElement("div", {
    ref: trackRef,
    onPointerDown: onTrackDown,
    style: {
      position: 'relative',
      height: 16,
      display: 'flex',
      alignItems: 'center',
      cursor: disabled ? 'not-allowed' : 'pointer',
      touchAction: 'none'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 4,
      borderRadius: 999,
      background: 'var(--gray-700)'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: `${lo}%`,
      width: `${hi - lo}%`,
      height: 4,
      borderRadius: 999,
      background: 'var(--accent)'
    }
  }), marks && marks.map(m => /*#__PURE__*/React.createElement("div", {
    key: m,
    style: {
      position: 'absolute',
      left: `${pctOf(m)}%`,
      top: '50%',
      transform: 'translate(-50%,-50%)',
      width: 2,
      height: 8,
      background: 'var(--border-strong)',
      borderRadius: 999
    }
  })), range ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Thumb, {
    pct: lo,
    idx: 0,
    v: val[0]
  }), /*#__PURE__*/React.createElement(Thumb, {
    pct: hi,
    idx: 1,
    v: val[1]
  })) : /*#__PURE__*/React.createElement(Thumb, {
    pct: hi,
    idx: "single",
    v: val
  })), marks && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: 14,
      marginTop: 2
    }
  }, marks.map(m => /*#__PURE__*/React.createElement("span", {
    key: m,
    style: {
      position: 'absolute',
      left: `${pctOf(m)}%`,
      transform: 'translateX(-50%)',
      fontSize: 9.5,
      color: 'var(--text-tertiary)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, format(m)))));
}
Object.assign(__ds_scope, { Slider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Slider.jsx", error: String((e && e.message) || e) }); }

// components/grid/DataGrid.jsx
try { (() => {
/**
 * DataGrid — enterprise data grid (ag-Grid lineage) for analytical tables.
 * Column types drive rendering: text · number · delta · bar (in-cell) ·
 * variance (IBCS plus/minus) · spark. Supports a pinned (frozen) left
 * column, click-to-sort headers, zebra rows, and a sticky aggregation
 * footer (sum / avg). Compose inside <Panel noPad>.
 */
/**
 * DataGrid — enterprise data grid (ag-Grid lineage) for analytical tables.
 * Column types drive rendering: text · number · delta · bar (in-cell) ·
 * variance (IBCS plus/minus) · spark. Supports a pinned (frozen) left
 * column, click-to-sort headers, zebra rows, a sticky aggregation footer
 * (sum / avg), and hierarchical tree data with expand/collapse drilldown
 * (set `treeData`; rows carry `children`). Compose inside <Panel noPad>.
 */
function DataGrid({
  columns = [],
  rows = [],
  rowKey = (r, i) => r.id ?? i,
  defaultSort,
  zebra = false,
  dense = false,
  selectedKey,
  onRowClick,
  totals = true,
  totalsLabel = 'Total',
  treeData = false,
  getChildren = r => r.children,
  treeColumn,
  defaultExpandedDepth = 1,
  height,
  style = {}
}) {
  const [sort, setSort] = React.useState(defaultSort || null);
  const [hover, setHover] = React.useState(null);
  const rh = dense ? 28 : 32;
  const treeKey = treeColumn || columns[0] && columns[0].key;
  const [expanded, setExpanded] = React.useState(() => {
    const s = new Set();
    const walk = (list, level) => (list || []).forEach(r => {
      const kids = getChildren(r);
      if (Array.isArray(kids) && kids.length) {
        if (level < defaultExpandedDepth) s.add(rowKey(r));
        walk(kids, level + 1);
      }
    });
    if (treeData) walk(rows, 0);
    return s;
  });
  const toggle = key => setExpanded(s => {
    const n = new Set(s);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  // pinned offsets
  let acc = 0;
  const leftOf = {};
  columns.forEach(c => {
    if (c.pinned) {
      leftOf[c.key] = acc;
      acc += c.width || 120;
    }
  });
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return rows;
    const get = r => col.sortValue ? col.sortValue(r[sort.key], r) : r[sort.key];
    return [...rows].sort((a, b) => {
      const x = get(a),
        y = get(b);
      if (typeof x === 'number' && typeof y === 'number') return sort.dir === 'asc' ? x - y : y - x;
      return sort.dir === 'asc' ? String(x).localeCompare(String(y)) : String(y).localeCompare(String(x));
    });
  }, [rows, sort, columns]);
  const toggleSort = (key, sortable) => {
    if (sortable === false) return;
    setSort(s => s && s.key === key ? s.dir === 'asc' ? {
      key,
      dir: 'desc'
    } : null : {
      key,
      dir: 'asc'
    });
  };
  const align = c => c.align || (['number', 'delta', 'bar', 'variance'].includes(c.type) ? 'right' : 'left');
  const pad = dense ? '0 10px' : '0 12px';
  const renderCell = (c, r, i) => {
    const v = r[c.key];
    if (c.render) return c.render(v, r, i);
    switch (c.type) {
      case 'number':
        return /*#__PURE__*/React.createElement("span", {
          style: {
            fontVariantNumeric: 'tabular-nums'
          }
        }, c.format ? c.format(v, r) : v);
      case 'delta':
        {
          const up = v >= 0;
          return /*#__PURE__*/React.createElement("span", {
            style: {
              color: up ? 'var(--up-500)' : 'var(--down-500)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums'
            }
          }, up ? '+' : '\u2212', c.format ? c.format(Math.abs(v), r) : Math.abs(v));
        }
      case 'bar':
        {
          const max = c.barMax || Math.max(...rows.map(row => Math.abs(row[c.key] || 0))) || 1;
          const pct = Math.min(Math.abs(v) / max, 1) * 100;
          const neg = v < 0;
          const barColor = c.accent ? 'var(--accent)' : neg ? 'var(--down-500)' : c.barColor || 'var(--gray-500)';
          return /*#__PURE__*/React.createElement("div", {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              justifyContent: 'flex-end'
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              position: 'relative',
              flex: 1,
              height: 8,
              background: 'var(--gray-850)',
              maxWidth: 80
            }
          }, /*#__PURE__*/React.createElement("div", {
            style: {
              position: 'absolute',
              top: 0,
              bottom: 0,
              [neg ? 'right' : 'left']: 0,
              width: `${pct}%`,
              background: barColor
            }
          })), /*#__PURE__*/React.createElement("span", {
            style: {
              fontVariantNumeric: 'tabular-nums',
              minWidth: 34,
              textAlign: 'right'
            }
          }, c.format ? c.format(v, r) : v));
        }
      case 'variance':
        return /*#__PURE__*/React.createElement(__ds_scope.VarianceBar, {
          value: v,
          invert: c.invert,
          suffix: c.suffix || '',
          prefix: c.prefix || '',
          decimals: c.decimals != null ? c.decimals : 1,
          width: c.barWidth || 92,
          height: 12
        });
      case 'spark':
        return /*#__PURE__*/React.createElement(__ds_scope.Sparkline, {
          data: v,
          width: 64,
          height: 20
        });
      default:
        return v;
    }
  };
  const agg = c => {
    if (!c.agg || c.agg === 'none') return '';
    const nums = rows.map(r => Number(r[c.key])).filter(n => !isNaN(n));
    if (!nums.length) return '';
    let val = c.agg === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length : nums.reduce((a, b) => a + b, 0);
    return c.format ? c.format(+val.toFixed(2)) : +val.toFixed(2);
  };
  const headBg = 'var(--gray-900)';
  const footBg = 'var(--gray-900)';

  // Visible rows: flatten the tree honoring expand state, or the sorted flat list.
  const visible = [];
  if (treeData) {
    const flatten = (list, level) => (list || []).forEach(r => {
      const kids = getChildren(r);
      const hasKids = Array.isArray(kids) && kids.length > 0;
      const key = rowKey(r, visible.length);
      const isExp = expanded.has(key);
      visible.push({
        r,
        level,
        hasKids,
        key,
        isExp
      });
      if (hasKids && isExp) flatten(kids, level + 1);
    });
    flatten(rows, 0);
  } else {
    sorted.forEach((r, i) => visible.push({
      r,
      level: 0,
      hasKids: false,
      key: rowKey(r, i),
      isExp: false
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      overflow: 'auto',
      maxHeight: height,
      ...style
    }
  }, /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'separate',
      borderSpacing: 0,
      fontFamily: 'var(--font-sans)'
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => {
    const sortable = c.sortable !== false && c.type !== 'spark' && !treeData;
    const active = sort && sort.key === c.key;
    return /*#__PURE__*/React.createElement("th", {
      key: c.key,
      onClick: () => toggleSort(c.key, c.sortable),
      style: {
        position: 'sticky',
        top: 0,
        zIndex: c.pinned ? 4 : 2,
        left: c.pinned ? leftOf[c.key] : undefined,
        textAlign: align(c),
        padding: pad,
        height: 32,
        background: headBg,
        borderBottom: '1px solid var(--border-strong)',
        borderRight: c.pinned ? '1px solid var(--border-default)' : undefined,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: active ? 'var(--accent-text)' : 'var(--text-tertiary)',
        whiteSpace: 'nowrap',
        width: c.width,
        cursor: sortable ? 'pointer' : 'default',
        userSelect: 'none'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        flexDirection: align(c) === 'right' ? 'row-reverse' : 'row'
      }
    }, c.label, sortable && /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        flexDirection: 'column',
        lineHeight: 0.5,
        fontSize: 7,
        color: 'var(--text-disabled)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: active && sort.dir === 'asc' ? 'var(--accent)' : 'inherit'
      }
    }, '\u25B2'), /*#__PURE__*/React.createElement("span", {
      style: {
        color: active && sort.dir === 'desc' ? 'var(--accent)' : 'inherit'
      }
    }, '\u25BC'))));
  }))), /*#__PURE__*/React.createElement("tbody", null, visible.map(({
    r,
    level,
    hasKids,
    key: k,
    isExp
  }, i) => {
    const selected = selectedKey != null && k === selectedKey;
    const hovered = hover === k;
    const groupBg = treeData && hasKids ? level === 0 ? 'var(--gray-900)' : 'transparent' : 'transparent';
    const rowBg = selected ? 'var(--yellow-softer)' : hovered ? 'var(--surface-2)' : zebra && !treeData && i % 2 ? 'var(--gray-900)' : groupBg;
    return /*#__PURE__*/React.createElement("tr", {
      key: k,
      onMouseEnter: () => setHover(k),
      onMouseLeave: () => setHover(null),
      onClick: () => onRowClick && onRowClick(r, i),
      style: {
        height: rh,
        cursor: onRowClick ? 'pointer' : 'default'
      }
    }, columns.map(c => {
      const isTree = treeData && c.key === treeKey;
      return /*#__PURE__*/React.createElement("td", {
        key: c.key,
        style: {
          textAlign: align(c),
          padding: pad,
          height: rh,
          background: c.pinned ? selected ? 'var(--surface-2)' : hovered ? 'var(--surface-2)' : treeData && hasKids && level === 0 ? 'var(--gray-900)' : 'var(--surface-1)' : rowBg,
          position: c.pinned ? 'sticky' : undefined,
          left: c.pinned ? leftOf[c.key] : undefined,
          zIndex: c.pinned ? 1 : undefined,
          borderBottom: '1px solid var(--border-subtle)',
          borderRight: c.pinned ? '1px solid var(--border-default)' : undefined,
          boxShadow: selected && c.key === columns[0].key ? 'inset 2px 0 0 var(--accent)' : undefined,
          fontSize: dense ? 12 : 13,
          color: c.muted ? 'var(--text-tertiary)' : 'var(--text-primary)',
          fontWeight: c.strong || isTree && hasKids ? 600 : 400,
          fontVariantNumeric: ['number', 'delta', 'bar', 'variance'].includes(c.type) ? 'tabular-nums' : 'normal',
          whiteSpace: 'nowrap'
        }
      }, isTree ? /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          paddingLeft: level * 15
        }
      }, hasKids ? /*#__PURE__*/React.createElement("button", {
        type: "button",
        onClick: e => {
          e.stopPropagation();
          toggle(k);
        },
        style: {
          all: 'unset',
          cursor: 'pointer',
          width: 14,
          height: 14,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-tertiary)',
          flexShrink: 0
        }
      }, /*#__PURE__*/React.createElement("svg", {
        width: "9",
        height: "9",
        viewBox: "0 0 10 10",
        style: {
          transform: isExp ? 'rotate(90deg)' : 'none',
          transition: 'transform var(--dur-fast) var(--ease-out)'
        }
      }, /*#__PURE__*/React.createElement("path", {
        d: "M3 2l4 3-4 3z",
        fill: "currentColor"
      }))) : /*#__PURE__*/React.createElement("span", {
        style: {
          width: 14,
          flexShrink: 0
        }
      }), /*#__PURE__*/React.createElement("span", null, renderCell(c, r, i))) : renderCell(c, r, i));
    }));
  })), totals && /*#__PURE__*/React.createElement("tfoot", null, /*#__PURE__*/React.createElement("tr", null, columns.map((c, ci) => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      position: 'sticky',
      bottom: 0,
      zIndex: c.pinned ? 4 : 3,
      left: c.pinned ? leftOf[c.key] : undefined,
      textAlign: align(c),
      padding: pad,
      height: rh,
      background: footBg,
      borderTop: '1px solid var(--border-strong)',
      borderRight: c.pinned ? '1px solid var(--border-default)' : undefined,
      fontSize: dense ? 12 : 13,
      fontWeight: 600,
      color: 'var(--text-secondary)',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums'
    }
  }, ci === 0 && !columns[0].agg ? totalsLabel : agg(c)))))));
}
Object.assign(__ds_scope, { DataGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/grid/DataGrid.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/AlertsScreen.jsx
try { (() => {
/* AlertsScreen — limit-breach & risk alert feed. */
(function () {
  const A = window.ApertureRiskDesignSystem_6e73e1;
  const {
    Panel,
    Button,
    Badge,
    Tabs
  } = A;
  const Ic = ({
    n
  }) => /*#__PURE__*/React.createElement("i", {
    "data-lucide": n,
    style: {
      width: 15,
      height: 15
    }
  });
  const ALERTS = [{
    sev: 'critical',
    t: 'EM equity exposure limit breached',
    d: 'EEM long lifts EM exposure to 4.2% vs 4.0% mandate cap.',
    src: 'Limit engine',
    time: '14:28',
    live: true
  }, {
    sev: 'warning',
    t: 'Info Tech sector near cap',
    d: 'Tech exposure at 27.1% of 30% soft limit after NVDA mark-up.',
    src: 'Limit engine',
    time: '13:54',
    live: true
  }, {
    sev: 'warning',
    t: '1-day VaR up 4.1% intraday',
    d: 'VaR rose to $12.4M as tech implied vol widened.',
    src: 'Risk model',
    time: '13:11',
    live: true
  }, {
    sev: 'info',
    t: 'Stress test completed',
    d: 'Nightly batch: 6 scenarios, 1 tail loss > 12% NAV flagged.',
    src: 'Scenario engine',
    time: '06:02',
    live: false
  }, {
    sev: 'positive',
    t: 'Hedge rebalance executed',
    d: 'TSLA short increased by $2.1M; net beta held at 0.92.',
    src: 'Execution',
    time: '09:30',
    live: false
  }];
  function AlertsScreen() {
    const [filter, setFilter] = React.useState('all');
    React.useEffect(() => {
      window.lucide && window.lucide.createIcons();
    });
    const rows = filter === 'all' ? ALERTS : ALERTS.filter(a => filter === 'open' ? a.live : !a.live);
    const tone = {
      critical: 'danger',
      warning: 'warning',
      info: 'info',
      positive: 'up'
    };
    const icon = {
      critical: 'octagon-alert',
      warning: 'triangle-alert',
      info: 'info',
      positive: 'check'
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 14,
        maxWidth: 900,
        margin: '0 auto'
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      noPad: true,
      bodyStyle: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 14px',
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text-heading)'
      }
    }, "Alerts"), /*#__PURE__*/React.createElement(Badge, {
      tone: "danger",
      dot: true,
      size: "sm"
    }, "3 open"), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement(Tabs, {
      variant: "segmented",
      size: "sm",
      value: filter,
      onChange: setFilter,
      items: [{
        value: 'all',
        label: 'All'
      }, {
        value: 'open',
        label: 'Open'
      }, {
        value: 'resolved',
        label: 'Resolved'
      }]
    }), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost"
    }, "Acknowledge all")), /*#__PURE__*/React.createElement("div", null, rows.map((a, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '13px 14px',
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 'var(--radius-sm)',
        flexShrink: 0,
        background: `var(--${a.sev === 'positive' ? 'up' : a.sev === 'critical' ? 'danger' : a.sev === 'warning' ? 'warning' : 'info'}-soft)`,
        color: `var(--${a.sev === 'positive' ? 'up' : a.sev === 'critical' ? 'danger' : a.sev === 'warning' ? 'warning' : 'info'}-500)`
      }
    }, /*#__PURE__*/React.createElement(Ic, {
      n: icon[a.sev]
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-heading)'
      }
    }, a.t), a.live && /*#__PURE__*/React.createElement(Badge, {
      tone: tone[a.sev],
      size: "sm"
    }, "Open")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginTop: 3
      }
    }, a.d), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--text-tertiary)',
        marginTop: 5
      }
    }, a.src, " \xB7 ", a.time, " ET")), a.live && /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: a.sev === 'critical' ? 'danger' : 'secondary'
    }, "Acknowledge"))))));
  }
  window.AlertsScreen = AlertsScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/AlertsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/AppShell.jsx
try { (() => {
/* AppShell — terminal chrome: icon rail, command bar, content, copilot rail.
   Reads DS primitives from the global namespace; exports to window. */
(function () {
  const A = window.ApertureRiskDesignSystem_6e73e1;
  const {
    IconButton,
    Badge
  } = A;
  const Ic = ({
    n,
    size = 18
  }) => /*#__PURE__*/React.createElement("i", {
    "data-lucide": n,
    style: {
      width: size,
      height: size
    }
  });
  const NAV = [{
    id: 'overview',
    icon: 'layout-dashboard',
    label: 'Overview'
  }, {
    id: 'holdings',
    icon: 'table-2',
    label: 'Holdings'
  }, {
    id: 'balance',
    icon: 'workflow',
    label: 'Balance sheet'
  }, {
    id: 'risk',
    icon: 'activity',
    label: 'Scenarios'
  }, {
    id: 'alerts',
    icon: 'bell',
    label: 'Alerts'
  }];
  function Rail({
    active,
    onNav
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        width: 56,
        flexShrink: 0,
        background: 'var(--gray-1000)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10px 0',
        gap: 4
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/mark.svg",
      width: "30",
      height: "30",
      alt: "Aperture",
      style: {
        marginBottom: 12
      }
    }), NAV.map(n => {
      const on = active === n.id;
      return /*#__PURE__*/React.createElement("button", {
        key: n.id,
        type: "button",
        title: n.label,
        onClick: () => onNav(n.id),
        style: {
          all: 'unset',
          cursor: 'pointer',
          position: 'relative',
          width: 38,
          height: 38,
          borderRadius: 'var(--radius-sm)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: on ? 'var(--accent-text)' : 'var(--text-tertiary)',
          background: on ? 'var(--yellow-soft)' : 'transparent',
          transition: 'color var(--dur-fast), background var(--dur-fast)'
        },
        onMouseEnter: e => {
          if (!on) e.currentTarget.style.color = 'var(--text-primary)';
        },
        onMouseLeave: e => {
          if (!on) e.currentTarget.style.color = 'var(--text-tertiary)';
        }
      }, on && /*#__PURE__*/React.createElement("span", {
        style: {
          position: 'absolute',
          left: -10,
          top: 9,
          bottom: 9,
          width: 2,
          background: 'var(--accent)',
          borderRadius: 1
        }
      }), /*#__PURE__*/React.createElement(Ic, {
        n: n.icon
      }));
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement("button", {
      type: "button",
      title: "Settings",
      style: {
        all: 'unset',
        cursor: 'pointer',
        width: 38,
        height: 38,
        borderRadius: 'var(--radius-sm)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-tertiary)'
      }
    }, /*#__PURE__*/React.createElement(Ic, {
      n: "settings"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 26,
        height: 26,
        borderRadius: 999,
        background: 'var(--surface-2)',
        border: '1px solid var(--border-default)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--text-secondary)',
        marginTop: 4
      }
    }, "RK"));
  }
  const TICKERS = [['SPX', '4,891.20', 1.41], ['NDX', '17,304.6', 0.88], ['VIX', '13.07', -6.12], ['UST 10Y', '4.21%', 0.03], ['WTI', '$78.40', -1.10], ['GOLD', '$2,146', 0.22], ['BTC', '$63,180', 2.04]];
  function CommandBar({
    title,
    subtitle,
    onToggleCopilot,
    copilotOpen
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        height: 48,
        flexShrink: 0,
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--gray-950)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 14px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 168
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text-heading)',
        lineHeight: 1.1,
        letterSpacing: 'var(--tracking-tight)'
      }
    }, title), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10.5,
        color: 'var(--text-tertiary)'
      }
    }, subtitle)), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        gap: 16,
        overflow: 'hidden',
        maskImage: 'linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent)'
      }
    }, TICKERS.map((t, i) => /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--text-tertiary)',
        letterSpacing: '0.04em'
      }
    }, t[0]), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: 'var(--text-primary)'
      }
    }, t[1]), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: t[2] >= 0 ? 'var(--up-500)' : 'var(--down-500)'
      }
    }, t[2] >= 0 ? '+' : '−', Math.abs(t[2]), "%")))), /*#__PURE__*/React.createElement(Badge, {
      tone: "up",
      dot: true,
      size: "sm"
    }, "Markets open"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: 'var(--text-secondary)',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap'
      },
      id: "clock"
    }, "14:32:08 ET"), /*#__PURE__*/React.createElement("button", {
      type: "button",
      onClick: onToggleCopilot,
      style: {
        all: 'unset',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 30,
        padding: '0 11px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${copilotOpen ? 'var(--ai-500)' : 'color-mix(in srgb, var(--ai-500) 30%, var(--border-default))'}`,
        background: copilotOpen ? 'var(--ai-soft)' : 'transparent',
        color: copilotOpen ? 'var(--ai-500)' : 'var(--text-secondary)',
        fontSize: 12,
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("svg", {
      width: "13",
      height: "13",
      viewBox: "0 0 14 14",
      fill: "none"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M7 1.2l1.3 3.1 3.1 1.3-3.1 1.3L7 10l-1.3-3.1L2.6 5.6l3.1-1.3L7 1.2z",
      fill: "currentColor"
    })), "Copilot"));
  }
  function AppShell({
    active,
    onNav,
    title,
    subtitle,
    copilotOpen,
    onToggleCopilot,
    copilot,
    children
  }) {
    React.useEffect(() => {
      window.lucide && window.lucide.createIcons();
    });
    React.useEffect(() => {
      const el = document.getElementById('clock');
      const tick = () => {
        if (!el) return;
        const d = new Date();
        const p = x => String(x).padStart(2, '0');
        el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ET`;
      };
      const id = setInterval(tick, 1000);
      tick();
      return () => clearInterval(id);
    }, []);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg-canvas)'
      }
    }, /*#__PURE__*/React.createElement(Rail, {
      active: active,
      onNav: onNav
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0
      }
    }, /*#__PURE__*/React.createElement(CommandBar, {
      title: title,
      subtitle: subtitle,
      onToggleCopilot: onToggleCopilot,
      copilotOpen: copilotOpen
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflow: 'auto',
        minWidth: 0
      }
    }, children), copilotOpen && /*#__PURE__*/React.createElement("div", {
      style: {
        width: 332,
        flexShrink: 0,
        borderLeft: '1px solid var(--border-subtle)',
        background: 'var(--gray-950)',
        overflow: 'auto'
      }
    }, copilot))));
  }
  window.AppShell = AppShell;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/AppShell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/BalanceSheetScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* BalanceSheetScreen — ValQ-style driver-tree forecast + IBCS scorecards + grid. */
(function () {
  const A = window.ApertureRiskDesignSystem_6e73e1;
  const {
    Panel,
    ScorecardKPI,
    DriverFlow,
    DataGrid,
    Tabs,
    Badge,
    Button,
    IconButton
  } = A;
  const T = window.TERMINAL;
  const Ic = ({
    n
  }) => /*#__PURE__*/React.createElement("i", {
    "data-lucide": n,
    style: {
      width: 15,
      height: 15
    }
  });
  function BalanceSheetScreen() {
    const [view, setView] = React.useState('fc');
    React.useEffect(() => {
      window.lucide && window.lucide.createIcons();
    });
    const cols = [{
      key: 'item',
      label: 'Line item',
      pinned: true,
      width: 150,
      strong: true
    }, {
      key: 'cat',
      label: 'Class',
      muted: true,
      width: 96
    }, {
      key: 'ac',
      label: 'Actual',
      type: 'number',
      agg: 'sum',
      format: v => '$' + v + 'B'
    }, {
      key: 'pl',
      label: 'Plan',
      type: 'number',
      agg: 'sum',
      format: v => '$' + v + 'B'
    }, {
      key: 'fc',
      label: 'FY24E',
      type: 'bar',
      accent: true,
      agg: 'sum',
      format: v => '$' + v + 'B'
    }, {
      key: 'vp',
      label: 'vs plan',
      type: 'variance',
      suffix: '%'
    }];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10
      }
    }, T.bsScorecards.map(k => /*#__PURE__*/React.createElement(ScorecardKPI, _extends({
      key: k.label
    }, k)))), /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "FORECAST",
      title: "Balance-sheet driver tree \xB7 FY24E",
      noPad: true,
      actions: /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          gap: 8,
          alignItems: 'center'
        }
      }, /*#__PURE__*/React.createElement(Tabs, {
        variant: "segmented",
        size: "sm",
        value: view,
        onChange: setView,
        items: [{
          value: 'ac',
          label: 'Actual'
        }, {
          value: 'fc',
          label: 'Forecast'
        }, {
          value: 'var',
          label: 'Variance'
        }]
      }), /*#__PURE__*/React.createElement(IconButton, {
        label: "Fit"
      }, /*#__PURE__*/React.createElement(Ic, {
        n: "maximize-2"
      })))
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 16,
        overflow: 'auto'
      }
    }, /*#__PURE__*/React.createElement(DriverFlow, {
      nodes: T.bsNodes,
      edges: T.bsEdges,
      width: 700,
      height: 448
    }))), /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "LINE ITEMS",
      title: "Balance sheet \xB7 actual vs plan vs forecast",
      noPad: true,
      actions: /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "ghost",
        iconLeft: /*#__PURE__*/React.createElement(Ic, {
          n: "download"
        })
      }, "Export")
    }, /*#__PURE__*/React.createElement(DataGrid, {
      columns: cols,
      rows: T.bsRows,
      rowKey: r => r.item,
      defaultSort: {
        key: 'fc',
        dir: 'desc'
      },
      zebra: true,
      totals: false
    })));
  }
  window.BalanceSheetScreen = BalanceSheetScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/BalanceSheetScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/CopilotRail.jsx
try { (() => {
/* CopilotRail — the embedded AI risk copilot panel. */
(function () {
  const A = window.ApertureRiskDesignSystem_6e73e1;
  const {
    AIInsight,
    AIPromptBar,
    Button,
    Badge
  } = A;
  const T = window.TERMINAL;
  const CANNED = {
    default: "Net exposure is $486.2M (+2.4%). The one open issue is the EM equity limit breach — trimming ~$0.9M of EEM cures it. Want me to stage that order?",
    var: "1-day VaR rose to $12.4M (2.6% of NAV), driven mainly by the NVDA position as tech vol ticked up. It's still inside the 3.5% cap.",
    stress: "Under a +50bps rate shock, modeled P&L is −$8.4M and VaR rises ~12%. Financials cushion the hit; rate-sensitive growth names lead the drawdown.",
    factor: "Largest factor exposures: Momentum (+1.8σ), Growth (+1.1σ), and Size (−0.6σ). Momentum is your dominant risk contributor right now."
  };
  const pick = q => {
    const s = q.toLowerCase();
    if (s.includes('var')) return CANNED.var;
    if (s.includes('stress') || s.includes('shock') || s.includes('bps')) return CANNED.stress;
    if (s.includes('factor') || s.includes('exposure')) return CANNED.factor;
    return CANNED.default;
  };
  function CopilotRail() {
    const [thread, setThread] = React.useState([]);
    const [busy, setBusy] = React.useState(false);
    const endRef = React.useRef(null);
    const ask = q => {
      setThread(t => [...t, {
        role: 'user',
        text: q
      }]);
      setBusy(true);
      setTimeout(() => {
        setThread(t => [...t, {
          role: 'ai',
          text: pick(q)
        }]);
        setBusy(false);
      }, 650);
    };
    React.useEffect(() => {
      endRef.current && endRef.current.scrollIntoView({
        block: 'end'
      });
    }, [thread, busy]);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 14px',
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        width: 22,
        height: 22,
        borderRadius: 2,
        background: 'var(--ai-soft)',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("svg", {
      width: "13",
      height: "13",
      viewBox: "0 0 14 14",
      fill: "none"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M7 1.2l1.3 3.1 3.1 1.3-3.1 1.3L7 10l-1.3-3.1L2.6 5.6l3.1-1.3L7 1.2z",
      fill: "var(--ai-500)"
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--text-heading)'
      }
    }, "Risk copilot"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: 'var(--text-tertiary)'
      }
    }, "Monitoring 248 positions \xB7 live")), /*#__PURE__*/React.createElement(Badge, {
      tone: "ai",
      size: "sm",
      dot: true
    }, "Active")), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflow: 'auto',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)'
      }
    }, "Live insights"), T.insights.map((ins, i) => /*#__PURE__*/React.createElement(AIInsight, {
      key: i,
      title: ins.title,
      severity: ins.severity,
      confidence: ins.confidence,
      sources: ins.sources,
      compact: true,
      actions: ins.severity === 'critical' ? /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "danger"
      }, "Stage trim") : null
    }, ins.body)), thread.length > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        height: 1,
        background: 'var(--border-subtle)',
        margin: '4px 0'
      }
    }), thread.map((m, i) => m.role === 'user' ? /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        alignSelf: 'flex-end',
        maxWidth: '85%',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 11px',
        fontSize: 12.5,
        color: 'var(--text-primary)'
      }
    }, m.text) : /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        alignSelf: 'flex-start',
        maxWidth: '92%',
        display: 'flex',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flexShrink: 0,
        marginTop: 2,
        display: 'inline-flex',
        width: 18,
        height: 18,
        borderRadius: 2,
        background: 'var(--ai-soft)',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("svg", {
      width: "10",
      height: "10",
      viewBox: "0 0 14 14",
      fill: "none"
    }, /*#__PURE__*/React.createElement("path", {
      d: "M7 1.2l1.3 3.1 3.1 1.3-3.1 1.3L7 10l-1.3-3.1L2.6 5.6l3.1-1.3L7 1.2z",
      fill: "var(--ai-500)"
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12.5,
        lineHeight: 1.5,
        color: 'var(--text-secondary)'
      }
    }, m.text))), busy && /*#__PURE__*/React.createElement("div", {
      style: {
        alignSelf: 'flex-start',
        fontSize: 12,
        color: 'var(--ai-500)',
        paddingLeft: 26
      }
    }, "Analyzing\u2026"), /*#__PURE__*/React.createElement("div", {
      ref: endRef
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 12,
        borderTop: '1px solid var(--border-subtle)'
      }
    }, /*#__PURE__*/React.createElement(AIPromptBar, {
      busy: busy,
      onSubmit: ask,
      suggestions: ['Why is VaR up?', 'Stress +50bps', 'Top factor exposures']
    })));
  }
  window.CopilotRail = CopilotRail;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/CopilotRail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/HoldingsScreen.jsx
try { (() => {
/* HoldingsScreen — full positions table with toolbar + detail. */
(function () {
  const A = window.ApertureRiskDesignSystem_6e73e1;
  const {
    Panel,
    DataTable,
    Input,
    Select,
    Button,
    Badge,
    Sparkline,
    Tabs,
    IconButton
  } = A;
  const T = window.TERMINAL;
  const Ic = ({
    n
  }) => /*#__PURE__*/React.createElement("i", {
    "data-lucide": n,
    style: {
      width: 15,
      height: 15
    }
  });
  function HoldingsScreen() {
    const [q, setQ] = React.useState('');
    const [side, setSide] = React.useState('all');
    const [sel, setSel] = React.useState('NVDA');
    React.useEffect(() => {
      window.lucide && window.lucide.createIcons();
    });
    let rows = T.positions;
    if (side !== 'all') rows = rows.filter(p => p.side === (side === 'long' ? 'L' : 'S'));
    if (q) rows = rows.filter(p => (p.t + ' ' + p.n).toLowerCase().includes(q.toLowerCase()));
    const cols = [{
      key: 't',
      label: 'Ticker',
      strong: true,
      width: 70
    }, {
      key: 'n',
      label: 'Name',
      muted: true
    }, {
      key: 'side',
      label: 'Side',
      render: v => /*#__PURE__*/React.createElement(Badge, {
        tone: v === 'L' ? 'up' : 'down',
        size: "sm"
      }, v === 'L' ? 'Long' : 'Short')
    }, {
      key: 'qty',
      label: 'Quantity',
      numeric: true
    }, {
      key: 'px',
      label: 'Price',
      numeric: true,
      render: v => '$' + v
    }, {
      key: 'mv',
      label: 'Mkt value',
      numeric: true,
      strong: true,
      render: v => (v < 0 ? '−$' : '$') + Math.abs(v) + 'M'
    }, {
      key: 'w',
      label: 'Weight',
      numeric: true,
      render: v => v + '%'
    }, {
      key: 'd',
      label: 'Day P&L',
      numeric: true,
      render: v => /*#__PURE__*/React.createElement("span", {
        style: {
          color: v >= 0 ? 'var(--up-500)' : 'var(--down-500)',
          fontWeight: 600
        }
      }, v >= 0 ? '+' : '−', Math.abs(v), "%")
    }, {
      key: 'var',
      label: 'VaR',
      numeric: true,
      render: v => '$' + v + 'M'
    }, {
      key: 'spark',
      label: '30D',
      render: v => /*#__PURE__*/React.createElement(Sparkline, {
        data: v,
        width: 62,
        height: 20
      })
    }];
    const detail = T.positions.find(p => p.t === sel) || T.positions[0];
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        height: '100%'
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      noPad: true,
      style: {
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column'
      },
      bodyStyle: {
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '11px 14px',
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        color: 'var(--text-heading)'
      }
    }, "Holdings"), /*#__PURE__*/React.createElement(Badge, {
      tone: "neutral",
      size: "sm"
    }, rows.length, " of ", T.positions.length), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement(Input, {
      iconLeft: /*#__PURE__*/React.createElement(Ic, {
        n: "search"
      }),
      placeholder: "Filter\u2026",
      value: q,
      onChange: e => setQ(e.target.value),
      size: "sm"
    }), /*#__PURE__*/React.createElement(Tabs, {
      variant: "segmented",
      size: "sm",
      value: side,
      onChange: setSide,
      items: [{
        value: 'all',
        label: 'All'
      }, {
        value: 'long',
        label: 'Long'
      }, {
        value: 'short',
        label: 'Short'
      }]
    }), /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      options: [{
        value: 'mv',
        label: 'Sort: Mkt value'
      }, {
        value: 'd',
        label: 'Sort: Day P&L'
      }, {
        value: 'var',
        label: 'Sort: VaR'
      }]
    }), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      iconLeft: /*#__PURE__*/React.createElement(Ic, {
        n: "plus"
      })
    }, "Add")), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        overflow: 'auto',
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement(DataTable, {
      columns: cols,
      rows: rows,
      rowKey: r => r.t,
      selectedKey: sel,
      onRowClick: r => setSel(r.t)
    }))), /*#__PURE__*/React.createElement(Panel, {
      style: {
        flexShrink: 0
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 20
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        minWidth: 150
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 18,
        fontWeight: 700,
        color: 'var(--text-heading)'
      }
    }, detail.t), /*#__PURE__*/React.createElement(Badge, {
      tone: detail.side === 'L' ? 'up' : 'down',
      size: "sm"
    }, detail.side === 'L' ? 'Long' : 'Short')), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--text-tertiary)'
      }
    }, detail.n, " \xB7 ", detail.sec)), [['Mkt value', (detail.mv < 0 ? '−$' : '$') + Math.abs(detail.mv) + 'M'], ['Weight', detail.w + '%'], ['Day P&L', (detail.d >= 0 ? '+' : '−') + Math.abs(detail.d) + '%', detail.d >= 0], ['1d VaR', '$' + detail.var + 'M'], ['Beta', detail.beta]].map((m, i) => /*#__PURE__*/React.createElement("div", {
      key: i
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)'
      }
    }, m[0]), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 16,
        fontWeight: 600,
        color: m.length > 2 ? m[2] ? 'var(--up-500)' : 'var(--down-500)' : 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, m[1]))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement(Sparkline, {
      data: detail.spark,
      width: 140,
      height: 40
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm",
      iconRight: /*#__PURE__*/React.createElement(Ic, {
        n: "arrow-up-right"
      })
    }, "Open"))));
  }
  window.HoldingsScreen = HoldingsScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/HoldingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/OverviewScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* OverviewScreen — the portfolio risk dashboard landing view. */
(function () {
  const A = window.ApertureRiskDesignSystem_6e73e1;
  const {
    Panel,
    StatTile,
    Tabs,
    LimitBar,
    DonutGauge,
    Badge,
    IconButton,
    LineChart
  } = A;
  const T = window.TERMINAL;
  const Ic = ({
    n
  }) => /*#__PURE__*/React.createElement("i", {
    "data-lucide": n,
    style: {
      width: 15,
      height: 15
    }
  });
  const dateLabels = (n, step) => {
    const out = [];
    const today = new Date('2026-06-13');
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * step);
      out.push(d.getMonth() + 1 + '/' + d.getDate());
    }
    return out;
  };
  function OverviewScreen() {
    const [range, setRange] = React.useState('1m');
    React.useEffect(() => {
      window.lucide && window.lucide.createIcons();
    });
    const ranges = [{
      value: '1w',
      label: '1W'
    }, {
      value: '1m',
      label: '1M'
    }, {
      value: 'ytd',
      label: 'YTD'
    }, {
      value: '1y',
      label: '1Y'
    }];
    const navSlice = {
      '1w': T.navSeries.slice(-10),
      '1m': T.navSeries.slice(-30),
      'ytd': T.navSeries.slice(-60),
      '1y': T.navSeries
    }[range];
    const stepBy = {
      '1w': 1,
      '1m': 3,
      'ytd': 12,
      '1y': 18
    }[range];
    const navPlan = navSlice.map((v, i) => v * (0.985 + 0.0006 * i));
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 10
      }
    }, T.kpis.map(k => /*#__PURE__*/React.createElement(StatTile, _extends({
      key: k.id
    }, k)))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1.55fr 1fr',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "PERFORMANCE",
      title: "Net asset value",
      noPad: true,
      actions: /*#__PURE__*/React.createElement(Tabs, {
        variant: "segmented",
        size: "sm",
        value: range,
        onChange: setRange,
        items: ranges
      })
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '14px 14px 10px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 30,
        fontWeight: 600,
        letterSpacing: 'var(--tracking-display)',
        color: 'var(--text-heading)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, "$486.24M"), /*#__PURE__*/React.createElement(Badge, {
      tone: "up",
      dot: true
    }, "+$11.4M (", range.toUpperCase(), ")"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: 'var(--text-tertiary)'
      }
    }, "+2.41%")), /*#__PURE__*/React.createElement(LineChart, {
      data: navSlice,
      overlay: navPlan,
      overlayLabel: "Plan",
      labels: dateLabels(navSlice.length, stepBy),
      height: 188,
      yFormat: v => '$' + Math.round(v) + 'M'
    }))), /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "EXPOSURE",
      title: "By sector",
      actions: /*#__PURE__*/React.createElement(IconButton, {
        label: "Expand"
      }, /*#__PURE__*/React.createElement(Ic, {
        n: "maximize-2"
      }))
    }, /*#__PURE__*/React.createElement(window.ExposureBars, {
      items: T.exposures
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 0.8fr',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "RISK LIMITS",
      title: "Utilization",
      accent: true,
      actions: /*#__PURE__*/React.createElement(Badge, {
        tone: "danger",
        dot: true,
        size: "sm"
      }, "1 breach")
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 13
      }
    }, T.limits.map(l => /*#__PURE__*/React.createElement(LimitBar, {
      key: l.k,
      label: l.k,
      value: l.value,
      max: l.max,
      display: l.display,
      warn: l.state === 'breach' ? 0 : 0.8
    })))), /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "MOVERS",
      title: "Top contributors"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }
    }, T.positions.slice(0, 6).map(p => /*#__PURE__*/React.createElement("div", {
      key: p.t,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        borderBottom: '1px solid var(--border-subtle)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-primary)',
        width: 48
      }
    }, p.t), /*#__PURE__*/React.createElement(Badge, {
      tone: p.side === 'L' ? 'up' : 'down',
      size: "sm"
    }, p.side === 'L' ? 'Long' : 'Short'), /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        fontSize: 11,
        color: 'var(--text-tertiary)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }
    }, p.sec), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: p.d >= 0 ? 'var(--up-500)' : 'var(--down-500)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, p.d >= 0 ? '+' : '−', Math.abs(p.d), "%"))))), /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "RISK SCORE",
      title: "Composite",
      style: {
        alignItems: 'center'
      },
      bodyStyle: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement(DonutGauge, {
      value: 72,
      size: 108,
      label: "Aggregate"
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: 'var(--text-tertiary)',
        letterSpacing: '0.06em'
      }
    }, "VOL"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, "9.4%")), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        color: 'var(--text-tertiary)',
        letterSpacing: '0.06em'
      }
    }, "MAX DD"), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 600,
        color: 'var(--down-500)',
        fontVariantNumeric: 'tabular-nums'
      }
    }, "\u22126.1%"))))));
  }
  window.OverviewScreen = OverviewScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/OverviewScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/ScenarioScreen.jsx
try { (() => {
/* ScenarioScreen — stress testing & scenario analysis. */
(function () {
  const A = window.ApertureRiskDesignSystem_6e73e1;
  const {
    Panel,
    Button,
    Badge,
    DonutGauge,
    AIInsight,
    IconButton
  } = A;
  const T = window.TERMINAL;
  const Ic = ({
    n
  }) => /*#__PURE__*/React.createElement("i", {
    "data-lucide": n,
    style: {
      width: 15,
      height: 15
    }
  });
  function ScenarioScreen() {
    const [sel, setSel] = React.useState(0);
    const [running, setRunning] = React.useState(false);
    const [ran, setRan] = React.useState(true);
    React.useEffect(() => {
      window.lucide && window.lucide.createIcons();
    });
    const run = () => {
      setRunning(true);
      setRan(false);
      setTimeout(() => {
        setRunning(false);
        setRan(true);
      }, 900);
    };
    const sc = T.scenarios[sel];
    const maxAbs = Math.max(...T.scenarios.map(s => Math.abs(s.pnl)));
    const contrib = [{
      k: 'Info Tech',
      v: sc.pnl * 0.42
    }, {
      k: 'Financials',
      v: sc.pnl * 0.18
    }, {
      k: 'Energy',
      v: sc.pnl * -0.12
    }, {
      k: 'Health Care',
      v: sc.pnl * 0.21
    }, {
      k: 'Hedges',
      v: sc.pnl * -0.29
    }, {
      k: 'Credit',
      v: sc.pnl * 0.14
    }];
    const cMax = Math.max(...contrib.map(c => Math.abs(c.v)));
    return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 14,
        display: 'grid',
        gridTemplateColumns: '380px 1fr',
        gap: 12,
        height: '100%'
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "LIBRARY",
      title: "Scenarios",
      noPad: true,
      actions: /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "ghost",
        iconLeft: /*#__PURE__*/React.createElement(Ic, {
          n: "plus"
        })
      }, "New")
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column'
      }
    }, T.scenarios.map((s, i) => {
      const on = i === sel;
      const neg = s.pnl < 0;
      return /*#__PURE__*/React.createElement("button", {
        key: s.k,
        type: "button",
        onClick: () => {
          setSel(i);
          setRan(true);
        },
        style: {
          all: 'unset',
          cursor: 'pointer',
          padding: '11px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          background: on ? 'var(--yellow-softer)' : 'transparent',
          boxShadow: on ? 'inset 2px 0 0 var(--accent)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 7
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12.5,
          fontWeight: 600,
          color: 'var(--text-primary)',
          flex: 1
        }
      }, s.k), /*#__PURE__*/React.createElement(Badge, {
        tone: s.prob === 'Tail' ? 'danger' : s.prob === 'High' ? 'warning' : 'neutral',
        size: "sm"
      }, s.prob)), /*#__PURE__*/React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          flex: 1,
          height: 5,
          background: 'var(--gray-800)',
          borderRadius: 1,
          position: 'relative',
          overflow: 'hidden'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          [neg ? 'right' : 'left']: '50%',
          width: `${Math.abs(s.pnl) / maxAbs * 50}%`,
          background: neg ? 'var(--down-500)' : 'var(--up-500)',
          borderRadius: 1
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'absolute',
          left: '50%',
          top: -1,
          bottom: -1,
          width: 1,
          background: 'var(--border-default)'
        }
      })), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          fontWeight: 600,
          width: 58,
          textAlign: 'right',
          color: neg ? 'var(--down-500)' : 'var(--up-500)',
          fontVariantNumeric: 'tabular-nums'
        }
      }, neg ? '−$' : '+$', Math.abs(s.pnl), "M")));
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minHeight: 0
      }
    }, /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "SCENARIO",
      title: sc.k,
      actions: /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "primary",
        loading: running,
        iconLeft: !running ? /*#__PURE__*/React.createElement(Ic, {
          n: "play"
        }) : null,
        onClick: run
      }, running ? 'Running' : 'Run stress test')
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 24,
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 3
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)'
      }
    }, "Modeled P&L"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 34,
        fontWeight: 600,
        letterSpacing: 'var(--tracking-display)',
        color: sc.pnl < 0 ? 'var(--down-500)' : 'var(--up-500)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1
      }
    }, sc.pnl < 0 ? '−$' : '+$', Math.abs(sc.pnl), "M"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--text-tertiary)'
      }
    }, (sc.pnl / 486.2 * 100).toFixed(1), "% of NAV")), /*#__PURE__*/React.createElement("div", {
      style: {
        width: 1,
        alignSelf: 'stretch',
        background: 'var(--border-subtle)'
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 3
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-tertiary)'
      }
    }, "VaR impact"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 34,
        fontWeight: 600,
        color: 'var(--warning-500)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1
      }
    }, sc.var), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--text-tertiary)'
      }
    }, "1-day, 95%")), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement(DonutGauge, {
      value: Math.min(Math.abs(sc.pnl) / 70 * 100, 100),
      threshold: true,
      center: sc.prob,
      size: 94,
      label: "Severity"
    }))), /*#__PURE__*/React.createElement(Panel, {
      eyebrow: "ATTRIBUTION",
      title: "P&L by sector",
      style: {
        flex: 1,
        minHeight: 0
      },
      bodyStyle: {
        position: 'relative'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 11,
        opacity: running ? 0.4 : 1,
        transition: 'opacity var(--dur-base)'
      }
    }, contrib.map(c => {
      const neg = c.v < 0;
      return /*#__PURE__*/React.createElement("div", {
        key: c.k,
        style: {
          display: 'grid',
          gridTemplateColumns: '120px 1fr 70px',
          alignItems: 'center',
          gap: 12
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          color: 'var(--text-secondary)'
        }
      }, c.k), /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'relative',
          height: 16
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'absolute',
          left: '50%',
          top: -2,
          bottom: -2,
          width: 1,
          background: 'var(--border-default)'
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'absolute',
          top: 2,
          bottom: 2,
          [neg ? 'right' : 'left']: '50%',
          width: `${Math.abs(c.v) / cMax * 48}%`,
          background: neg ? 'var(--down-500)' : 'var(--up-500)',
          borderRadius: 2
        }
      })), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          fontWeight: 600,
          textAlign: 'right',
          color: neg ? 'var(--down-500)' : 'var(--up-500)',
          fontVariantNumeric: 'tabular-nums'
        }
      }, neg ? '−$' : '+$', Math.abs(c.v).toFixed(1), "M"));
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14
      }
    }, /*#__PURE__*/React.createElement(AIInsight, {
      title: "Copilot read on this scenario",
      severity: sc.pnl < -30 ? 'critical' : 'warning',
      confidence: 82,
      compact: true,
      sources: ['Factor model', 'Scenario engine']
    }, sc.k, " drives a ", sc.pnl < 0 ? 'drawdown' : 'gain', " of $", Math.abs(sc.pnl), "M, concentrated in Info Tech. Your TSLA short and credit hedges absorb ~29% of the move. Consider adding rate convexity if probability rises.")))));
  }
  window.ScenarioScreen = ScenarioScreen;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/ScenarioScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/charts.jsx
try { (() => {
/* Shared chart primitives for the terminal screens (area chart + bars). */
(function () {
  function AreaChart({
    data,
    width = 640,
    height = 180,
    color = 'var(--accent)',
    pad = 8,
    axis = true
  }) {
    const min = Math.min(...data),
      max = Math.max(...data);
    const span = max - min || 1;
    const w = width,
      h = height;
    const innerH = h - pad * 2 - (axis ? 16 : 0);
    const stepX = (w - pad * 2) / (data.length - 1);
    const pts = data.map((v, i) => [pad + i * stepX, pad + (1 - (v - min) / span) * innerH]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${pad + innerH} L${pts[0][0].toFixed(1)} ${pad + innerH} Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(g => pad + g * innerH);
    const uid = 'ac' + Math.round(min * 100) + data.length;
    return /*#__PURE__*/React.createElement("svg", {
      width: "100%",
      viewBox: `0 0 ${w} ${h}`,
      preserveAspectRatio: "none",
      style: {
        display: 'block'
      }
    }, /*#__PURE__*/React.createElement("defs", null, /*#__PURE__*/React.createElement("linearGradient", {
      id: uid,
      x1: "0",
      y1: "0",
      x2: "0",
      y2: "1"
    }, /*#__PURE__*/React.createElement("stop", {
      offset: "0%",
      stopColor: color,
      stopOpacity: "0.20"
    }), /*#__PURE__*/React.createElement("stop", {
      offset: "100%",
      stopColor: color,
      stopOpacity: "0"
    }))), grid.map((y, i) => /*#__PURE__*/React.createElement("line", {
      key: i,
      x1: pad,
      y1: y,
      x2: w - pad,
      y2: y,
      stroke: "var(--border-subtle)",
      strokeWidth: "1",
      strokeDasharray: i === 4 ? '0' : '2 3'
    })), /*#__PURE__*/React.createElement("path", {
      d: area,
      fill: `url(#${uid})`
    }), /*#__PURE__*/React.createElement("path", {
      d: line,
      fill: "none",
      stroke: color,
      strokeWidth: "1.75",
      strokeLinejoin: "round",
      strokeLinecap: "round"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: pts[pts.length - 1][0],
      cy: pts[pts.length - 1][1],
      r: "3",
      fill: color
    }));
  }

  /* Horizontal diverging bar list for exposures (long/short). */
  function ExposureBars({
    items
  }) {
    const maxAbs = Math.max(...items.map(i => Math.abs(i.v)));
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 9
      }
    }, items.map(it => {
      const pos = it.v >= 0;
      const pct = Math.abs(it.v) / maxAbs * 100;
      return /*#__PURE__*/React.createElement("div", {
        key: it.k,
        style: {
          display: 'grid',
          gridTemplateColumns: '108px 1fr 52px',
          alignItems: 'center',
          gap: 10
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11.5,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }
      }, it.k), /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'relative',
          height: 14,
          display: 'flex',
          justifyContent: pos ? 'flex-start' : 'flex-end'
        }
      }, /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'absolute',
          left: '50%',
          top: -1,
          bottom: -1,
          width: 1,
          background: 'var(--border-default)'
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          position: 'absolute',
          [pos ? 'left' : 'right']: '50%',
          top: 2,
          bottom: 2,
          width: `${pct / 2}%`,
          background: pos ? 'var(--accent)' : 'var(--gray-500)',
          borderRadius: 2
        }
      })), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11.5,
          fontWeight: 600,
          textAlign: 'right',
          color: pos ? 'var(--text-primary)' : 'var(--text-tertiary)',
          fontVariantNumeric: 'tabular-nums'
        }
      }, pos ? '' : '−', Math.abs(it.v), "%"));
    }));
  }
  window.AreaChart = AreaChart;
  window.ExposureBars = ExposureBars;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/charts.jsx", error: String((e && e.message) || e) }); }

// ui_kits/risk-terminal/terminal-data.js
try { (() => {
/* Aperture Risk Terminal — synthetic data for the UI kit.
   Plain globals (no modules) so Babel screen scripts can read them. */
window.TERMINAL = function () {
  const rnd = seed => {
    let s = seed;
    return () => {
      s = s * 1103515245 + 12345 & 0x7fffffff;
      return s / 0x7fffffff;
    };
  };
  const series = (seed, n, start, drift, vol) => {
    const r = rnd(seed);
    const out = [];
    let v = start;
    for (let i = 0; i < n; i++) {
      v = Math.max(1, v + drift + (r() - 0.5) * vol);
      out.push(+v.toFixed(2));
    }
    return out;
  };
  const kpis = [{
    id: 'exp',
    label: 'NET EXPOSURE',
    value: '$486.2M',
    delta: '+2.41%',
    sub: 'vs prior close',
    spark: series(7, 24, 470, 0.6, 6),
    accent: true
  }, {
    id: 'var',
    label: 'VAR (95%) · 1D',
    value: '$12.4M',
    delta: '+4.10%',
    deltaDir: 'down',
    sub: '2.6% of NAV',
    spark: series(13, 24, 10, 0.1, 0.6),
    sparkColor: 'var(--warning-500)'
  }, {
    id: 'pnl',
    label: 'INTRADAY P&L',
    value: '+$3.18M',
    delta: '+0.66%',
    sub: 'realized $1.2M',
    spark: series(21, 24, 0, 0.12, 0.5)
  }, {
    id: 'sharpe',
    label: 'SHARPE · YTD',
    value: '1.84',
    delta: '+0.12',
    sub: 'vol 9.4%',
    spark: series(33, 24, 1.4, 0.02, 0.1)
  }, {
    id: 'beta',
    label: 'BETA (SPX)',
    value: '0.92',
    delta: '−0.03',
    sub: 'net of hedges',
    spark: series(41, 24, 1, 0, 0.05)
  }];
  const positions = [{
    t: 'NVDA',
    n: 'NVIDIA Corp',
    sec: 'Info Tech',
    side: 'L',
    qty: '52,400',
    px: '920.16',
    mv: 48.2,
    w: 9.9,
    d: 2.41,
    var: 2.1,
    beta: 1.62,
    spark: series(101, 16, 30, 0.6, 2)
  }, {
    t: 'MSFT',
    n: 'Microsoft Corp',
    sec: 'Info Tech',
    side: 'L',
    qty: '98,200',
    px: '424.80',
    mv: 41.7,
    w: 8.6,
    d: 0.88,
    var: 1.4,
    beta: 0.94,
    spark: series(102, 16, 40, 0.2, 1.4)
  }, {
    t: 'XOM',
    n: 'Exxon Mobil',
    sec: 'Energy',
    side: 'L',
    qty: '186,500',
    px: '177.50',
    mv: 33.1,
    w: 6.8,
    d: -1.32,
    var: 1.7,
    beta: 0.71,
    spark: series(103, 16, 35, -0.2, 1.6)
  }, {
    t: 'JPM',
    n: 'JPMorgan Chase',
    sec: 'Financials',
    side: 'L',
    qty: '142,000',
    px: '207.04',
    mv: 29.4,
    w: 6.0,
    d: 0.42,
    var: 1.2,
    beta: 1.08,
    spark: series(104, 16, 28, 0.1, 1.2)
  }, {
    t: 'UNH',
    n: 'UnitedHealth',
    sec: 'Health Care',
    side: 'L',
    qty: '41,800',
    px: '486.20',
    mv: 20.3,
    w: 4.2,
    d: -0.61,
    var: 1.0,
    beta: 0.66,
    spark: series(105, 16, 22, -0.05, 1)
  }, {
    t: 'TSLA',
    n: 'Tesla Inc',
    sec: 'Consumer Disc',
    side: 'S',
    qty: '-58,000',
    px: '248.10',
    mv: -14.4,
    w: -3.0,
    d: 3.18,
    var: 2.4,
    beta: 1.94,
    spark: series(106, 16, 18, 0.4, 2.2)
  }, {
    t: 'META',
    n: 'Meta Platforms',
    sec: 'Comm Svcs',
    side: 'L',
    qty: '36,500',
    px: '498.30',
    mv: 18.2,
    w: 3.7,
    d: 1.04,
    var: 1.5,
    beta: 1.31,
    spark: series(107, 16, 16, 0.3, 1.5)
  }, {
    t: 'GLD',
    n: 'SPDR Gold Shares',
    sec: 'Commodity',
    side: 'L',
    qty: '64,000',
    px: '214.60',
    mv: 13.7,
    w: 2.8,
    d: 0.22,
    var: 0.6,
    beta: 0.04,
    spark: series(108, 16, 14, 0.05, 0.6)
  }, {
    t: 'HYG',
    n: 'iShares HY Corp',
    sec: 'Credit',
    side: 'S',
    qty: '-92,000',
    px: '77.40',
    mv: -7.1,
    w: -1.5,
    d: -0.18,
    var: 0.5,
    beta: 0.22,
    spark: series(109, 16, 9, -0.02, 0.5)
  }, {
    t: 'EEM',
    n: 'iShares MSCI EM',
    sec: 'EM Equity',
    side: 'L',
    qty: '210,000',
    px: '43.20',
    mv: 9.1,
    w: 1.9,
    d: -0.94,
    var: 1.3,
    beta: 0.88,
    spark: series(110, 16, 11, -0.1, 1.1)
  }];
  const exposures = [{
    k: 'Info Tech',
    v: 27.1,
    dir: 'up'
  }, {
    k: 'Financials',
    v: 14.8,
    dir: 'up'
  }, {
    k: 'Energy',
    v: 11.2,
    dir: 'down'
  }, {
    k: 'Health Care',
    v: 9.6,
    dir: 'up'
  }, {
    k: 'Comm Svcs',
    v: 8.1,
    dir: 'up'
  }, {
    k: 'Consumer Disc',
    v: -6.4,
    dir: 'up'
  }, {
    k: 'Commodity',
    v: 5.7,
    dir: 'flat'
  }, {
    k: 'EM Equity',
    v: 4.2,
    dir: 'down'
  }];
  const limits = [{
    k: 'EM equity exposure',
    value: 104,
    max: 100,
    display: '4.2% / 4.0% cap',
    state: 'breach'
  }, {
    k: 'Single-name concentration',
    value: 9.9,
    max: 12,
    display: '9.9% / 12%'
  }, {
    k: 'Gross leverage',
    value: 2.1,
    max: 3,
    display: '2.1× / 3.0×'
  }, {
    k: 'Sector — Info Tech',
    value: 27.1,
    max: 30,
    display: '27.1% / 30%'
  }, {
    k: '1-day VaR (% NAV)',
    value: 2.6,
    max: 3.5,
    display: '2.6% / 3.5%'
  }];
  const navSeries = series(55, 90, 440, 0.55, 4);
  const scenarios = [{
    k: 'Rates +50bps',
    pnl: -8.4,
    var: '+12%',
    prob: 'Medium'
  }, {
    k: 'SPX −10% shock',
    pnl: -41.2,
    var: '+58%',
    prob: 'Low'
  }, {
    k: 'Oil +20%',
    pnl: +6.1,
    var: '+4%',
    prob: 'Medium'
  }, {
    k: 'Credit spreads +100bps',
    pnl: -12.7,
    var: '+19%',
    prob: 'Medium'
  }, {
    k: 'USD +5% (DXY)',
    pnl: -3.3,
    var: '+6%',
    prob: 'High'
  }, {
    k: '2020-03 COVID replay',
    pnl: -68.9,
    var: '+121%',
    prob: 'Tail'
  }];
  const insights = [{
    title: 'Concentration risk rising',
    severity: 'warning',
    confidence: 86,
    body: 'Top 5 positions now drive 41% of gross exposure, up from 33% a week ago. NVDA + MSFT contribute 71% of tech factor risk.',
    sources: ['Holdings', 'Barra factor model']
  }, {
    title: 'EM equity limit breached',
    severity: 'critical',
    confidence: 99,
    body: 'EEM long lifts EM exposure to 4.2%, over the 4.0% mandate cap. Trim ~$0.9M notional to cure.',
    sources: ['Limit engine']
  }, {
    title: 'Hedge efficiency improved',
    severity: 'positive',
    confidence: 78,
    body: 'TSLA short is offsetting 0.18 of portfolio beta. Net beta to SPX held at 0.92 through the tech rally.',
    sources: ['Risk model']
  }];
  const bsScorecards = [{
    label: 'NET INTEREST INCOME',
    value: '$48.2M',
    period: 'vs plan',
    deltaPct: 4.2,
    deltaAbs: '+$1.9M',
    trend: [{
      label: 'Q1',
      value: 44,
      type: 'actual'
    }, {
      label: 'Q2',
      value: 46,
      type: 'actual'
    }, {
      label: 'Q3',
      value: 48,
      type: 'actual'
    }, {
      label: 'Q4',
      value: 51,
      type: 'forecast'
    }],
    accent: true
  }, {
    label: 'CET1 RATIO',
    value: '12.8',
    unit: '%',
    period: 'vs PY',
    deltaPct: 0.4,
    deltaAbs: '+40bps',
    trend: [{
      label: 'Q1',
      value: 12.1,
      type: 'actual'
    }, {
      label: 'Q2',
      value: 12.5,
      type: 'actual'
    }, {
      label: 'Q3',
      value: 12.8,
      type: 'actual'
    }, {
      label: 'Q4',
      value: 13.1,
      type: 'plan'
    }]
  }, {
    label: 'COST / INCOME',
    value: '51.4',
    unit: '%',
    period: 'vs plan',
    deltaPct: 2.1,
    deltaAbs: '+1.1pp',
    invert: true,
    trend: [{
      label: 'Q1',
      value: 49,
      type: 'actual'
    }, {
      label: 'Q2',
      value: 50,
      type: 'actual'
    }, {
      label: 'Q3',
      value: 51,
      type: 'actual'
    }, {
      label: 'Q4',
      value: 52,
      type: 'forecast'
    }]
  }, {
    label: 'LIQUIDITY (LCR)',
    value: '134',
    unit: '%',
    period: 'vs limit',
    deltaPct: 1.6,
    deltaAbs: '+2pp',
    trend: [{
      label: 'Q1',
      value: 128,
      type: 'actual'
    }, {
      label: 'Q2',
      value: 131,
      type: 'actual'
    }, {
      label: 'Q3',
      value: 134,
      type: 'actual'
    }, {
      label: 'Q4',
      value: 132,
      type: 'plan'
    }]
  }];
  const bsNodes = [{
    id: 'loans',
    x: 0,
    y: 4,
    w: 148,
    h: 74,
    label: 'Loans',
    value: '$312B',
    delta: 3.1,
    sub: 'Net of provisions',
    spark: series(201, 12, 290, 2, 6),
    breakdown: [{
      k: 'Mortgage',
      v: '$181B'
    }, {
      k: 'Corporate',
      v: '$96B'
    }, {
      k: 'Consumer',
      v: '$35B'
    }],
    note: '+$9B vs plan on mortgage origination.'
  }, {
    id: 'secs',
    x: 0,
    y: 90,
    w: 148,
    h: 74,
    label: 'Securities',
    value: '$148B',
    delta: -1.2,
    sub: 'AFS + HTM',
    spark: series(202, 12, 156, -1, 5),
    breakdown: [{
      k: 'Govt',
      v: '$92B'
    }, {
      k: 'Agency MBS',
      v: '$41B'
    }, {
      k: 'Corporate',
      v: '$15B'
    }],
    note: 'Down on AFS mark-to-market.'
  }, {
    id: 'cash',
    x: 0,
    y: 176,
    w: 148,
    h: 74,
    label: 'Cash & reserves',
    value: '$26B',
    delta: 0.5,
    sub: 'At central bank',
    spark: series(203, 12, 24, 0.3, 2)
  }, {
    id: 'deposits',
    x: 0,
    y: 276,
    w: 148,
    h: 74,
    label: 'Deposits',
    value: '$360B',
    delta: 1.8,
    sub: 'Funding base',
    spark: series(204, 12, 344, 2, 5),
    breakdown: [{
      k: 'Retail',
      v: '$214B'
    }, {
      k: 'Commercial',
      v: '$118B'
    }, {
      k: 'Time',
      v: '$28B'
    }],
    note: 'Stable; retail mix improving.'
  }, {
    id: 'borrow',
    x: 0,
    y: 362,
    w: 148,
    h: 74,
    label: 'Borrowings',
    value: '$84B',
    delta: 4.2,
    invert: true,
    sub: 'Wholesale',
    spark: series(205, 12, 76, 1.2, 4),
    note: 'Up — higher wholesale reliance.'
  }, {
    id: 'assets',
    x: 252,
    y: 92,
    w: 158,
    h: 78,
    kind: 'result',
    label: 'Total assets',
    value: '$486B',
    delta: 2.4,
    sub: 'FY24E',
    spark: series(206, 12, 462, 3, 5),
    breakdown: [{
      k: 'Loans',
      v: '$312B'
    }, {
      k: 'Securities',
      v: '$148B'
    }, {
      k: 'Cash',
      v: '$26B'
    }],
    note: '+$11B vs plan, led by loan growth.'
  }, {
    id: 'liab',
    x: 252,
    y: 312,
    w: 158,
    h: 78,
    label: 'Total liabilities',
    value: '$444B',
    delta: 2.1,
    invert: true,
    sub: 'FY24E',
    spark: series(207, 12, 422, 3, 5),
    breakdown: [{
      k: 'Deposits',
      v: '$360B'
    }, {
      k: 'Borrowings',
      v: '$84B'
    }]
  }, {
    id: 'equity',
    x: 512,
    y: 122,
    w: 162,
    h: 78,
    kind: 'result',
    label: 'Equity',
    value: '$42B',
    delta: 5.4,
    sub: 'Assets − liabilities',
    spark: series(208, 12, 38, 0.5, 1),
    breakdown: [{
      k: 'CET1 capital',
      v: '$36B'
    }, {
      k: 'AT1 + buffers',
      v: '$6B'
    }],
    note: 'Retained earnings accretive.'
  }, {
    id: 'cet1',
    x: 512,
    y: 300,
    w: 162,
    h: 78,
    kind: 'result',
    label: 'CET1 ratio',
    value: '12.8%',
    delta: 0.4,
    sub: 'vs 11.0% req.',
    spark: series(209, 12, 12, 0.08, 0.3),
    note: '180bps above regulatory minimum.'
  }];
  const bsEdges = [{
    from: 'loans',
    to: 'assets'
  }, {
    from: 'secs',
    to: 'assets'
  }, {
    from: 'cash',
    to: 'assets'
  }, {
    from: 'deposits',
    to: 'liab'
  }, {
    from: 'borrow',
    to: 'liab'
  }, {
    from: 'assets',
    to: 'equity',
    accent: true
  }, {
    from: 'liab',
    to: 'equity',
    accent: true
  }, {
    from: 'equity',
    to: 'cet1',
    accent: true
  }];
  const bsRows = [{
    item: 'Loans & advances',
    cat: 'Assets',
    ac: 312,
    pl: 305,
    fc: 322,
    vp: 2.3,
    mv: 312
  }, {
    item: 'Securities',
    cat: 'Assets',
    ac: 148,
    pl: 152,
    fc: 146,
    vp: -2.6,
    mv: 148
  }, {
    item: 'Cash & reserves',
    cat: 'Assets',
    ac: 26,
    pl: 24,
    fc: 27,
    vp: 8.3,
    mv: 26
  }, {
    item: 'Deposits',
    cat: 'Liabilities',
    ac: 360,
    pl: 354,
    fc: 368,
    vp: 1.7,
    mv: 360
  }, {
    item: 'Borrowings',
    cat: 'Liabilities',
    ac: 84,
    pl: 80,
    fc: 88,
    vp: 5.0,
    mv: 84
  }, {
    item: 'Equity',
    cat: 'Capital',
    ac: 42,
    pl: 40,
    fc: 44,
    vp: 5.4,
    mv: 42
  }];
  return {
    kpis,
    positions,
    exposures,
    limits,
    navSeries,
    scenarios,
    insights,
    series,
    bsScorecards,
    bsNodes,
    bsEdges,
    bsRows
  };
}();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/risk-terminal/terminal-data.js", error: String((e && e.message) || e) }); }

__ds_ns.AIInsight = __ds_scope.AIInsight;

__ds_ns.AIPromptBar = __ds_scope.AIPromptBar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.ColumnChart = __ds_scope.ColumnChart;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.DonutGauge = __ds_scope.DonutGauge;

__ds_ns.ForecastChart = __ds_scope.ForecastChart;

__ds_ns.LimitBar = __ds_scope.LimitBar;

__ds_ns.LineChart = __ds_scope.LineChart;

__ds_ns.ScorecardKPI = __ds_scope.ScorecardKPI;

__ds_ns.Sparkline = __ds_scope.Sparkline;

__ds_ns.StatTile = __ds_scope.StatTile;

__ds_ns.Tracker = __ds_scope.Tracker;

__ds_ns.VarianceBar = __ds_scope.VarianceBar;

__ds_ns.DriverFlow = __ds_scope.DriverFlow;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.NumberStepper = __ds_scope.NumberStepper;

__ds_ns.RadioGroup = __ds_scope.RadioGroup;

__ds_ns.Slider = __ds_scope.Slider;

__ds_ns.DataGrid = __ds_scope.DataGrid;

})();
