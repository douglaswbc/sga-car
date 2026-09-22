create function public.update_vehicle_maintenance_status(target_organization_id uuid, target_maintenance_id uuid, target_status public.maintenance_status, completion_date date, completion_odometer_km integer)
returns public.vehicle_maintenances language plpgsql security definer set search_path=public as $$
declare maintenance public.vehicle_maintenances;
begin
 if not public.has_organization_role(target_organization_id,array['owner','admin','operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
 update public.vehicle_maintenances set status=target_status,completed_on=case when target_status='completed' then completion_date else null end,completed_odometer_km=case when target_status='completed' then completion_odometer_km else null end where id=target_maintenance_id and organization_id=target_organization_id and status in ('scheduled','in_progress') returning * into maintenance;
 if maintenance.id is null then raise exception 'maintenance not found or cannot transition'; end if;
 if target_status='completed' then update public.vehicles set odometer_km=greatest(odometer_km,completion_odometer_km) where id=maintenance.vehicle_id and organization_id=target_organization_id; end if;
 return maintenance;
end; $$;
revoke all on function public.update_vehicle_maintenance_status(uuid,uuid,public.maintenance_status,date,integer) from public;
grant execute on function public.update_vehicle_maintenance_status(uuid,uuid,public.maintenance_status,date,integer) to authenticated;
