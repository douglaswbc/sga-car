import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// O SGA não usa cache. Todas as rotas são dinâmicas — a aplicação é autenticada e lida
// cookies a cada request — e não há rota estática, `generateStaticParams` nem revalidação
// por tempo. Não existe nada para pré-renderizar.
//
// Deixar `incrementalCache` de fora resolve para uma implementação interna ("dummy",
// ver o default em `defineCloudflareConfig`), que é o comportamento oficial para
// aplicações só-SSR. Isso também dispensa qualquer bucket R2 na conta.
//
// Se um dia houver conteúdo público e estático, configure aqui o
// `@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache` e crie o
// bucket com `npx wrangler r2 bucket create`, declarando o binding `NEXT_INC_CACHE_R2_BUCKET`
// em `wrangler.jsonc`.
export default defineCloudflareConfig({});
