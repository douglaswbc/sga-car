alter table public.zernio_connect_sessions
  add column if not exists api_key_ciphertext text,
  add column if not exists return_path text not null default '/comunicacao/canais';

comment on column public.zernio_connect_sessions.api_key_ciphertext is
  'API key temporária cifrada para concluir o onboarding antes de existir uma conta conectada.';
comment on column public.zernio_connect_sessions.return_path is
  'Caminho interno para retornar ao usuário após o callback da conexão.';
