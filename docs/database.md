# Banco de dados — modelo conceitual v2

## Limites de domínio

```text
organization ─┬─ organization_members ─ profile/auth user
              ├─ tenants ─ tenant_addresses, tenant_documents
              ├─ vehicles ─ vehicle_documents, vehicle_events
              ├─ contracts ─ contract_vehicles, contract_events
              ├─ invoices ─ invoice_items ─ payments ─ payment_attempts
              ├─ maintenances ─ maintenance_items
              ├─ message_templates ─ communication_rules ─ scheduled_messages ─ message_logs
              ├─ devices ─ device_commands ─ device_logs
              ├─ webhook_events
              └─ audit_logs
```

## Regras principais

- Tabelas operacionais recebem `organization_id`, índice composto por organização e campos de busca, e RLS por participação na organização.
- `profiles` estende `auth.users`; `organization_members` atribui os papéis `owner`, `admin`, `finance`, `operations` e `support`.
- `vehicles.status` usa estados explícitos: `available`, `rented`, `reserved`, `maintenance`, `inactive`.
- `contracts` guarda o acordo e a próxima data de faturamento; `invoices` é o documento a pagar; `payments` registra a liquidação; `payment_attempts` registra cada interação com o provedor.
- Valores financeiros usam `numeric(14,2)` e moedas explícitas. Datas de vencimento usam `date`; instantes usam `timestamptz`.
- `webhook_events` inclui `provider`, `event_type`, `external_id`, `payload`, `status`, `received_at`, `processed_at` e `error`, com unicidade adequada ao provedor/evento.

## Migrations

As migrations versionadas ficam em `supabase/migrations` e são executadas por `npm run migrate`, usando exclusivamente `DATABASE_URL`. O executor registra cada arquivo aplicado em `public.sga_schema_migrations` e processa cada migration em uma transação.

## Locatários

`tenants` armazena o cadastro operacional por organização, com documento, contato e status explícito. `tenant_addresses` mantém endereço em uma tabela separada e `tenant_documents` guarda CNH, comprovantes e anexos (com número, categoria e validade para a CNH). Os dados são lidos por membros da organização ativa; gravação é restrita a `owner`, `admin` e `operations`.

`update_tenant` permite editar cadastro e status (inativar/reativar). `delete_tenant` só exclui locatário sem contratos ou faturas; com histórico, a orientação é inativar. A elegibilidade para locação (`list_tenants.is_eligible`) é derivada de locatário ativo com CNH cadastrada e não vencida.

## Contratos e financeiro

`invoices` guarda o total a pagar; `invoice_items` é a composição por itens (`base`, `discount`, `additional`, `fine`, `interest`, `fee`, `deposit`, `deposit_refund`, `extra_daily`, `damage`). As colunas legadas de `invoices` (`subtotal`, `discount_amount`, `additional_amount`, `fine_amount`, `interest_amount`, `amount_due`) são derivadas dos itens por `refresh_invoice_totals`. Valores com sinal: descontos e estornos de caução são negativos.

`rental_contracts` carrega `security_deposit_amount` e `security_deposit_status` (`none`, `pending`, `held`, `refunded`, `retained`); `contract_fees` define taxas próprias (única ou por período) e `contract_renewals` mantém o histórico de prorrogações. O encerramento com `settle_contract_return` gera a fatura de acerto (diária excedente e avarias da devolução) de forma idempotente.

## Mapeamento inicial do legado

| Legado | V2 | Observação |
| --- | --- | --- |
| `usuarios` | `profiles`, `organizations`, `organization_members` | Separar perfil, empresa, papel e configurações de integração. |
| `locatarios` | `tenants`, `tenant_addresses`, `tenant_documents` | Normalizar endereço e documentos. |
| `veiculos` | `vehicles`, `vehicle_documents`, `vehicle_events` | Substituir `ativo` por status operacional. |
| `contratos` | `contracts`, `contract_vehicles`, `contract_events` | Tornar recorrência estruturada e registrar histórico. |
| `cobrancas` | `invoices`, `payments`, `payment_attempts` | Não migrar o status sem preservar origem, link e identificador externo. |
| `mensagens_template`, `agendamentos_mensagens` | `message_templates`, `scheduled_messages`, `message_logs` | Separar conteúdo, regra, agenda e entrega. |
| `fechaduras`, `fechadura_comandos`, `fechadura_logs` | `devices`, `device_commands`, `device_logs` | Manter auditoria e expiração de comandos. |
| `candidatos` | Avaliar feature `candidates` | Migrar após definição do fluxo de reserva e análise de dados. |
