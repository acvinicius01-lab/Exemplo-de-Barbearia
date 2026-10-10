# Publicação e domínio

## Estado da entrega

O painel, os testes, o Dockerfile e o Blueprint do Render estão preparados. Esses arquivos não criam uma conta, não contratam hospedagem e não registram um domínio. O endereço permanente só existe após um deploy bem-sucedido na sua conta.

## Publicar no Render

O SQLite precisa de um disco persistente. O `render.yaml` configura um serviço **pago** com 0,5 CPU/512 MB e disco de 1 GB. Revise os valores mostrados pelo Render antes de confirmar a criação. Não use o plano gratuito com este banco: o sistema de arquivos temporário pode perder as reservas.

1. Crie ou entre na sua conta em https://dashboard.render.com.
2. Abra https://render.com/deploy?repo=https://github.com/acvinicius01-lab/Exemplo-de-Barbearia.
3. Conecte o repositório e revise o Blueprint, o disco e o custo.
4. Após a criação, aguarde o deploy terminar e abra a URL `https://<nome-do-serviço>.onrender.com` retornada pelo Render.
5. No painel do serviço, consulte a variável `ADMIN_PASSWORD` gerada. Use-a na página `/admin`. Não copie a senha para o GitHub.
6. Confira `/health`, abra a página e faça uma reserva de teste. Entre em `/admin`, confira a reserva, bloqueie outro horário, verifique que ele desaparece da disponibilidade e então cancele o teste e remova o bloqueio.

Os testes do GitHub Actions são executados a cada push/PR. O Blueprint está configurado para aguardar verificações aprovadas antes do deploy automático. O disco permanece no mesmo serviço durante os próximos deploys.

A imagem Docker também tem uma etapa de build no GitHub Actions. O Docker não está instalado no ambiente local desta entrega; o build da imagem precisa ser validado por essa etapa antes da publicação permanente.

O banco da hospedagem começa vazio. As reservas locais não são enviadas pelo Git. Para migrar reservas reais, planeje uma transferência privada e um backup do SQLite com o servidor parado; não inclua o banco em commits. Não exclua o disco para atualizar o site.

## Domínio

Você pode usar inicialmente o endereço `onrender.com`. Para ter um domínio próprio, registre um domínio na sua conta de um registrador e depois:

1. No serviço Render, abra **Settings → Custom Domains** e adicione o domínio registrado.
2. No registrador, configure exatamente os registros DNS que o Render indicar. Os valores dependem do seu domínio e serviço, por isso não há registros fictícios neste projeto.
3. Verifique o domínio no Render e aguarde o certificado HTTPS antes de anunciar o endereço.

Nenhum domínio próprio foi comprado ou configurado nesta entrega.

## Administração

- Sessões duram 8 horas e são encerradas quando o servidor reinicia.
- Logout invalida a sessão no servidor.
- Cinco falhas de login por endereço de conexão suspendem novas tentativas por 10 minutos. Atrás de um proxy, os acessos podem compartilhar esse limite, pois o servidor não confia em cabeçalhos de IP arbitrários.
- Cookies são `HttpOnly`, `SameSite=Strict` e `Secure` quando a conexão externa usa HTTPS.
- A senha é verificada com scrypt. Em produção, defina `ADMIN_PASSWORD` ou `ADMIN_PASSWORD_HASH` pela hospedagem; sem essa configuração, o login fica desativado.
- Existe um único acesso administrativo nesta versão. Não há contas individuais, recuperação por e-mail ou histórico de auditoria.
- Bloquear um horário com cliente retorna conflito. Cancele a reserva conscientemente antes de bloqueá-lo.

## Alternativa Docker

```sh
docker build -t nelson-barbearia .
docker run --env-file .env -p 3000:3000 -v nelson-reservas:/app/data nelson-barbearia
```

No `.env`, defina `NODE_ENV=production` e `ADMIN_PASSWORD` com uma senha forte. Não publique a porta diretamente para produção sem HTTPS no proxy. O volume `nelson-reservas` mantém o SQLite fora do ciclo de vida do contêiner.

## Referências oficiais

- https://render.com/docs/blueprint-spec
- https://render.com/docs/compute-plans
- https://render.com/docs/disks
- https://render.com/docs/custom-domains
