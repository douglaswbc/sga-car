# LGPD — dados pessoais

## Princípios

O SGA trata dados pessoais de locatários (nome, documento, contato, endereço e documentos) para execução de contratos de locação. O titular tem direito a acesso, correção, portabilidade e eliminação dos dados pessoais, observadas as obrigações legais de retenção.

## Exportação de dados do titular

`GET /api/tenants/[tenantId]/export?organizationId=...` (owner/admin) devolve um JSON com cadastro, endereço, documentos, contratos, faturas, pagamentos, comunicações e preferências do locatário. A tela do locatário expõe o botão **Exportar dados (LGPD)**.

## Eliminação (anonimização)

Anonimizar remove os dados pessoais diretos (nome, documento, e-mail, telefone, endereço, documentos e preferências) e limpa destinatário/corpo das mensagens, mantendo os registros financeiros (contratos, faturas e pagamentos) para cumprir obrigações fiscais e contábeis. A ação é irreversível, restrita a owner/admin e gera evento em `audit_logs` (`tenant.anonymized`).

`POST /api/tenants/[tenantId]/anonymize` com `{ organizationId }`.

## Retenção

| Dado | Retenção | Ação ao fim do prazo |
| --- | --- | --- |
| Cadastro e documentos do locatário | enquanto houver vínculo ativo | anonimizar |
| Contratos, faturas e pagamentos | prazo fiscal/legal (mínimo 5 anos) | manter |
| Mensagens de comunicação | 24 meses | anonimizar/limpar |
| Logs de auditoria | 24 meses | manter (imutável) |
| Webhooks | 6 meses | remover |

## Consentimento

`tenant_contact_preferences` guarda opt-in de e-mail e WhatsApp e o momento do consentimento, editável no detalhe do locatário. Todos os envios respeitam o opt-in.
