# SGA — tarefas e telas

Legenda: `[x]` concluído · `[~]` em andamento/parcial · `[ ]` pendente.

Este arquivo é o checklist de evolução do SGA. Atualize o status na mesma alteração que entregar uma funcionalidade.

## 1. Fundação e operação técnica

- [x] Projeto Next.js com TypeScript estrito, Zod e estrutura por domínio.
- [x] PostgreSQL/Supabase com migrations versionadas.
- [x] Isolamento de dados por organização e RLS.
- [x] Ambiente local documentado e `.env.example`.
- [x] Estrutura de implantação em VPS com Docker Compose e Caddy.
- [x] Licença AGPL-3.0-only e arquivos de exclusão revisados.
- [x] Script de migrations com TLS validado para Supabase.
- [x] Componentes de UI compartilhados: modal acessível, estados de envio, mensagens e toasts, skeletons e error boundary.
- [ ] Pipeline CI para typecheck, lint, testes e build.
- [ ] Testes automatizados de regras de negócio e rotas.
- [x] Observabilidade: logs estruturados e health check (`/api/health`) para monitoramento e alertas.
- [~] Rotina de backup e restauração: scripts `npm run backup`/`restore` e runbook; restauração ainda não testada em VPS.

## 2. Autenticação, organizações e administração

- [x] Tela de criar conta.
- [x] Tela de login, confirmação de e-mail e logout.
- [x] Tela de onboarding para solicitar uma organização.
- [x] Tela master para aprovar, suspender e reativar organizações.
- [x] Papéis organizacionais: owner, admin, finance, operations e support.
- [x] Tela de gestão de membros existentes.
- [x] Bloqueio de acesso para organizações suspensas.
- [x] Convites de membros por e-mail com token, página de aceite e reenvio/revogação.
- [x] Recuperação e redefinição de senha pela interface.
- [x] Auditoria visual de ações administrativas e operacionais.
- [x] Seleção de organização quando o usuário participar de mais de uma.
- [x] Navegação, dashboard e guards de rota adaptados por papel.

## 3. Locatários

- [x] Tela `/locatarios` com listagem de nome, documento, telefone, e-mail e status.
- [x] Modal em etapas para novo locatário e endereço.
- [x] Busca automática de endereço pelo CEP.
- [x] Validação e máscara de CPF/CNPJ.
- [x] Validação, normalização e unicidade do telefone por organização.
- [x] Armazenamento normalizado de telefone no padrão brasileiro com `55`.
- [x] Visualização e edição de endereço.
- [x] CRUD completo do locatário: editar dados, inativar, reativar e exclusão segura.
- [x] Histórico do locatário: contratos, cobranças, pagamentos e comunicações no detalhe.
- [x] Documentos do locatário: CNH, comprovantes e anexos.
- [x] Validação de CNH e regras de elegibilidade para locação (elegibilidade informativa, sem bloqueio).

## 4. Frota e manutenção

- [x] Tela `/frota` com listagem de veículos.
- [x] Cadastro de placa, marca, modelo, categoria, ano, cor e quilometragem.
- [x] Normalização e unicidade da placa por organização.
- [x] CRUD de veículo com exclusão confirmada.
- [x] Estados: disponível, alugado, manutenção e inativo.
- [x] Controle de acesso para owner, admin e operations.
- [x] Tela de detalhe do veículo com histórico.
- [x] Registro de entrada e saída de quilometragem.
- [x] Agenda e histórico de manutenção preventiva/corretiva.
- [x] Alertas por quilometragem, prazo de revisão e documentação.
- [x] Documentos do veículo: CRLV, seguro, inspeções e anexos.
- [x] Categorias, acessórios e opcionais da frota.

## 5. Contratos de locação

