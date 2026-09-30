# SGA v2

Reconstrução faseada do Sistema de Gestão de Aluguel (SGA).

O repositório legado em `../` permanece a referência funcional e de dados. A **Fase 1 — Fundação** está em andamento: a v2 possui uma base Next.js com TypeScript, Tailwind e uma tela estática que materializa o design system. Nenhuma integração, banco ou migração foi iniciada.

## Princípios

- Arquitetura modular, TypeScript estrito e isolamento por organização.
- Supabase Auth e RLS como camadas de segurança, nunca apenas o frontend.
- Contrato, fatura e pagamento são entidades distintas e preservam histórico.
- Design administrativo claro, sóbrio e operacional; sem gradientes, néon ou estética de produto de IA.

Consulte `AGENTS.md` antes de qualquer implementação e `docs/migration-plan.md` para a próxima fase aprovada.

O módulo de [frota](docs/fleet.md) cadastra os veículos e seus estados operacionais por organização.

Os [contratos de locação](docs/contracts.md) vinculam locatários e veículos disponíveis.

O módulo [financeiro](docs/finance.md) mantém faturas e pagamentos como registros separados, a partir dos contratos.

O [painel e relatórios](docs/dashboard.md) consolida indicadores reais da operação por organização.

## Executar localmente

```bash
npm install
npm run dev
```

## Implantação

O SGA é implantado como um **Cloudflare Worker** e usa o **Supabase** como banco de dados oficial. Não há Docker, VPS ou proxy reverso: o bundle é gerado pelo [OpenNext](https://opennext.js.org/cloudflare) e publicado com `npm run deploy`.

Copie `.env.example` para `.env` localmente e, em produção, cadastre cada segredo com `npx wrangler secret put`. Siga o guia de [implantação](docs/deployment.md). Nunca versione o `.env`, dumps do banco ou API keys do Zernio.

O canal de WhatsApp é entregue pelo [Zernio](https://docs.zernio.com): cada organização informa a própria API key e o `accountId` da sua conta de WhatsApp, e essas credenciais ficam criptografadas no banco. A integração direta com a Meta Cloud API foi removida. Veja [mensageria](docs/messaging.md).

## Autenticação

O projeto usa Supabase Auth com sessões em cookies. Configure o provedor de e-mail, URLs permitidas e variáveis locais conforme o [guia de autenticação](docs/auth-setup.md).

Os e-mails transacionais de autenticação usam Resend via SMTP do Supabase; siga o [guia do Resend](docs/resend-smtp.md).

O acesso global é controlado pelo papel `master`, separado dos papéis de cada organização. Consulte a [administração da plataforma](docs/platform-administration.md).

## Licença

Este projeto é licenciado sob a [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). Versões modificadas usadas para atender usuários pela rede devem disponibilizar o código-fonte correspondente, conforme a seção 13 da licença.
