# Financeiro

O fluxo financeiro é local e preserva a sequência `contrato → fatura → pagamento`.

- Faturas recorrentes são geradas para contratos ativos até a data escolhida. A chave de contrato e período impede duplicação em novas execuções.
- O valor de uma fatura recorrente corresponde aos dias do período multiplicados pela diária do contrato. Cobranças avulsas podem ser criadas para um locatário, opcionalmente vinculadas a um contrato.
- Um pagamento é imutavelmente registrado contra uma fatura. A operação bloqueia a fatura, não aceita valor superior ao saldo e atualiza o total pago e o status de forma atômica; portanto, são permitidas baixas parciais e totais.
- A URL do comprovante e uma observação são opcionais. O envio de arquivos será tratado no módulo de documentos.
- A tela apresenta contas a receber, inadimplência e valores recebidos. Por fatura, usuários financeiros podem aplicar descontos, acréscimos, multa ou juros, sempre com justificativa registrada. Renegociações preservam o registro anterior do valor e da justificativa e definem novo valor total e vencimento.

As RPCs exigem o papel `owner`, `admin` ou `finance`; a consulta é liberada aos membros ativos da organização. A migration `202609140016_invoices_and_payments.sql` deve ser aplicada antes de acessar `/financeiro`.
