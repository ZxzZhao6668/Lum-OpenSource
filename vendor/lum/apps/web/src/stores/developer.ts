import { defineStore } from "pinia";

export const useDeveloperStore = defineStore("developer", {
  state: () => ({ developerConfirmed: false }),
  persist: {
    key: "lum.developer",
    storage: {
      getItem: key => localStorage.getItem(key) ?? localStorage.getItem("toonflow.developer"),
      setItem: (key, value) => localStorage.setItem(key, value),
    },
  },
});
