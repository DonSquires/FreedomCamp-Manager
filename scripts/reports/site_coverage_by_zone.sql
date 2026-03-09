-- Site coverage report by jurisdiction zone
-- Usage: run in Supabase SQL editor

select
  o.name as organization,
  z_general.name as jurisdiction_zone,
  count(z_specific.id) as total_specific_sites,
  count(z_specific.id) filter (where z_specific.name ilike 'Crown:%') as crown_sites,
  count(z_specific.id) filter (where z_specific.description ilike '%Council:%') as council_feed_sites,
  count(z_specific.id) filter (where z_specific.description ilike '%Restriction:%') as freedom_camping_restriction_sites,
  count(z_specific.id) filter (where z_specific.description ilike '%Scenario%') as campsite_style_sites,
  count(z_specific.id) filter (where z_specific.description ilike '%hut%') as hut_style_sites
from zones z_general
join organizations o on o.id = z_general.organization_id
left join zones z_specific
  on z_specific.parent_zone_id = z_general.id
 and z_specific.zone_type = 'specific'
where z_general.zone_type = 'general'
group by o.name, z_general.name
order by o.name;

-- Unparented specific sites (should be reviewed)
select id, name, organization_id, parent_zone_id
from zones
where zone_type = 'specific'
  and (parent_zone_id is null)
order by name;
