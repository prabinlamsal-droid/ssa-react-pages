import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { bridgeCsp } from './build/bridgeCsp.js';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile(), bridgeCsp()],
  build: { modulePreload: false },
});
