import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

// O SGA é uma aplicação autenticada: quase nada é cacheável, mas o Next.js ainda exige
// umIncremental Cache configurado para concluir o build. O bucket R2 é criado com
// `npx wrangler r2 bucket create sga-v2-opennext-cache` e ligado em `wrangler.jsonc`.
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
