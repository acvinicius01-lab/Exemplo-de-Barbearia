# Linha Fina — exemplo funcional

Design baseado nos arquivos fornecidos, com HTML, CSS, JavaScript e servidor Node.js sem dependências externas.

## Como executar

Instale Node.js 20 ou superior. Abra um terminal nesta pasta e execute:

```sh
npm start
```

Acesse http://localhost:3000. Não abra index.html diretamente: a agenda precisa do servidor.

## Funcionalidades

- Navegação responsiva e seleção de serviço.
- Calendário mensal, dias fechados e horários passados bloqueados.
- Disponibilidade consultada no servidor.
- Reserva com nome, telefone com DDD, serviço, valor e código de confirmação.
- Bloqueio de reservas duplicadas, inclusive pedidos simultâneos na mesma instância.
- Consulta e cancelamento pelo código, liberando o horário.
- Cópia da confirmação.
- Persistência em data/reservas.json, inclusive após reiniciar o servidor.

Terça a sexta: 9h–19h; sábado: 9h–17h. Cada reserva ocupa uma hora. Fuso: America/Fortaleza.

## Personalização e limites

Edite index.html para textos e aparência. Serviços, valores e regras de horário estão em server.mjs. O endereço permanece fictício. Não há envio automático de WhatsApp, cobrança ou pagamentos. O código dá acesso à consulta e cancelamento: guarde-o com cuidado.

Este exemplo usa arquivo JSON e uma única instância de servidor, acessível apenas neste computador. Para publicação comercial, implemente banco transacional, HTTPS, controle de acesso e proteção contra abuso. Não publique a pasta data: ela contém informações dos clientes.
