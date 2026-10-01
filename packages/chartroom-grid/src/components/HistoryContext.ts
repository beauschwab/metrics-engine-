/**
 * The host's histories, handed to every trend cell (ADR-89) without passing
 * through the table: a history is not a slice of the view and not a field
 * of the row, so it rides beside them the way the facets do.
 */

import { createContext, useContext } from 'react';
import type { GridHistory } from '../grid/trend';

export const HistoryContext = createContext<GridHistory | null>(null);

export const useHistory = (): GridHistory | null => useContext(HistoryContext);
