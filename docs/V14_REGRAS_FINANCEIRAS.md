# V14 — Regras financeiras

## Regras do dashboard
- Receita: `income` comum, menos estornos marcados como `refund_of = 'income'`.
- Despesa: `expense` e `card_purchase`, menos estornos marcados como `refund_of = 'expense'`.
- `transfer_in`, `transfer_out` e `card_payment` não entram em receitas/despesas.
- Um estorno sem natureza conhecida (`is_refund = 1`, `refund_of IS NULL`) fica fora dos totais até ser classificado; não deve inflar receitas.
- Categorias de despesa exibem valores líquidos de estornos.

## Operações com cartão
- Compra normal e Pix no crédito aumentam a despesa/dívida do cartão.
- Devolução/estorno de Pix no crédito reduz a dívida do cartão e não representa entrada na conta corrente.
- Pagamento da fatura reduz o saldo da conta e liquida a fatura; não é uma nova despesa no dashboard.

## Dados e migração
- Migração v3 adiciona `operation_type` e `refund_transaction_id` sem apagar tabelas ou transações.
- `operation_type` diferencia Pix no crédito, estorno de Pix no crédito, compra no cartão e estornos de cartão/débito.
- `refund_transaction_id` é opcional: só deve ser preenchido quando a transação original puder ser identificada sem ambiguidade.
- A associação automática de transferências entre contas só deve ocorrer quando houver par de entrada/saída com mesmo valor, data e contas diferentes, ambos classificados como transferência.

## Limitações para validação
- As regras de classificação de estorno dependem dos sinais e descrições fornecidos pelo documento bancário.
- Bancos podem creditar estornos em ciclos de fatura diferentes; o sistema registra a data do crédito exibida no documento e não presume a fatura de destino.
- O Pix no crédito foi preparado para classificação semântica; é necessário testar com um extrato Nubank que contenha uma operação Pix no crédito real.
