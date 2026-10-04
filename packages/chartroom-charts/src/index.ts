/**
 * chartroom-charts — Evil Charts landed as source and signed to the widget
 * contract (ADR-92). `spec ← widgets ← charts ← studio`: the studio renders
 * these through `CHART_COMPONENTS` beside the widgets' own `COMPONENTS`; the
 * contracts live in the widgets' catalog, where the linter and the server
 * read every other one.
 */

import type { ComponentType } from 'react';
import type { WidgetProps } from 'chartroom-widgets';
import {
  EvilAreaWidget, EvilBarWidget, EvilComposedWidget, EvilLineWidget, EvilPieWidget,
  EvilRadarWidget, EvilRadialWidget, EvilSankeyWidget, EvilStackedAreaWidget, EvilStackedBarWidget,
} from './widgets';

export * from './options';
export * from './plan';
export * from './shape';
export {
  EvilAreaWidget, EvilBarWidget, EvilComposedWidget, EvilLineWidget, EvilPieWidget,
  EvilRadarWidget, EvilRadialWidget, EvilSankeyWidget, EvilStackedAreaWidget, EvilStackedBarWidget,
};

export const CHART_COMPONENTS: Record<string, ComponentType<WidgetProps>> = {
  'evil-bar@1': EvilBarWidget,
  'evil-stacked-bar@1': EvilStackedBarWidget,
  'evil-composed@1': EvilComposedWidget,
  'evil-line@1': EvilLineWidget,
  'evil-area@1': EvilAreaWidget,
  'evil-stacked-area@1': EvilStackedAreaWidget,
  'evil-pie@1': EvilPieWidget,
  'evil-radial@1': EvilRadialWidget,
  'evil-radar@1': EvilRadarWidget,
  'evil-sankey@1': EvilSankeyWidget,
};
