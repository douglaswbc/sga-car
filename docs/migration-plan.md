# Plano de migração

## Estratégia

O banco legado não será apagado nem modificado de forma destrutiva. A migração será repetível, com leitura do legado, transformações versionadas, tabelas de correspondência e relatórios de rejeições. Cada execução deve registrar origem, destino, data, contagem e erros.

## Fases

1. **Fase 0 — Diagnóstico**: inventário, riscos, modelo conceitual e plano (concluída documentalmente nesta pasta).
2. **Fase 1 — Fundação**: criar projeto, padrões, CI, tokens do design system e ambiente Supabase sem dados produtivos.
3. **Fase 2 — Organizações, Auth e permissões**: `organizations`, perfis, membros, RLS e auditoria base.
4. **Fase 3 — Locatários e candidatos**: normalização cadastral, documentos e fluxo de triagem validado.
5. **Fase 4 — Frota**: veículos, status, documentos, eventos e manutenções.
6. **Fase 5 — Contratos**: contratos, veículos vinculados, recorrência tipada e eventos.
7. **Fase 6 — Faturas e billing engine**: geração idempotente de faturas a partir dos contratos.
8. **Fase 7 — Pagamentos e Mercado Pago**: tentativas, PIX, webhooks, reconciliação e baixa manual auditada.
9. **Fase 8 — Comunicação**: templates, regras, agenda, WhatsApp e logs.
10. **Fase 9 — Dispositivos**: fechaduras, comandos expirados e logs.
11. **Fase 10 — Portal do locatário**: experiência mobile limitada a contrato, faturas, PIX e comunicados.
12. **Fase 11 — Dashboard**: indicadores acionáveis derivados de dados financeiros confiáveis.
13. **Fase 12 — Migração piloto**: cópia anonimizada, mapeamento validado, reconciliação de totais e rollback.
14. **Fase 13 — Testes e cutover**: testes de segurança, carga e aceitação; janela de sincronização final e plano de reversão.

## Critérios para iniciar a Fase 1

- Aprovar esta arquitetura, o modelo conceitual e a direção visual.
- Confirmar se a v2 será um subprojeto independente neste repositório ou ganhará repositório próprio.
- Ter acesso seguro ao inventário do Supabase/n8n para completar a auditoria de políticas, funções e agendamentos.
