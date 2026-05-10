# Nelson City Council Service Map

## Purpose

This document normalizes the service proposal excerpt into CRM, LOI, and site terms so it can be imported and reviewed consistently.

## Client Organization

- Client CRM organization: Nelson City Council
- Contract type: council security services / facilities management
- Site records must always be linked to this CRM client before they can be saved.

## Domain Mapping

- Organization record: Nelson City Council
- Site record: the facility or service location under contract
- LOI record: the canonical address/place record for the facility
- Zone record: only used where a service area or operational boundary still needs a polygon bridge
- Ad hoc callout location: a site or LOI without a scheduled patrol frequency, but still requiring response handling

## Facilities and Service Mapping

All named Tahunanui and Founders Park locations in this proposal are site records for Nelson City Council and should be treated as CRM-linked site/LOI records, even where the operational service is ad hoc or callout-only.

### 3.27 Tahunanui Reserve Toilets

- Facility group: Tahunanui Reserve Toilets
- Service: 1.2 Lock and Unlock Gates / toilets
- Standard: 2.2 Frequency A
- Included locations:
  - Lions Playground Toilet
  - Sports Field Toilet/Changing Shed
  - Beach Cafe Toilet
  - BMX track/Modellers Playground Toilet
  - Rear Roller Skating Rink Toilet
- Recommended model:
  - One parent LOI for Tahunanui Reserve
  - Child site/service locations for each toilet location if operationally tracked separately
  - Lock/unlock action records tied to the LOI and client organization

### 3.28 Adhoc Security Breach and Callouts Only

- Service: 1.3 Respond to an alarm or security breach
- Standard: 2.3.1 Standard A
- Included callout-only locations:
  - Founders Park
  - 27 Bridge Street
  - Wakapuaka Cremitorium

## Import Guidance

- Create or reuse the Nelson City Council CRM organization first.
- Create LOIs for each named site before creating site/service records.
- Keep ad hoc callout-only locations as LOIs if they do not have a repeat patrol pattern.
- Preserve any photo/evidence attachments separately from the site/location record.
- For XLSX imports, map the source row into:
  - client organization
  - facility/site name
  - address
  - service type
  - frequency/standard
  - operational notes

## Notes

- The proposal excerpt suggests some locations are facilities with scheduled services, while others are callout-only.
- This is best modelled as CRM client + LOI + site/service association, not as a free-text note on the contract alone.
