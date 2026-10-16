import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  imports: false,
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
  },
  manifest: {
    name: 'Webmotors Plus',
    description:
      'Busca com IA em qualquer página, lista negra de marcas e modelos e árvore de resultados com FIPE e preço médio na Webmotors.',
    permissions: ['storage', 'alarms'],
    // FIPE lookups run in the service worker. Webmotors itself is only ever
    // called from content scripts (same origin, user's own session).
    host_permissions: ['https://veiculos.fipe.org.br/*', 'https://fipe.parallelum.com.br/*'],
  },
  vite: () => ({
    plugins: [preact()],
  }),
});
