# Locatários

O módulo de locatários mantém o cadastro operacional por organização. Documento (CPF ou CNPJ) e telefone são normalizados — o telefone fica no padrão brasileiro com prefixo `55` — e únicos dentro da organização.

## Cadastro e status

O cadastro é feito em etapas (dados e endereço) e pode ser editado depois. Locatários podem ser inativados e reativados. A exclusão é permitida apenas quando não há contratos nem faturas vinculados; caso contrário, o correto é inativar, preservando o histórico.

## Documentos e CNH

`tenant_documents` guarda a CNH (número com dígitos verificadores validados, categoria e validade), comprovantes e outros anexos. Os links são referências a arquivos já hospedados; o módulo não armazena o arquivo em si. Cada locatário possui no máximo uma CNH.

## Elegibilidade

Um locatário é considerado apto para locação quando está ativo e possui CNH cadastrada e dentro da validade. A elegibilidade é apenas informativa: aparece no cadastro, no detalhe e no formulário de contrato como aviso, sem bloquear a criação do contrato. O SGA decide as regras; o banco permanece a fonte de verdade.

## Histórico

A página de detalhe reúne contratos, cobranças e pagamentos do locatário. O histórico de comunicações depende do módulo de comunicação.
