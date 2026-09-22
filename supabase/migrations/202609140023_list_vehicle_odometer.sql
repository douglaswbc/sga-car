create function public.list_vehicle_odometer_entries(target_organization_id uuid, target_vehicle_id uuid)
returns table (id uuid, recorded_on date, odometer_km integer, note text, created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
 return query select id,recorded_on,odometer_km,note,created_at from public.vehicle_odometer_entries where organization_id=target_organization_id and vehicle_id=target_vehicle_id order by recorded_on desc,created_at desc;
end; $$;
revoke all on function public.list_vehicle_odometer_entries(uuid,uuid) from public;
grant execute on function public.list_vehicle_odometer_entries(uuid,uuid) to authenticated;
