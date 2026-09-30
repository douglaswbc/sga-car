# Permissões — direção da v2

## Papéis

| Papel | Escopo esperado |
| --- | --- |
| `owner` | Administração completa da organização, membros e integrações. |
| `admin` | Gestão operacional completa, sem transferir propriedade. |
| `finance` | Faturas, pagamentos, cobranças, exportações e baixa manual auditada. |
| `operations` | Locatários, veículos, contratos e manutenções; sem configurações financeiras sensíveis. |
| `support` | Consulta e comunicação limitada, sem alteração financeira. |

## Interface por papel

Navegação, dashboard e guards de rota seguem a mesma matriz da autorização, centralizada em `src/features/auth/permissions.ts`:

| Área | owner | admin | finance | operations | support | master |
| --- | --- | --- | --- | --- | --- | --- |
| Visão geral | completa | completa | financeira | operacional | consulta | plataforma |
| Locatários / Contratos | gestão | gestão | consulta | gestão | consulta | — |
| Frota e manutenção | ✓ | ✓ | — | ✓ | — | — |
| Financeiro | ✓ | ✓ | ✓ | — | — | — |
| Comunicação | ✓ | ✓ | ✓ | ✓ | — | — |
| Templates de mensagem | ✓ | ✓ | — | — | — | — |
| Equipe | ✓ | — | — | — | — | — |
| Administração da plataforma | — | — | — | — | — | ✓ |

- Itens de navegação fora do escopo não são exibidos; rotas restritas redirecionam para `/`.
- O dashboard mostra apenas os indicadores do papel: financeiro (owner/admin/finance), frota (owner/admin/operations) e consulta operacional (support).
- `support` não acessa a fila de comunicação porque o RPC `list_messages` exige owner/admin/finance/operations; o detalhe do locatário carrega apenas os blocos permitidos ao papel.
- Caução e taxas do contrato são geridas por owner/admin/operations; cobrar a caução e encerrá-la (devolver/reter), ajustar faturas e adicionar taxas são de owner/admin/finance. Prorrogação e fatura de acerto de devolução são de owner/admin/operations.
- Assinatura e documento do contrato (`/contratos/[id]/contrato`) são de owner/admin/operations. Auditoria (`/configuracoes/auditoria`), integrações/tokens de API (`/configuracoes/integracoes`) e ações de LGPD (exportar/anonimizar titular) são de owner/admin. A seleção de organização ativa fica disponível a qualquer membro com mais de um vínculo.
- Os tokens de API autorizam integrações externas (n8n) com escopos (`messaging:send`, `messaging:read`, `invoices:read`, `tenants:read`, `contracts:read`) limitados à própria organização; o token é armazenado apenas como hash e as credenciais de provedor permanecem no servidor.

## Auditoria e LGPD

- `audit_logs` é imutável (sem update/delete; gravação só por `record_audit_event`) e registra ações administrativas e operacionais em contratos, faturas, pagamentos, convites e organizações.
- Exportação e anonimização de dados do titular respeitam a retenção legal (ver `docs/lgpd.md`).
- Limitação de taxa em login, cadastro, recuperação de senha e dispatcher (ver `docs/operations.md`).

## Modelo de segurança

- A identidade é `auth.users`; dados públicos mínimos ficam em `profiles`.
- Uma sessão opera em uma organização selecionada e validada por `organization_members`.
- RLS filtra todas as tabelas operacionais pelo vínculo ativo do usuário com `organization_id`.
- Autorização também é aplicada em ações de servidor e Edge Functions. O cliente não recebe `service_role`.
- Pagamentos, mudanças de contrato, baixa manual, mudanças de papel e ações de dispositivos geram `audit_logs`.

## Diagnóstico legado

O schema disponível mostra RLS e políticas para fechaduras, mas não fornece políticas para os demais domínios. A migration de criptografia expõe função de descriptografia a papéis amplos. Antes de migrar, executar uma auditoria no projeto Supabase real, revogar acessos excessivos e substituir o desenho de segredos.
