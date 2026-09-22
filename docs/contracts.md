# Contratos de locação

Um contrato ativo vincula um locatário ativo a um veículo disponível e registra período e valor diário. A criação é atômica: o veículo é marcado como alugado na mesma transação, impedindo contratos ativos concorrentes para a mesma frota.

A agenda de cobrança é parte do contrato: diária, semanal, quinzenal, mensal ou personalizada (a cada N dias, semanas ou meses), sempre com horário definido. Esses dados serão usados na geração idempotente de faturas.

O encerramento, a vistoria e a geração de cobranças serão as próximas extensões do fluxo `contract → invoice → payment`.
