// @ts-check
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://usgpt.us',
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      theme: 'min-light',
    },
  },
});
