alter table public.inventory_adjustments
  add column package_description text null,
  add column unit text not null default 'unidad';
alter table public.inventory_adjustments
  add constraint inventory_adjustments_package_length check (package_description is null or char_length(package_description) <= 180),
  add constraint inventory_adjustments_unit_length check (char_length(unit) between 1 and 40);
