# Arquitetura

## Visão geral

```text
React Native / Expo (iOS)
        |
        +-- Expo Router (telas)
        |
        +-- Features (contas, transações, empréstimos, relatórios)
        |
        +-- Repositories / Services
        |       |
        |       +-- expo-sqlite (finance.db)
        |       +-- expo-file-system (arquivos locais)
        |       +-- expo-document-picker (seleção de extratos)
        |       +-- expo-print / expo-sharing (PDF e compartilhamento)
        |
        +-- Zustand (estado de interface)
```

## Armazenamento

- `finance.db`: contas, categorias, movimentações, cartões, empréstimos, importações e configurações.
- Diretório privado do app: arquivos de extrato anexados, quando o usuário optar por preservá-los.
- Diretório temporário: arquivos gerados durante importação/exportação; limpar após uso quando seguro.

## Modelo financeiro

Todos os valores monetários usam centavos inteiros:
- R$ 12,34 => `1234`
- R$ 1.000,00 => `100000`

Datas de movimentação são armazenadas como ISO 8601 (`YYYY-MM-DD` para datas civis).
Timestamps técnicos usam UTC ISO 8601.

## Regras essenciais

1. Transferência entre contas não é receita nem despesa consolidada.
2. Compra no cartão é despesa na data da compra; pagamento da fatura liquida uma obrigação e não duplica a despesa.
3. Empréstimo concedido é valor a receber, não despesa de consumo.
4. Recebimento de principal de empréstimo não é nova receita; juros recebidos podem ser registrados separadamente.
5. Empréstimo recebido é obrigação, não receita recorrente.
6. Importações precisam de revisão e confirmação explícita.
7. Duplicidade deve ser sinalizada, nunca descartada silenciosamente.
8. Exclusões e alterações financeiras relevantes devem ser confirmadas.

## Backup

O backup manual deverá gerar um pacote versionado contendo:
- cópia consistente do SQLite;
- anexos selecionados;
- `manifest.json` com versão do formato, data de geração e lista de arquivos;
- checksum para validar integridade.

A restauração deverá validar o pacote antes de substituir os dados atuais e oferecer confirmação explícita.
