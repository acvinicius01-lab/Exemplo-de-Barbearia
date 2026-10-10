# Nelson Cabeleireiro — Beleza natural

Projeto refeito com HTML, CSS e JavaScript puro. O servidor também usa JavaScript (Node.js), com SQLite para armazenamento persistente e sem dependências de npm.

## Executar

Use Node.js **22.13 ou superior** (Node.js 24 recomendado para este projeto):

```sh
npm start
```

Abra **http://localhost:3000**. Não abra o HTML diretamente: a agenda precisa da API. No PowerShell, se `npm` for bloqueado pela política de scripts, use `npm.cmd start`.

## Organização

| Arquivo | Responsabilidade |
| --- | --- |
| `index.html` | Estrutura semântica da página e formulários |
| `styles.css` | Identidade visual, responsividade e acessibilidade |
| `app.js` | Calendário, escolha de serviço, formulários e comunicação com a API |
| `assets/brand.svg` | Símbolo da marca e favicon |
| `assets/barber-art.svg` | Ilustração vetorial local da barbearia |
| `services.mjs` | Serviços, descrições e preços usados pelo site e servidor |
| `server.mjs` | API, validação e entrega dos arquivos públicos |
| `database.mjs` | Persistência SQLite e migração do JSON |
| `tests/bookings.test.mjs` | Testes de migração e integração da API |

Os arquivos anteriores foram preservados em `assets/previous-*`, ignorados pelo Git e não servidos pela API. As fontes usam Google Fonts e têm alternativas locais quando a conexão não está disponível. As ilustrações não dependem de serviços externos.

## Painel administrativo

Abra `/admin` para gerenciar a agenda. No primeiro uso local, execute `npm run setup:admin` e reinicie o servidor. A senha gerada fica no arquivo privado `data/admin-access.txt`; ela não é enviada ao GitHub. O acesso local já foi configurado nesta entrega.

O painel permite escolher a data, consultar nome/telefone/serviço dos clientes, cancelar reservas com confirmação, bloquear horários livres com motivo interno e liberar bloqueios. Os bloqueios são persistidos e respeitados pela agenda pública. É necessário login para todas as operações e para consultar os dados administrativos.

Para hospedagem, domínio, acesso em produção e Docker, consulte [DEPLOY.md](DEPLOY.md). O Blueprint `render.yaml` e o workflow de testes do GitHub Actions acompanham o projeto.

## Funcionalidades

- Layout para computador e celular, com menu móvel.
- Serviços selecionáveis e resumo de preço e horário.
- Calendário no fuso `America/Fortaleza`, independente do fuso do dispositivo.
- Disponibilidade consultada no servidor; horários passados, domingo e segunda bloqueados.
- Reserva com nome, telefone com DDD e código de confirmação.
- Consulta e cancelamento pelo código, com confirmação antes de cancelar.
- Cópia da confirmação e mensagens para erros de conexão.
- Restrição `UNIQUE(date, time)` no banco para evitar duas reservas no mesmo horário.
- Arquivos públicos permitidos explicitamente: o banco e os dados dos clientes não são expostos por URL.

Cada serviço ocupa uma hora. Os horários começam às 9h, com último início às 18h de terça a sexta e às 16h no sábado. A navegação da agenda permite visualizar até seis meses à frente.

## Banco de dados e migração

Na primeira inicialização, o servidor cria `data/reservas.sqlite` e importa `data/reservas.json` numa transação. Preserva o JSON original, os dados e os códigos. Uma marca de migração impede nova importação após cancelamentos ou reinícios. Se houver dados inválidos ou horários duplicados no arquivo antigo, a migração falha sem apagar o JSON.

A partir da migração, novas reservas e cancelamentos são gravados **somente no SQLite**. O JSON antigo é uma cópia histórica; editar esse arquivo não atualiza a agenda.

Guarde o código da reserva: ele permite consultar e cancelar o agendamento. Não publique a pasta `data`, o arquivo `.env` nem cópias de banco. Para backup, pare o servidor e copie o banco; com ele em execução, use um procedimento de backup compatível com SQLite/WAL.

## Personalizar

- Marca, textos e Instagram: `index.html`.
- Cores, fontes e espaçamento: `styles.css`.
- Serviços e preços: `services.mjs`.
- Dias e horários: função `slots` em `server.mjs` e indicação visual em `app.js`/`index.html`.
- Porta e endereço de escuta: variáveis `PORT` e `HOST`.
- Caminho do banco: variável `DATABASE_PATH`.

O `.env.example` documenta as variáveis. O servidor não lê `.env` automaticamente. Para usá-lo, crie seu `.env` e execute:

```sh
node --env-file=.env server.mjs
```

## Verificar

O site e o painel compartilham `api-client.mjs`, que envia as credenciais da sessão, preserva os erros da API e trata falhas de rede/timeout sem repetir gravações. O botão de reserva só é liberado depois da consulta de disponibilidade e da seleção do horário. A agenda é atualizada após operações e ao retornar à aba.

Os layouts incluem ajustes para telas estreitas (320–420 px), celular (até 720 px), tablet e desktop: colunas flexíveis, filtros empilhados, campos de 16 px e controles de toque ampliados. A sessão atual não possui navegador disponível para inspeção visual; essas alterações ainda precisam de uma conferência visual em dispositivos reais.

```sh
npm run check
npm test
```

Os testes usam bancos temporários, sem alterar suas reservas. Verificam migração, reserva concorrente, persistência após reiniciar, consulta, cancelamento, validação de dados e bloqueio de acesso aos arquivos privados.

## Publicar na internet

Esta entrega é local, ainda não publicada. O projeto precisa de uma hospedagem que execute Node.js 22.13+ e forneça **volume persistente** para o banco. Configure `DATABASE_PATH` nesse volume, `PORT` conforme a hospedagem e HTTPS no domínio. Publique o servidor junto com os arquivos de interface; uma hospedagem apenas de HTML não executa esta API.

Para hospedar com disco temporário, funções sem servidor ou várias máquinas, adapte `database.mjs` para um banco compartilhado na nuvem. O SQLite atual é adequado a uma implantação com armazenamento local persistente; ele não cria automaticamente um banco na nuvem.

Antes de usar para atendimento real, confirme serviços, valores, endereço e horários com Nelson, substitua os avisos de demonstração, defina a política de privacidade e acrescente limites de requisição na hospedagem. Há painel administrativo protegido; não há pagamentos ou integração de WhatsApp nesta versão.

## Informações confirmadas e exemplos

Identidade: Barbearia Nelson Cabeleireiro; Nelson Pinheiro; frase “Beleza natural”; Instagram `@barbearia.nelsoncabeleireiro`. Foram mantidas as informações da versão anterior. Preços e horários são exemplos; corte infantil tem valor a consultar. Endereço e WhatsApp não foram informados. Reservas desta versão são testes.
