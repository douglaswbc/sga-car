# Design system — SGA v2

## Direção visual

Interface administrativa de locadora: clara, confiável e densa na medida certa. A referência é um sistema operacional/financeiro contemporâneo, não um produto de IA. Não usar gradientes, efeitos de brilho, fundos preto-zinco, textos excessivamente em caixa alta, indicadores “live” decorativos ou gráficos sem decisão associada.

## Tokens base

| Papel | Token | Cor |
| --- | --- | --- |
| Fundo da aplicação | `canvas` | `#F7F8FA` |
| Superfície | `surface` | `#FFFFFF` |
| Texto primário | `ink` | `#1F2933` |
| Texto secundário | `muted` | `#667085` |
| Bordas | `border` | `#D9DEE5` |
| Marca/ação primária | `primary` | `#1F5E75` |
| Ação em hover | `primary-hover` | `#17495C` |
| Êxito | `success` | `#24724D` |
| Atenção | `warning` | `#9A6700` |
| Erro | `danger` | `#B42318` |

Azul petróleo transmite estabilidade sem a associação roxo-ciano/neon típica de produtos de IA. As cores de status sempre acompanham texto e ícone.

## Fundamentos

- Fonte: Inter ou a sans-serif do sistema; 14 px como base, títulos entre 20 e 28 px com peso 600–700.
- Espaçamento: escala de 4 px (`4, 8, 12, 16, 24, 32, 48`).
- Raios: 6 px para campos/botões e 10 px para cards; evitar cápsulas como padrão.
- Sombras: uma sombra discreta apenas em superfícies elevadas. Bordas definem a maior parte da hierarquia.
- Grid: conteúdo máximo fluido, gutter de 24 px no desktop e 16 px no mobile; desktop é prioritário.

## Componentes e estados

- Botão primário, secundário, discreto e destrutivo; altura mínima de 40 px.
- Campos possuem label persistente, ajuda/erro, foco visível e estado desabilitado.
- Tabelas oferecem busca, filtros, ordenação, paginação e ações contextuais; no mobile, colunas essenciais sobrevivem ou viram detalhe.
- Badges têm ícone ou rótulo textual: `Pago`, `Pendente`, `Vencido`, `Cancelado`; `Disponível`, `Alugado`, `Manutenção`, `Inativo`.
- Estados vazios informam o próximo passo; carregamento usa skeleton; erros explicam a ação de recuperação.

## Navegação

Dashboard; Operação (Locatários, Candidatos, Contratos); Financeiro (Faturas, Pagamentos, Fluxo de Caixa); Frota (Veículos, Manutenções); Comunicação; Dispositivos; Configurações. A navegação final será validada contra os fluxos reais na Fase 1.
