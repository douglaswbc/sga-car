create or replace function public.update_vehicle(
  target_organization_id uuid, target_vehicle_id uuid, vehicle_plate text, vehicle_brand text, vehicle_model text,
  vehicle_category text, vehicle_model_year integer, vehicle_color text, vehicle_odometer_km integer, vehicle_status public.vehicle_status
)
returns public.vehicles language plpgsql security definer set search_path = public
as $$
declare updated_vehicle public.vehicles;
declare normalized_plate text := upper(regexp_replace(coalesce(vehicle_plate, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  if normalized_plate !~ '^[A-Z0-9]{7}$' then raise exception 'invalid plate'; end if;
  update public.vehicles
  set plate = normalized_plate, brand = btrim(vehicle_brand), model = btrim(vehicle_model), category = nullif(btrim(vehicle_category), ''),
      model_year = vehicle_model_year, color = nullif(btrim(vehicle_color), ''), odometer_km = coalesce(vehicle_odometer_km, 0), status = vehicle_status
  where id = target_vehicle_id and organization_id = target_organization_id
  returning * into updated_vehicle;
  if updated_vehicle.id is null then raise exception 'vehicle not found'; end if;
  return updated_vehicle;
end;
$$;

create or replace function public.delete_vehicle(target_organization_id uuid, target_vehicle_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_organization_role(target_organization_id, array['owner', 'admin', 'operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
  delete from public.vehicles where id = target_vehicle_id and organization_id = target_organization_id;
  if not found then raise exception 'vehicle not found'; end if;
end;
$$;

revoke all on function public.update_vehicle(uuid, uuid, text, text, text, text, integer, text, integer, public.vehicle_status) from public;
revoke all on function public.delete_vehicle(uuid, uuid) from public;
grant execute on function public.update_vehicle(uuid, uuid, text, text, text, text, integer, text, integer, public.vehicle_status) to authenticated;
grant execute on function public.delete_vehicle(uuid, uuid) to authenticated;
