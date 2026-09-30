// O SGA roda em Cloudflare Workers, onde não existe processo de longa duração:
// `setInterval` não sobrevive entre requisições, então o agendador in-process que
// vivia aqui foi removido. A fila de mensagens passou a ser processada pelo Cron
// Trigger declarado em `wrangler.jsonc > triggers.crons`, cujo handler chama
// POST /api/messaging/dispatch. Ver `worker.ts`.
export async function register() {
  return;
}
