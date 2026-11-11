# Cifra

<p align="center">
  <img src="assets/images/icon.png" alt="Ícone do Cifra" width="128" />
</p>

<h1 align="center">Cifra</h1>
<p align="center"><strong>Controle financeiro pessoal, simples, completo e offline.</strong></p>

<p align="center">
  <img alt="Expo" src="https://img.shields.io/badge/Expo-58-000020?logo=expo" />
  <img alt="React Native" src="https://img.shields.io/badge/React_Native-0.88-61DAFB?logo=react" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript" />
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-local-003B57?logo=sqlite" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-purple.svg" />
</p>

Cifra é um aplicativo mobile de finanças pessoais desenvolvido com **React Native, Expo, TypeScript e SQLite**. A proposta é reunir contas, movimentações, cartões, faturas, empréstimos e planejamento em uma interface única, com armazenamento local no dispositivo.

> **Estado do projeto:** em desenvolvimento. O aplicativo é voltado a uso pessoal/educacional; valide os dados importados e mantenha backups regulares.

## Funcionalidades

- **Dashboard:** visão consolidada de saldos, receitas, despesas e movimentações recentes.
- **Contas:** organização de contas e saldos por instituição.
- **Movimentações:** registro de receitas, despesas, transferências e operações relacionadas a cartões e empréstimos.
- **Cartões e faturas:** acompanhamento de compras, faturas e pagamentos, incluindo pagamentos parciais.
- **Importação de extratos:** leitura e revisão de arquivos CSV, OFX e PDF suportados pelo motor de importação.
- **Conciliação:** identificação conservadora de transferências e sugestões de associação de estornos.
- **Empréstimos:** controle de valores emprestados e tomados, parcelas, recebimentos/pagamentos parciais e saldo pendente.
- **Orçamentos:** limites mensais por categoria.
- **Despesas recorrentes:** cadastro de compromissos e previsão nominal.
- **Calendário financeiro:** visualização de faturas, parcelas, recorrências e vencimentos.
- **Relatórios:** análise por período e categoria.
- **Backup local:** exportação do banco SQLite pelo próprio aplicativo.

## Tecnologias

| Tecnologia | Uso |
|---|---|
| React Native | Interface mobile |
| Expo SDK 58 | Ambiente e módulos nativos |
| Expo Router | Navegação baseada em arquivos |
| TypeScript | Tipagem estática |
| expo-sqlite | Persistência local SQLite |
| React Query | Gerenciamento de dados assíncronos |
| Zustand | Estado compartilhado |
| pako | Descompressão usada na leitura de documentos |

## Requisitos

- Node.js LTS compatível com o Expo SDK utilizado.
- npm.
- Expo Go compatível com o SDK do projeto para executar no dispositivo; caso o Expo Go disponível não seja compatível, será necessário um development build.

## Instalação e execução

```bash
# Clone o repositório
git clone https://github.com/SEU-USUARIO/cifra.git
cd cifra

# Instale as dependências
npm install

# Verifique os tipos
npm run typecheck

# Inicie o Expo
npx expo start
```

Para iniciar limpando o cache do Metro:

```bash
npx expo start -c
```

Leia o QR Code com o Expo Go no celular. Para conexão local, computador e celular devem estar na mesma rede Wi-Fi.

## Estrutura do projeto

```text
cifra/
├── assets/
│   └── images/             # Ícones e imagens do aplicativo
├── docs/                   # Arquitetura e documentação técnica
├── src/
│   ├── app/                # Telas e rotas (Expo Router)
│   ├── components/         # Componentes reutilizáveis
│   ├── constants/          # Constantes e tema
│   ├── db/                 # Schema e migrations SQLite
│   ├── features/           # Funcionalidades por domínio
│   ├── hooks/              # Hooks personalizados
│   ├── theme/              # Cores e estilos globais
│   └── utils/              # Funções auxiliares
├── app.json                # Configuração Expo
├── package.json
├── package-lock.json
└── tsconfig.json
```

## Armazenamento e privacidade

- Os dados financeiros são armazenados localmente no banco SQLite privado do aplicativo.
- O banco é inicializado e atualizado pelas migrations em `src/db/migrations.ts`.
- O repositório **não inclui um banco pessoal**. Cada instalação cria seu próprio banco local.
- Arquivos `.db`, `.sqlite`, backups e arquivos `.env` são ignorados pelo Git.
- Importações devem ser revisadas antes da confirmação. O formato e os dados disponíveis variam conforme a instituição e o documento.
- Faça backup antes de reinstalar o aplicativo, limpar os dados do Expo ou trocar de dispositivo.

## Regras financeiras importantes

- Transferências entre contas próprias não são tratadas como receita ou despesa.
- O pagamento da fatura não duplica as despesas já registradas pelas compras do cartão.
- Estornos de despesas reduzem despesas; estornos de receitas reduzem receitas.
- A associação automática é conservadora: casos ambíguos devem ser revisados manualmente.

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Regras financeiras](docs/V14_REGRAS_FINANCEIRAS.md)
- [Adaptadores de importação](docs/ADAPTADORES_INFINITEPAY_MERCADOPAGO.md)
- [Plano de testes de importação](docs/IMPORT_TEST_PLAN_V3.md)

## Contribuição

Sugestões e melhorias são bem-vindas. Antes de abrir uma alteração:

1. Explique o problema ou melhoria.
2. Mantenha as migrations SQLite compatíveis com os bancos existentes.
3. Não inclua dados financeiros reais, credenciais ou backups.
4. Execute `npm run typecheck` e teste os fluxos afetados.

## Licença

Distribuído sob a licença MIT. Consulte [LICENSE](LICENSE).
