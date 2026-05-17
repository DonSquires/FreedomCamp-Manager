# Multi-Client Operations Sample Ingest (2026-05-17)

Grounded source datasets:
- tmp/docs/storage-review/005_Service-Contracts__Deputy-Data_Deputy_Location-sites-patrol_zones.csv.txt
- tmp/docs/storage-review/006_Service-Contracts__Deputy-Data_Deputy_data.csv.txt
- tmp/docs/storage-review/026_Service-Contracts__Wilsar-Data_Nelsn_Alarm-Noise_control_historical_data.csv.txt
- tmp/docs/storage-review/027_Service-Contracts__Wilsar-Data_Nelson_Patrol_Historical_data.csv.txt

## Dataset volumes
- Deputy roster/location rows: 500
- Deputy timesheet/schedule rows: 500
- Alarm/noise response rows: 2596
- Patrol history rows: 44902

## Staff and rostering sample (Deputy)
- Unique staff (Display Name): 39
- Unique pay centers: 2
- Top roster areas by shifts: Patrols (206); Site Inducted (34); Call Centre Ord Time (30); Ordinary Time (28); EMS (26); Bravo (18); Supervisor (17); NCR (17); Alpha (15); Salary - WFP (15)
- Top positions by shifts: Patrols (14); Static guard (9)

## Alarm and noise operations sample (Wilsar)
- Unique clients in alarm/noise dataset: 250
- Mean response time (mins): 36.3
- Mean on-site time (mins): 11.54
- Responses over 30 mins: 1006/2596
- Top clients by alarm/noise events: NELSON NOISE CONTROL (1021); WAIMEA COLLEGE (121); NELSON BRANCH #2 (78); NELSON BRANCH #1 (58); BROADGREEN INTERMEDIATE (51); TERRA CAT (48); NAYLAND COLLEGE (42); WAIMEA INTERMEDIATE (40); STORAGE WORLD (40); ST JOSEPHS SCHOOL (39); NAYLAND DENTAL CLINIC (37); NELSON #2 (32)

## Patrol operations sample (Wilsar)
- Unique clients in patrol dataset: 64
- Incident-report flagged patrols: 820
- Patrol completion status distribution: Completed (42817); Missed (2083)
- Top clients by patrol volume: MOBILE OFFICER BREAK NELSON (2984); CAWTHRON INSTITUTE HALIFAX (1808); WASHBOURNE GARDENS (1495); ERNEST RUTHERFORD RETIREMENT VILLAGE (RYMAN HEALTHCARE) (1495); COMPASS FRUIT - NAYLAND RD (1495); MANUKA STREET HOSPITAL LTD (1494); COMPASS FRUIT - BEACH RD (1492); FULTON HOGAN NELSON (1156); PROPER CRISPS (1155); COASTAL VIEW LIMITED (1133); ALARON PRODUCTS LTD - OFFICES (998); NELMAC LTD (998)

## Multi-client signal
- Unique clients across alarm/noise and patrol datasets: 285
- Data confirms mixed client portfolio operations, with real staff, rosters, dispatch zones, and service events suitable for contract-profile-driven runtime configuration.

## Product alignment implications
- Contract profile imports should include service-type SLA defaults by client and dispatch zone.
- Staff/roster context should be linked to dispatch resources for response accountability and cost reporting.
- Report packs should include response-time distributions, patrol completion statuses, and incident-report counts per client contract.
- D365 cost-centre mapping should be validated against pay center and client/contract references prior to invoicing export.