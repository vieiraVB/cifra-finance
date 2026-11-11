# Plano de testes controlados v3

## Objetivo
Validar parsers com gabarito conhecido antes de comparar extratos bancários reais.

## Documentos sintéticos
- InfinitePay: `docs/test-fixtures/infinitepay/extrato_infinitepay_ficticio.csv` — 5 linhas esperadas.
- Mercado Pago: `docs/test-fixtures/mercadopago/extrato_mercadopago_ficticio.csv` — 5 linhas esperadas.
- OFX genérico: `docs/test-fixtures/ofx/extrato_conta_generico_ficticio.ofx` — 4 linhas esperadas.

Os dados são fictícios e não representam extratos oficiais.

## Critérios de aprovação
1. Quantidade de lançamentos coincide com o gabarito.
2. Datas e valores em centavos coincidem exatamente.
3. Crédito e débito têm direção correta.
4. Estorno e devolução são identificados como entradas/estornos para revisão.
5. Nenhum cabeçalho, saldo ou total é importado como transação.
6. Duplicidades são sinalizadas sem apagar registros originais.

## Testes de regressão
Após cada alteração, repetir os arquivos reais já aprovados do Nubank conta, Nubank fatura PDF, Nubank OFX e Bradesco. Não limpar nem recriar o SQLite.
