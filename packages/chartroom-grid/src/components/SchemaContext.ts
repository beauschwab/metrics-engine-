/**
 * The schema the grid is showing (ADR-82), for the components that need a
 * column's declared meta rather than the view's reading of it — the header
 * menu's "Restore default", the filter bar's labels, the calculated-column
 * editor's list of measures. The shell provides it from the source's
 * description; the treasury book is the default so a component rendered
 * on its own still has one.
 */

import { createContext, useContext } from 'react';
import { TREASURY_SCHEMA } from '../data/treasury';
import type { GridSchema } from '../grid/schema';

export const SchemaContext = createContext<GridSchema>(TREASURY_SCHEMA);
export const useSchema = (): GridSchema => useContext(SchemaContext);
