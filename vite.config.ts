import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import netlify from '@netlify/vite-plugin'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * El mapa necesita un proveedor de tiles, y osm.org no lo es.
 *
 * El servidor público de OpenStreetMap sirve la copia de desarrollo y su
 * política de uso excluye expresamente que una aplicación tire de él en
 * producción. Con `VITE_TILE_URL` sin poner, el build de desarrollo avisa y el
 * de producción se para: un aviso en un registro que nadie lee es la forma
 * habitual de que esto llegue vivo a producción.
 *
 * Para desplegar a propósito sin proveedor —una demo, una prueba de humo—
 * basta con `FLEETHUB_ALLOW_PUBLIC_TILES=true`.
 */
function tileProvider(env: Record<string, string>): Plugin {
  return {
    name: 'fleethub-tile-provider',
    apply: 'build',
    config() {
      if (env.VITE_TILE_URL) return
      const excused = env.FLEETHUB_ALLOW_PUBLIC_TILES === 'true'
      const shipping = env.CONTEXT === 'production' || env.FLEETHUB_ENVIRONMENT === 'production'
      const message = [
        'VITE_TILE_URL sin configurar: el mapa usaría el servidor público de',
        'OpenStreetMap, cuya política de uso no admite producción. Configura un',
        'proveedor propio con su VITE_TILE_ATTRIBUTION, o pon',
        'FLEETHUB_ALLOW_PUBLIC_TILES=true para desplegar así a propósito.',
      ].join(' ')
      if (shipping && !excused) throw new Error(message)
      console.warn(`\n⚠  ${message}\n`)
    },
  }
}

// https://vite.dev/config/
// `vite build --mode singlefile` inlines every asset into one self-contained
// index.html, which is what the shareable preview build needs.
export default defineConfig(({ mode }) => {
  // Con prefijo vacío se leen también las variables sin `VITE_`, que es donde
  // viven el contexto de despliegue y el permiso explícito. Nada de eso llega
  // al navegador: sólo decide si este build sale adelante.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      react(),
      tileProvider({ ...env, ...process.env } as Record<string, string>),
      ...(mode === 'singlefile' ? [viteSingleFile()] : [netlify()]),
    ],
    server: {
      // En desarrollo el navegador habla con Vite en :5173. La API conserva su
      // puerto propio y Vite reenvía /api para mantener URLs relativas, iguales
      // a las que usa el servidor cuando entrega la aplicación en producción.
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
  }
})
