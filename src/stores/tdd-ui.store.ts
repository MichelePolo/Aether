import { create } from 'zustand';

interface TddUiState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

export const useTddUiStore = create<TddUiState>((set) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
}));
