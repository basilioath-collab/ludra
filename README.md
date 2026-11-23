# Ludra Party

Agenda privada de disponibilidade para um grupo de Aion 2. Datas e horários exibidos em America/Sao_Paulo são gravados como instantes UTC. Personagens podem compartilhar o mesmo nick, região e servidor entre identidades. A administração identifica possíveis duplicatas. A agenda conta pessoas distintas mesmo quando alguém disponibiliza vários personagens.

A busca oficial não está integrada. As tentativas de acesso aos domínios consultados retornaram bloqueio do proxy, então não houve resposta do arsenal para validar busca, perfil, Global/SA, retrato, CP ou GS. As fichas usam preenchimento manual identificado, preservam campos ausentes e não consultam serviços externos de personagens.

## Desenvolvimento

Use Node.js 24 e npm. O Supabase CLI local requer Docker e acesso aos registros de imagens.

```sh
npm ci
supabase start
cp .env.example .env.local
```

Preencha `.env.local` com a URL local, a chave pública e a chave privilegiada da instância local. O Supabase local lê `supabase/config.toml` e aplica as migrations em `supabase/migrations`.

```sh
node --env-file=.env.local scripts/create-group.mjs http://localhost:3000
npm run dev
npm test
npm run build
npm run typecheck
```

Abra o convite armazenado em `.env.group-links`. O script cria um grupo e escreve os dois links em um arquivo ignorado pelo Git com permissão 0600. Ele recusa sobrescrever uma cópia existente. Guarde o arquivo em local seguro. Só compartilhe o link de convite. Suas alterações na agenda aparecem após atualizar a página ou usar **Atualizar**.

## Supabase Free

1. Crie um projeto no plano **Free** e aplique a migration versionada.
2. Em **Authentication → Sign In / Providers**, habilite **Anonymous Sign-Ins**. Em **Attack Protection**, desative **Enable Captcha protection**.
3. Entre pelo convite em um navegador sem sessão. A agenda exige uma sessão anônima e um vínculo com o grupo. As operações usam permissões no backend e limites persistidos no banco.

## Vercel Hobby

1. Importe o repositório GitHub em um escopo pessoal **Hobby**. Selecione Next.js e Node.js 24.x. O site não necessita de Vercel Analytics, cron ou integrações pagas.
2. Configure em **Settings → Environment Variables** as variáveis de produção abaixo e faça o deploy. A URL e a chave pública do Supabase estão em **Connect / API Keys**. Use a chave legada `anon` no cliente e a `service_role` exclusivamente no servidor. A chave pública é embutida no build. Alterações nela exigem novo deploy.

   | Variável | Valor |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | URL HTTPS do projeto Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública legada `anon` do projeto |
   | `SUPABASE_SERVICE_ROLE_KEY` | Chave privilegiada, marcada como sensível |
   | `RATE_LIMIT_SECRET` | Segredo do servidor gerado com `openssl rand -hex 32` |

3. Execute `node --env-file=.env.local scripts/create-group.mjs https://DOMINIO` com as variáveis do projeto autorizado. Abra o **convite** em dois navegadores independentes, adicione uma ficha e registre uma janela em cada. Recarregue e confirme a disponibilidade compartilhada e a impossibilidade de editar os registros do outro. Teste o link pessoal em um terceiro navegador, inclusive a rejeição de reutilização. Use o link separado de administração para moderar personagens e revogar ou regenerar o convite.
4. Com as verificações concluídas, copie o link **convite** para o WhatsApp e fixe a mensagem no grupo. O domínio sem o fragmento não concede acesso.

## Banco e cópias

As tabelas têm RLS e não são acessíveis pelas chaves do cliente. O backend valida a sessão anônima antes de chamar RPCs restritas ao papel de serviço. A identidade estável do grupo é `membership`. Recuperar acesso troca a identidade Auth associada, preserva os registros, revoga o aparelho anterior e emite um novo link. Convites revogados deixam de aceitar novas entradas. Membros existentes preservam acesso.

Exporte o esquema e os dados com ferramentas compatíveis com a versão do Postgres. Em um destino Supabase novo, aplique as migrations primeiro. Para preservar a conta vinculada e permitir recuperação, copie somente os usuários Auth anônimos referenciados por `public.memberships`, mantendo seus UUIDs. Copie depois, nesta ordem, `groups`, `memberships`, `characters`, `availability_windows` e `recovery_tokens`. As sessões antigas são específicas do projeto de origem. Use os links de recuperação ou um procedimento administrativo de migração para reassociar o acesso no novo projeto. Limites transitórios de `rate_limit_buckets` podem ser descartados. Use o procedimento de [backup e restauração do Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase) para manter os schemas gerenciados compatíveis. Trate dumps, chaves e links como dados privados.
