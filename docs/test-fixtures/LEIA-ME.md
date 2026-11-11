# Laboratório de importação — documentos fictícios

**Todos os documentos nesta pasta são sintéticos e não são extratos oficiais nem reproduções garantidas dos layouts atuais das instituições.** Foram criados para testar leitura de CSV/OFX, sinais de crédito/débito, datas, descrições, taxas, estornos e transferências.

## Gabarito esperado

### InfinitePay — `infinitepay/extrato_infinitepay_ficticio.csv`
5 lançamentos:
- 03/11/2026 Venda no débito - Pedido 1001: entrada R$ 150,00
- 03/11/2026 Taxa da venda - Pedido 1001: saída R$ 3,75
- 04/11/2026 Pix recebido - Cliente Teste: entrada R$ 80,00
- 04/11/2026 Pix enviado - Fornecedor Teste: saída R$ 25,50
- 05/11/2026 Estorno de venda - Pedido 1001: entrada R$ 150,00

### Mercado Pago — `mercadopago/extrato_mercadopago_ficticio.csv`
5 lançamentos:
- 06/11/2026 Dinheiro recebido - Venda fictícia: entrada R$ 125,90
- 06/11/2026 Pagamento de conta de teste: saída R$ 42,50
- 07/11/2026 Transferência recebida de Conta Teste: entrada R$ 300,00
- 07/11/2026 Tarifa de serviço: saída R$ 2,99
- 08/11/2026 Devolução de compra fictícia: entrada R$ 18,00

### OFX genérico — `ofx/extrato_conta_generico_ficticio.ofx`
4 lançamentos: +R$ 150,00, -R$ 3,75, +R$ 80,00, -R$ 25,50 nas datas 03 e 04/11/2026.

## Limitações deliberadas

- Os CSVs são modelos de teste inventados, não garantem compatibilidade com toda exportação real InfinitePay/Mercado Pago.
- O adaptador OFX genérico lê blocos `<STMTTRN>` padronizados. Arquivos com variantes incomuns precisam de amostra real para ajuste.
- O app ainda não implementa um parser XLSX nativo; arquivos `.xlsx` não devem ser selecionados nesta versão.
- PDF de InfinitePay/Mercado Pago ainda depende de adaptador de layout específico; a expansão inicial está em CSV/OFX.
- Não existe treinamento de IA nesses arquivos: são testes determinísticos com resultado esperado conhecido.
