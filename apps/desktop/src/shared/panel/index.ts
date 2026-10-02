import { create } from 'zustand';

/** The parts of the right panel, always in this order. */
export const PANEL_PARTS = ['plan', 'verification', 'changes', 'unusual', 'usage'] as const;
export type PanelPart = (typeof PANEL_PARTS)[number];

/** 'all' stacks the parts; the others show one. */
export type PanelTab = 'all' | PanelPart;

interface PanelTabState {
  tab: PanelTab;
  show: (tab: PanelTab) => void;
}

/**
 * Which tab the right panel shows. Screen state, but two features need it: the panel draws it, and the chat opens
 * a tab (a plan call's result line opens the plan). Showing a tab never changes the panel's width.
 */
export const usePanelTab = create<PanelTabState>((set) => ({
  tab: 'all',
  show: (tab) => set({ tab }),
}));
