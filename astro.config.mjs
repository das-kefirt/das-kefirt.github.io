import { defineConfig } from 'astro/config';
export default defineConfig({
  site: 'https://das-kefirt.github.io',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false }
});
