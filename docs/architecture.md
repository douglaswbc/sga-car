# Arquitetura — diagnóstico e direção da v2

## Estado atual (legado)

| Área | Evidência | Diagnóstico |
| --- | --- | --- |
| Frontend | React 19, Vite 7, React Router 7, JSX e Tailwind 4 | Aplicação SPA organizada em `pages`, `components`, `services` e `hooks`; há mistura de JS e TS. |
| Backend | Supabase client e Edge Functions | Lógica de cobrança, PIX, WhatsApp/Ryze, agendamentos, usuários e fechaduras está distribuída entre cliente e funções. |
| Identidade | `auth.users` + `public.usuarios` | Perfil, papel e dados de integração estão na mesma tabela; dados são associados a `id_usuario`. |
| Domínios | locatários, veículos, contratos, cobranças, candidatos, mensagens e fechaduras | Os domínios existem, mas contrato/cobrança/pagamento não estão separados. |
| Navegação | Dashboard, locatários, veículos, contratos, cobranças, mensagens, triagem, configurações e acessos | Cobertura funcional inicial boa; taxonomia não separa claramente Operação, Financeiro, Frota e Comunicação. |

## Problemas identificados

- Não há modelo explícito de organização e associação de membros; portanto, não há isolamento multiempresa no domínio.
- `cobrancas` concentra fatura, status de pagamento, link externo e identificador do Mercado Pago. Isso impede histórico de tentativas e reconciliação robusta.
- O dashboard calcula indicadores no cliente a partir de cobranças carregadas, limitando escala e consistência financeira.
- Datas financeiras aparecem como `text` (`data_vencimento`) e recorrência como texto; ambas devem ter tipos e regras explícitas.
- A migration de criptografia concede execução de descriptografia a `anon` e `authenticated`; isto requer redesenho antes de uso na v2.
- As políticas RLS documentadas cobrem fechaduras, mas o snapshot não evidencia políticas equivalentes para os demais domínios. Não assumir proteção sem auditoria no projeto Supabase.
- Credenciais de provedores aparecem como colunas em `usuarios`; a v2 deve usar cofre/segredos de servidor, com metadados mínimos no banco.
- A UI atual usa tema escuro, índigo, brilho, animações e gráficos decorativos, o que reduz a leitura operacional e remete a dashboards de IA.

## Estrutura proposta

```text
sga-v2/
├── docs/
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── billing/
│   │   ├── contracts/
│   │   ├── fleet/
│   │   └── tenants/
│   ├── lib/
│   ├── hooks/
│   ├── types/
│   └── config/
├── supabase/
│   ├── migrations/
│   ├── functions/
│   └── tests/
└── scripts/
```

A estrutura é alvo para a Fase 1; os diretórios ainda não foram criados para evitar uma implementação vazia.

## Decisões arquiteturais

- Um aplicativo Next.js substitui a SPA Vite apenas após validar a fundação na Fase 1.
- Server Actions/Route Handlers concentram autorização, validação Zod e integrações.
- Cada feature controla componentes, queries, ações, schemas, serviços e tipos somente quando necessários.
- Eventos de domínio e webhooks geram registros auditáveis; operações financeiras são transacionais.
