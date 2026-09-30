import { create } from 'zustand';

interface ConnectPrompt {
  /** 'Later' was chosen; the first-run sheet stays closed until someone asks again. */
  dismissed: boolean;
  dismiss: () => void;
  /** Opens the sheet again, as sending with nothing connected does. */
  ask: () => void;
}

export const useConnectPrompt = create<ConnectPrompt>((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
  ask: () => set({ dismissed: false }),
}));
