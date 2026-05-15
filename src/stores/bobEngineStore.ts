import { create } from 'zustand';

interface BobEngineState {
  currentRoute: string;
  isAgentExecuting: boolean;
  setRoute: (route: string) => void;
  setExecuting: (status: boolean) => void;
}

export const useBobEngineStore = create<BobEngineState>((set) => ({
  currentRoute: '/dashboard',
  isAgentExecuting: false,
  setRoute: (route) => set({ currentRoute: route }),
  setExecuting: (status) => set({ isAgentExecuting: status }),
}));
