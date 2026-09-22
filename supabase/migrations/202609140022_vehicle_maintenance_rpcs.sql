create function public.create_vehicle_maintenance(target_organization_id uuid, target_vehicle_id uuid, maintenance_type public.maintenance_type, maintenance_title text, maintenance_scheduled_on date, maintenance_scheduled_odometer_km integer, maintenance_cost numeric, maintenance_notes text)
returns public.vehicle_maintenances language plpgsql security definer set search_path=public as $$
declare maintenance public.vehicle_maintenances;
begin
 if not public.has_organization_role(target_organization_id,array['owner','admin','operations']::public.organization_role[]) then raise exception 'operator role is required'; end if;
 if not exists(select 1 from public.vehicles where id=target_vehicle_id and organization_id=target_organization_id) then raise exception 'vehicle not found'; end if;
 insert into public.vehicle_maintenances(organization_id,vehicle_id,type,title,scheduled_on,scheduled_odometer_km,cost,notes) values(target_organization_id,target_vehicle_id,maintenance_type,trim(maintenance_title),maintenance_scheduled_on,maintenance_scheduled_odometer_km,maintenance_cost,nullif(trim(maintenance_notes),'')) returning * into maintenance;
 return maintenance;
end; $$;
create function public.list_vehicle_maintenance(target_organization_id uuid, target_vehicle_id uuid)
returns table(id uuid,type public.maintenance_type,status public.maintenance_status,title text,scheduled_on date,completed_on date,scheduled_odometer_km integer,cost numeric,notes text) language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_active_organization_member(target_organization_id) then raise exception 'active organization membership is required'; end if;
 return query select id,type,status,title,scheduled_on,completed_on,scheduled_odometer_km,cost,notes from public.vehicle_maintenances where organization_id=target_organization_id and vehicle_id=target_vehicle_id order by scheduled_on desc;
end; $$;
revoke all on function public.create_vehicle_maintenance(uuid,uuid,public.maintenance_type,text,date,integer,numeric,text),public.list_vehicle_maintenance(uuid,uuid) from public;
grant execute on function public.create_vehicle_maintenance(uuid,uuid,public.maintenance_type,text,date,integer,numeric,text),public.list_vehicle_maintenance(uuid,uuid) to authenticated;
