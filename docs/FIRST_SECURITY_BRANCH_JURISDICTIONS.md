# First Security Branch Jurisdictions

Canonical branch-to-region coverage map for First Security as a national service provider.

Use this map when:
- assigning the correct delivery branch for a council or client
- choosing the service-provider branch context for bootstrap/import scripts
- evaluating branch-level jurisdiction, patrol, and reporting scope

Coverage map:
- First Security - Nelson
  - Nelson
  - Tasman
- First Security - Blenheim
  - Marlborough
- First Security - Christchurch
  - North Canterbury
  - Central Canterbury
- First Security - Timaru
  - South Canterbury
- First Security - Ashburton
  - Ashburton District
- First Security - Queenstown
  - Central Otago
- First Security - Invercargill
  - Southland
- First Security - Dunedin
  - Otago
- First Security - Oamaru
  - North Otago
- First Security - Greymouth
  - Buller
  - Grey
  - Westland

Implementation note:
- This canonical map supersedes older historical comments in some migrations where branch boundaries were described differently.
- Keep the org tree national and model local service delivery through branch context, client orgs, sites, zones, and contract profiles rather than council-specific code forks.
