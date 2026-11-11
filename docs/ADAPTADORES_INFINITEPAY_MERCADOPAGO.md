# Adaptadores iniciais: InfinitePay e Mercado Pago

Esta versão adiciona suporte inicial a arquivos CSV e OFX compatíveis com o padrão de extrato. O leitor não afirma reproduzir os layouts oficiais atuais das instituições: os arquivos de teste anexos são sintéticos, criados para validar o contrato de importação.

## Cobertura desta versão
- CSV com colunas data, descrição, valor e tipo.
- CSV com colunas separadas de crédito e débito.
- Datas ISO (`YYYY-MM-DD`) e brasileiras (`DD/MM/YYYY`).
- Valores brasileiros (`1.234,56`) e decimais com ponto (`1234.56`).
- OFX com blocos `<STMTTRN>`, datas `DTPOSTED`, valores `TRNAMT` e descrições `MEMO`/`NAME`.
- Seleção manual de InfinitePay/Mercado Pago na tela de importação e detecção pelo nome/conteúdo do arquivo.

## Fora do escopo ainda
- XLSX não está implementado.
- PDF de InfinitePay/Mercado Pago não possui parser específico.
- A classificação de operações desses bancos ainda é conservadora; revisar tipo/categoria antes de confirmar.
- Transferência própria só é identificada automaticamente quando a descrição indica explicitamente isso.

Consulte `docs/test-fixtures/LEIA-ME.md` para o gabarito dos documentos fictícios.
