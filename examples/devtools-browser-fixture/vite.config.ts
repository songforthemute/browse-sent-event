import { defineConfig } from "vite";
import browseSentEvent from "@browse-sent-event/plugin-vite";

export default defineConfig({
  plugins: [browseSentEvent()],
});
