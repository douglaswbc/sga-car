# Integrações — diagnóstico e princípios

## Encontradas no legado

- Mercado Pago: geração de cobrança/PIX e receptor de webhook.
- WhatsApp/Ryze: instâncias, envio, reenvio, mensagens avulsas e lembretes.
- n8n: há referência a URL de webhook no schema legado; o fluxo precisa ser mapeado fora do repositório.
- Dispositivos: Edge Functions para estado, criação de instância e webhook de fechadura.

## Direção da v2

- Mercado Pago é provedor externo: o SGA cria e atualiza `payments`, recebe e persiste eventos em `webhook_events`, e aplica efeitos idempotentes.
- Credenciais ficam em secrets de ambiente/cofre do servidor, nunca em tabelas de perfil nem no navegador.
- WhatsApp recebe instruções do domínio. Templates, regras, agendamentos, tentativas e logs pertencem ao SGA; n8n/provedor executa a entrega.
- Cada integração terá adaptador, timeout, tratamento de falha, logs correlacionáveis e política de retentativa.

## Pendências da Fase 0

Confirmar no Supabase e no n8n: eventos configurados, contratos de payload, autenticação de webhooks, jobs agendados, política de retentativa e responsáveis por cada segredo. Nenhum segredo foi lido ou copiado para esta documentação.

## Comunicação (v2)

Resend executa e-mails e a Meta WhatsApp Cloud API executa mensagens; a fila, os templates, as retentativas e a idempotência ficam no SGA. Detalhes em docs/messaging.md.
