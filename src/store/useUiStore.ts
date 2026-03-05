import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type DrawerPanel = 'backgrounds' | 'stickers' | 'characters' | 'settings' | null;

interface UiState {
  activeBackgroundId: string | null;
  activeCharacterId: string | null;
  activeStickerIds: string[];
  controlsHidden: boolean;
  drawerPanel: DrawerPanel;
  setBackground: (id: string | null) => void;
  setCharacter: (id: string | null) => void;
  toggleSticker: (id: string) => void;
  setDrawerPanel: (panel: DrawerPanel) => void;
  toggleControls: () => void;
  showControls: () => void;
  resetUi: () => void;
}

const initialState = {
  activeBackgroundId: null,
  activeCharacterId: null,
  activeStickerIds: [],
  controlsHidden: false,
  drawerPanel: null as DrawerPanel,
};

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      ...initialState,
      setBackground: id => set({ activeBackgroundId: id }),
      setCharacter: id => set({ activeCharacterId: id }),
      toggleSticker: id => {
        const has = get().activeStickerIds.includes(id);
        set({
          activeStickerIds: has
            ? get().activeStickerIds.filter(entry => entry !== id)
            : [...get().activeStickerIds, id],
        });
      },
      setDrawerPanel: panel => set({ drawerPanel: panel }),
      toggleControls: () => set({ controlsHidden: !get().controlsHidden }),
      showControls: () => set({ controlsHidden: false }),
      resetUi: () => set({ ...initialState }),
    }),
    { name: 'kjvtuber-ui-state' },
  ),
);
