# Frota

O módulo de frota registra veículos por organização. Cada placa é única dentro da organização e é normalizada sem pontuação, preservando a apresentação no formato `ABC-1D23`.

Os estados do veículo são `available`, `rented`, `maintenance` e `inactive`. Somente os papéis `owner`, `admin` e `operations` podem cadastrar ou alterar veículos.

## Operação do veículo

A página de detalhe reúne o histórico de quilometragem, a agenda e o histórico de manutenção, documentos e acessórios. Registros de quilometragem não podem reduzir o hodômetro do veículo. A manutenção pode ser preventiva ou corretiva e, depois de concluída, registra a quilometragem de conclusão.

Alertas são exibidos quando uma manutenção agendada está vencida ou atingiu sua quilometragem prevista, ou quando um documento vence nos próximos 30 dias. Os links de documentos são referências a arquivos já hospedados; o módulo não armazena o arquivo em si.
