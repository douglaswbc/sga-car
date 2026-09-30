// O worker gerado pelo OpenNext exporta apenas o handler `fetch`. Para registrar
// Cron Triggers é preciso involved-lo e reexpor um handler `scheduled`.
//
// O agendador interno de mensagens (`src/instrumentation.ts`) usava `setInterval`,
// que não sobrevive no Workers: não há processo de longa duração. A fila de
// mensagens agora é processada por este trigger, que reaproveita a rota já existente
// POST /api/messaging/dispatch em vez de duplicar a lógica de dispatch.
//
// O handler reentra pelo próprio `fetch` (via service binding) porque o contexto de
// request do OpenNext — onde as bindings são resolvidas — só existe dentro de `fetch`.
// Chamar a função de dispatch diretamente deixaria as ligações de banco indisponíveis.
//
// @ts-ignore `.open-next/worker.js` é gerado em tempo de build.
import { default as handler } from "./.open-next/worker.js";

const DISPATCH_ROUTE = "/api/messaging/dispatch";

export default {
  fetch: handler.fetch,

  async scheduled(controller, env) {
    // Uma linha por agendamento registrado em `wrangler.jsonc > triggers.crons`.
    switch (controller.cron) {
      case "*/15 * * * *": {
        const status = await runDispatch(env);
        console.log(`cron.dispatch.status=${status}`);
        break;
      }
      default:
        console.log(`cron.ignorado=${controller.cron}`);
    }
  },
} satisfies ExportedHandler<CloudflareEnv>;

/**
 * O service binding entrega a requisição ao próprio Worker sem passar pela internet
 * pública, então o host é irrelevante — só o caminho precisa estar certo.
 */
async function runDispatch(env: CloudflareEnv): Promise<number> {
  const token = env.MESSAGING_DISPATCH_TOKEN;
  if (!token) {
    // Sem o token a rota responde 503; registrar o tick como falha deixa o
    // incidente visível no log do Worker em vez de silenciosamente não enviar.
    console.error("cron.dispatch.sem_token");
    return 503;
  }

  const self = env.WORKER_SELF_REFERENCE;
  if (!self) {
    // O service binding é declarado em `wrangler.jsonc`; sem ele o tick não tem como
    // alcançar a própria rota e a fila ficaria parada sem nenhum sinal.
    console.error("cron.dispatch.sem_service_binding");
    return 500;
  }

  const response = await self.fetch(`https://sga.internal${DISPATCH_ROUTE}`, {
    method: "POST",
    headers: { "x-dispatch-token": token },
  });
  return response.status;
}

// Reexportações exigidas quando a app usa DO Queue e DO Tag Cache.
// @ts-ignore `.open-next/worker.js` é gerado em tempo de build.
export { DOQueueHandler, DOShardedTagCache } from "./.open-next/worker.js";
