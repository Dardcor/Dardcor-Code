
import { create } from "zustand";

export const useHeaderSearchStore = create((set) => ({
  query: "",
  placeholder: "",
  visible: false,

  setQuery: (query) => set({ query }),

  register: (placeholder = "Search...") =>
    set({ visible: true, placeholder, query: "" }),

  unregister: () => set({ visible: false, placeholder: "", query: "" }),
}));