- [x] Tela `/contratos` com listagem dos contratos.
- [x] Criação de contrato vinculando locatário ativo e veículo disponível.
- [x] Atualização atômica do veículo para alugado ao criar contrato.
- [x] Prevenção de dois contratos ativos para o mesmo veículo.
- [x] Configuração de diária, início e previsão de retorno.
- [x] Recorrência de cobrança: diária, semanal, quinzenal, mensal ou personalizada.
- [x] Horário de cobrança e intervalo personalizado em dias, semanas ou meses.
- [x] Gerenciamento de contrato: editar termos, concluir, cancelar e excluir registros não ativos.
- [x] Retorno automático do veículo para disponível ao concluir ou cancelar.
- [x] Vistoria de retirada: fotos, quilometragem, combustível, avarias e acessórios.
- [x] Vistoria de devolução: comparação com retirada e cálculo de diferenças.
- [x] Assinatura, geração e download de contrato em PDF (assinaturas registradas e documento imprimível/PDF).
- [x] Termos, descontos, caução, multas, taxas e adicionais: composição por `invoice_items`, caução e taxas próprias por contrato.
- [x] Renovação/prorrogação do contrato: fluxo dedicado com histórico e reajuste opcional de diária.
- [x] Regras de atraso e cálculo de diária excedente: fatura de acerto automática com diária excedente e avarias.

## 6. Financeiro — prioridade seguinte

- [x] Modelagem de faturas (`invoice`) como etapa posterior ao contrato.
- [x] Gerador idempotente de faturas a partir da agenda de cobrança do contrato.
- [x] Tela `/financeiro` para listar faturas: pendente, paga, vencida, cancelada e estornada.
- [x] Cálculo do valor devido conforme período, diária, descontos e acréscimos.
- [x] Geração manual de cobrança avulsa.
- [x] Registro de pagamentos (`payment`) com data, valor, método e comprovante por URL.
- [x] Baixa parcial e total de faturas.
- [x] Conciliação e histórico financeiro por locatário e contrato.
- [x] Regras de vencimento, atraso, juros, multa e renegociação.
- [x] Relatórios de contas a receber e inadimplência.

## 7. Comunicação e integrações

- [x] Resend definido para e-mails transacionais de autenticação via SMTP do Supabase.
- [~] Configurar domínio, remetente e produção do Resend: variáveis prontas; falta ativar domínio/remetente.
- [x] E-mails (Resend) restritos a convite de equipe e autenticação; cobranças e avisos somente por WhatsApp (Meta Cloud API).
- [x] Integração Meta Cloud API para mensagens.
- [x] Templates de mensagem por evento e organização.
- [x] Catálogo de avisos WhatsApp e sincronização push/pull para aprovação na Meta.
- [x] Fila de envio, retentativas e registro idempotente de webhooks.
- [x] Tela de histórico de comunicações por locatário.
- [x] Preferências de contato e consentimento LGPD.
- [x] Integração externa por token de API (n8n): escopos, disparo de cobranças e consultas, com credenciais mantidas no SGA.

## 8. Painel e relatórios

- [x] Dashboard possui conteúdo visual inicial com dados reais.
- [x] Substituir todos os indicadores mockados por consultas reais.
- [x] Indicadores de frota: disponibilidade, utilização, manutenção e veículos parados.
- [x] Indicadores financeiros: recebido, a receber, vencido e inadimplência.
- [x] Alertas operacionais: devoluções próximas, contratos vencidos e manutenções.
- [x] Filtros por período, exportação CSV/PDF e relatórios salvos.

## 9. Segurança, qualidade e conformidade

- [x] Entradas das rotas atuais validadas com Zod.
- [x] Autorizações críticas protegidas no banco com RLS e funções RPC.
- [x] Revisão completa de autorização em todas as novas telas e endpoints.
- [x] Limitação de taxa para login, APIs públicas e webhooks.
- [x] Política de retenção, exportação e exclusão de dados pessoais (LGPD).
- [x] Auditoria imutável de alterações em contratos, faturas e pagamentos.
- [ ] Testes de integração contra banco isolado.
- [~] Revisão de segurança antes da primeira implantação pública: checklist em `docs/operations.md`; revisão final pendente do deploy.

## Ordem recomendada de execução

1. `[x]` Faturas recorrentes e pagamentos — fecha o fluxo financeiro `contract → invoice → payment`.
2. `[x]` Vistorias e encerramento detalhado de contratos.
3. `[x]` Manutenção e histórico da frota.
4. `[x]` Comunicação por e-mail e Meta Cloud API.
5. `[x]` Dashboard com dados reais e relatórios.
6. `[~]` Testes, auditoria, backups, segurança e preparação de produção (auditoria/LGPD/observabilidade prontos; testes e revisão final pendentes).
