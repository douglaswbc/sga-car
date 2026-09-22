create table public.meta_whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(code) between 3 and 100),
  name text not null unique check (char_length(name) between 3 and 512),
  body text not null check (char_length(btrim(body)) between 1 and 1024),
  scheduled_at time not null,
  status text not null default 'local' check (status in ('local', 'pending', 'approved', 'rejected', 'paused', 'disabled', 'unknown')),
  meta_template_id text,
  rejection_reason text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger meta_whatsapp_templates_set_updated_at before update on public.meta_whatsapp_templates for each row execute function public.set_updated_at();
alter table public.meta_whatsapp_templates enable row level security;
create policy meta_whatsapp_templates_read_active_member on public.meta_whatsapp_templates for select to authenticated using (exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id where m.user_id = auth.uid() and o.status = 'active'));

insert into public.meta_whatsapp_templates (code, name, body, scheduled_at) values
('daily_invoice_2000', 'sga_daily_invoice_2000', 'Olá, {{1}}. O boleto/Pix da sua diária de locação já está disponível. Lembramos que a manutenção preventiva e o desgaste dos pneus são de responsabilidade do locatário. Garanta o pagamento para evitar restrições: {{2}}.', '20:00'),
('payment_reminder_2030', 'sga_payment_reminder_2030', 'Oi, {{1}}. Identificamos que o boleto da diária segue aguardando pagamento. Evite o bloqueio sistêmico do veículo realizando o pagamento no link: {{2}}.', '20:30'),
('pending_alert_2100', 'sga_pending_alert_2100', 'Atenção, {{1}}: seu boleto da locação continua pendente. Regularize o saldo agora para evitar o bloqueio preventivo do veículo: {{2}}.', '21:00'),
('scheduled_block_2130', 'sga_scheduled_block_2130', 'Aviso importante: O bloqueio do veículo está programado no sistema devido à ausência de pagamento da diária. Evite transtornos efetuando o pagamento: {{1}}.', '21:30'),
('critical_security_2200', 'sga_critical_security_2200', 'AVISO DE SEGURANÇA: Pagamento pendente. O veículo {{1}} será bloqueado sistemicamente a qualquer momento por quebra de contrato. Regularize imediatamente.', '22:00'),
('penultimate_notice_2230', 'sga_penultimate_notice_2230', 'Este é o último alerta amigável sobre a pendência da sua diária de locação. O bloqueio remoto do veículo está em andamento. Link para pagamento: {{1}}.', '22:30'),
('final_notice_2300', 'sga_final_notice_2300', 'ÚLTIMO AVISO! Fatura não compensada. O bloqueio total dos serviços e do veículo é iminente. Entre em contato ou pague agora: {{1}}.', '23:00')
on conflict (code) do update set body = excluded.body, scheduled_at = excluded.scheduled_at;

revoke all on table public.meta_whatsapp_templates from public;
grant select on table public.meta_whatsapp_templates to authenticated;
