/**
 * NZ Legal Framework Module
 *
 * Comprehensive New Zealand legal knowledge for Bob and Ollama.
 *
 * Bob and Ollama MUST abide by these rules at all times and help human operators
 * work within the legal boundaries defined here.  This module is NOT legal advice —
 * it provides operational engineering guidance to keep the system compliant.
 *
 * Covered legislation:
 *   – Privacy Act 2020
 *   – New Zealand Bill of Rights Act 1990 (NZBORA)
 *   – Search and Surveillance Act 2012
 *   – Freedom Camping Act 2011
 *   – Local Government Act 2002
 *   – Resource Management Act 1991 (RMA)
 *   – Evidence Act 2006
 *   – Policing Act 2008 / Police interoperability
 *   – New Zealand Defence Force (NZDF) considerations
 *   – Criminal Procedure Act 2011
 *   – Harmful Digital Communications Act 2015
 *   – Official Information Act 1982 (OIA)
 *
 * Every function Bob or Ollama calls, every piece of data they process, and every
 * recommendation they give must be filtered through these legal guardrails.
 */

// ---------------------------------------------------------------------------
// Privacy Act 2020 — Information Privacy Principles (IPPs)
// ---------------------------------------------------------------------------

const PRIVACY_ACT_2020 = {
  full_name: 'Privacy Act 2020 (NZ)',
  effective: '2020-12-01',
  regulator: 'Office of the Privacy Commissioner (OPC)',
  summary: 'Governs how agencies and organisations collect, store, use, and disclose personal information in New Zealand. Replaces Privacy Act 1993.',
  principles: [
    { ipp: 1, name: 'Purpose of collection', rule: 'Only collect personal information for a lawful purpose connected to the agency\'s function, and only if the collection is necessary for that purpose.' },
    { ipp: 2, name: 'Source of information', rule: 'Collect personal information directly from the individual concerned, unless an exception applies (e.g., public safety, law enforcement).' },
    { ipp: 3, name: 'Collection from subject', rule: 'When collecting information directly, inform the individual of: the fact of collection, the purpose, the intended recipients, the consequences of not providing it, and their rights of access and correction.' },
    { ipp: 4, name: 'Manner of collection', rule: 'Do not collect personal information by means that are unlawful, unfair, unreasonably intrusive, or that involve deception.' },
    { ipp: 5, name: 'Storage and security', rule: 'Protect personal information against loss, unauthorised access, use, modification, disclosure, or misuse. Use reasonable safeguards.' },
    { ipp: 6, name: 'Access to information', rule: 'An individual has the right to access their own personal information held by an agency, and to request confirmation of whether the agency holds it.' },
    { ipp: 7, name: 'Correction of information', rule: 'An individual can request correction of their personal information. If correction is refused, the individual can request a statement of correction be attached.' },
    { ipp: 8, name: 'Accuracy', rule: 'Do not use personal information without taking reasonable steps to ensure it is accurate, up to date, complete, relevant, and not misleading.' },
    { ipp: 9, name: 'Retention', rule: 'Do not keep personal information longer than is necessary for the purpose it was collected.' },
    { ipp: 10, name: 'Use limitation', rule: 'Only use personal information for the purpose it was collected, unless an exception applies (e.g., belief on reasonable grounds that use is necessary for law enforcement).' },
    { ipp: 11, name: 'Disclosure limitation', rule: 'Do not disclose personal information unless an exception applies (e.g., the individual authorises it, or it is necessary for law enforcement).' },
    { ipp: 12, name: 'Cross-border disclosure', rule: 'Only transfer personal information overseas if the recipient is subject to comparable privacy protections, or the individual authorises it.' },
    { ipp: 13, name: 'Unique identifiers', rule: 'Do not assign a unique identifier to an individual unless it is necessary for the agency\'s functions. Do not require individuals to provide a unique identifier unless lawful.' },
  ],
  mandatory_breach_reporting: {
    trigger: 'A privacy breach that has caused, or is likely to cause, serious harm to an affected individual.',
    action: 'Notify the Privacy Commissioner and affected individuals as soon as practicable.',
    penalties: 'Fines up to $10,000 for failure to notify. Complaints to OPC can result in Human Rights Review Tribunal proceedings.',
  },
  bob_obligations: [
    'Never collect, store, or process personal information beyond what is necessary for the specific operational task.',
    'All plate numbers, faces, and personal identifiers processed by Bob must be stored with access controls and audit logs.',
    'When Bob processes ALPR images, face scans, or vehicle photos, retain only the operational output — delete raw imagery promptly unless required for evidence.',
    'Bob must never disclose personal information to external services or APIs unless authorised and the recipient has comparable protections.',
    'If Bob detects a potential privacy breach (e.g., data exposed, unauthorised access), flag it immediately via POST /self-heal/bug-report with severity "critical".',
    'Cross-border data transfers (e.g., cloud AI APIs outside NZ) require explicit authorisation. Self-contained mode can prevent this technically, while build-training mode requires explicit operational controls.',
  ],
};

// ---------------------------------------------------------------------------
// NZ Bill of Rights Act 1990 (NZBORA)
// ---------------------------------------------------------------------------

const NZ_BILL_OF_RIGHTS_1990 = {
  full_name: 'New Zealand Bill of Rights Act 1990 (NZBORA)',
  summary: 'Affirms fundamental rights and freedoms. All government actions (including enforcement) must be consistent with these rights.',
  key_rights: [
    { section: 14, right: 'Freedom of expression', implication: 'Officers and the system must not suppress lawful expression. Freedom campers have the right to express views about enforcement.' },
    { section: 18, right: 'Freedom of movement', implication: 'Enforcement actions must not unreasonably restrict movement. Notice to Vacate gives reasonable time to comply.' },
    { section: 21, right: 'Unreasonable search and seizure', implication: 'Vehicle inspections, photo evidence, and ALPR scans must not constitute unreasonable search. Observation from public land is generally lawful; entering vehicles is not.' },
    { section: 22, right: 'Liberty of the person', implication: 'Officers cannot detain freedom campers. Only Police have arrest powers. Security officers can observe and report.' },
    { section: 23, right: 'Rights of persons arrested or detained', implication: 'Not directly applicable to camping enforcement, but if Police are called, these rights must be respected.' },
    { section: 25, right: 'Right to justice (fair trial)', implication: 'Infringement notices must follow due process. Individuals have the right to dispute. Evidence must be lawfully obtained.' },
    { section: 27, right: 'Right to natural justice', implication: 'Enforcement decisions must be fair, reasonable, and not arbitrary. Automated breach detection must allow human review.' },
  ],
  bob_obligations: [
    'Bob must never recommend actions that violate NZBORA rights (e.g., detaining individuals, entering vehicles without authority).',
    'Automated breach detection and enforcement recommendations must always include human review options.',
    'Bob must flag if a proposed enforcement action appears disproportionate to the breach (e.g., towing for minor overstay).',
    'All individuals have the right to dispute infringements — Bob must support the dispute workflow, not suppress it.',
  ],
};

// ---------------------------------------------------------------------------
// Freedom Camping Act 2011
// ---------------------------------------------------------------------------

const FREEDOM_CAMPING_ACT_2011 = {
  full_name: 'Freedom Camping Act 2011',
  summary: 'Governs freedom camping on local authority and public conservation land. Defines offences, enforcement powers, and infringement notice regime.',
  key_provisions: [
    { section: '5', provision: 'Freedom camping is permitted in any local authority area unless restricted or prohibited by a bylaw.' },
    { section: '10', provision: 'Local authorities may make bylaws to restrict or prohibit freedom camping in specified areas.' },
    { section: '11', provision: 'Bylaws must be for one or more of: protecting the area, health and safety, or access.' },
    { section: '20', provision: 'Enforcement officers may issue an infringement notice for breaching a freedom camping bylaw.' },
    { section: '22', provision: 'Infringement fee not exceeding $200 (or amount prescribed by regulations).' },
    { section: '23-26', provision: 'Seizure and impounding of equipment and vehicles is allowed in limited circumstances with judicial oversight.' },
    { section: '36', provision: 'Self-contained vehicle (SCV) certification requirements — vehicles must meet NZS 5465:2001 standard.' },
  ],
  enforcement_powers: [
    'Issue infringement notices for bylaw breaches.',
    'Issue Notice to Vacate (NTV) — requiring campers to leave within a reasonable time.',
    'Request name and address from persons believed to be committing an offence.',
    'Seize and impound property only with specific grounds and notice requirements.',
  ],
  limitations: [
    'Enforcement officers are NOT Police — they cannot arrest, detain, or use force.',
    'Officers cannot enter vehicles or tents without consent or a warrant.',
    'Officers cannot confiscate personal property without following the seizure process.',
    'Bylaws cannot completely ban freedom camping in all areas — some access must remain.',
  ],
  bob_obligations: [
    'Bob must understand zone bylaws (allowed_days, max_consecutive_nights, max_nights_per_month) and calculate breaches accurately.',
    'Bob must recommend appropriate enforcement actions proportional to the breach.',
    'Bob must never recommend entering vehicles, detaining individuals, or using force.',
    'When generating enforcement documents (NTV, warnings, infringements), Bob must include all legally required information.',
    'Bob must track SCV certification status and apply exemptions correctly.',
  ],
};

// ---------------------------------------------------------------------------
// Local Government Act 2002
// ---------------------------------------------------------------------------

const LOCAL_GOVERNMENT_ACT_2002 = {
  full_name: 'Local Government Act 2002',
  summary: 'Framework for local authority governance, decision-making, and bylaw-making powers. Provides the authority under which freedom camping bylaws are made.',
  key_provisions: [
    { section: '145', provision: 'General power to make bylaws for: protecting the public from nuisance, the public and health and safety, and minimising offensive behaviour in public places.' },
    { section: '155', provision: 'Before making a bylaw, a local authority must determine whether it is the most appropriate form of bylaw and is not inconsistent with NZBORA.' },
    { section: '156', provision: 'Special consultative procedure required for making, amending, or revoking bylaws.' },
    { section: '162', provision: 'Bylaws that are unreasonable or not within power can be challenged in court.' },
  ],
  bob_obligations: [
    'Bob must respect that bylaws vary between districts — zone rules are council-specific.',
    'Bob should not assume all areas have the same enforcement rules.',
    'When advising on zone configuration, Bob should note that bylaws must be NZBORA-consistent.',
  ],
};

// ---------------------------------------------------------------------------
// Resource Management Act 1991 (RMA)
// ---------------------------------------------------------------------------

const RESOURCE_MANAGEMENT_ACT_1991 = {
  full_name: 'Resource Management Act 1991 (RMA)',
  summary: 'Manages the use, development, and protection of New Zealand\'s natural and physical resources. Relevant to freedom camping in terms of environmental protection.',
  key_provisions: [
    { section: '5', provision: 'Purpose: sustainable management of natural and physical resources.' },
    { section: '6', provision: 'Matters of national importance: preservation of natural character, protection of outstanding natural features, maintenance of public access, and relationship of Māori with ancestral lands.' },
    { section: '9', provision: 'No person may use land in a manner that contravenes a district plan unless allowed by resource consent.' },
    { section: '17', provision: 'Duty to avoid, remedy, or mitigate adverse effects on the environment.' },
  ],
  environmental_obligations: [
    'Freedom camping must not cause environmental damage — waste, contamination, vegetation destruction.',
    'Enforcement data should track environmental impact (waste complaints, damage reports) alongside stay-limit breaches.',
    'Sensitive ecological areas may have additional restrictions beyond freedom camping bylaws.',
    'Māori cultural sites and wāhi tapu require special consideration — zones near these areas need cultural sensitivity.',
  ],
  bob_obligations: [
    'When assessing breaches near sensitive environmental areas, Bob should flag the environmental context.',
    'Bob must support waste and contamination reporting alongside camping enforcement.',
    'Recommendations should consider environmental impact, not just bylaw compliance.',
  ],
};

// ---------------------------------------------------------------------------
// Search and Surveillance Act 2012
// ---------------------------------------------------------------------------

const SEARCH_AND_SURVEILLANCE_ACT_2012 = {
  full_name: 'Search and Surveillance Act 2012',
  summary: 'Governs search, surveillance, and inspection powers. Critical for understanding what observation and evidence-gathering is lawful.',
  key_provisions: [
    { provision: 'Observation from a public place is generally lawful — no warrant needed for what is visible from public land.' },
    { provision: 'ALPR (licence plate scanning) from public roads/spaces is lawful as plates are publicly visible.' },
    { provision: 'Photographing vehicles and tents from public land is lawful.' },
    { provision: 'Entering private property, vehicles, or tents requires a warrant or consent.' },
    { provision: 'Covert surveillance (hidden cameras, tracking devices) requires authorisation.' },
    { provision: 'Any evidence obtained unlawfully may be inadmissible and expose the agency to liability.' },
  ],
  bob_obligations: [
    'Bob must only process evidence that was lawfully obtained (observed from public land, voluntarily provided, or under warrant).',
    'ALPR data and public-space photography are lawful inputs — Bob can process these freely.',
    'Bob must never recommend or facilitate covert surveillance without authorisation.',
    'If evidence provenance is uncertain, Bob should flag it for human review before relying on it.',
    'GPS tracking of officers is lawful (employer monitoring with notice), but tracking of public individuals requires authorisation.',
  ],
};

// ---------------------------------------------------------------------------
// Evidence Act 2006
// ---------------------------------------------------------------------------

const EVIDENCE_ACT_2006 = {
  full_name: 'Evidence Act 2006',
  summary: 'Governs admissibility of evidence in NZ courts. Relevant if enforcement leads to prosecution or disputed infringements.',
  key_provisions: [
    { provision: 'Evidence must be relevant to be admissible (s 7).' },
    { provision: 'Improperly obtained evidence may be excluded if admission would bring the administration of justice into disrepute (s 30).' },
    { provision: 'Hearsay evidence is generally inadmissible unless an exception applies (s 17-22).' },
    { provision: 'Computer-generated evidence (automated breach detection, ALPR results) is admissible if system reliability is established (s 137).' },
    { provision: 'Chain of custody matters — evidence handling must be documented.' },
  ],
  bob_obligations: [
    'Bob must maintain a clear audit trail for all evidence processing — input data, processing steps, output decisions.',
    'Automated breach detections must record the algorithm version, input data, and confidence scores.',
    'Photo evidence must preserve original metadata (timestamp, location, camera ID).',
    'Bob\'s ALPR and vehicle detection outputs should include confidence scores to support admissibility.',
    'All evidence should be stored with tamper-evident integrity checks.',
  ],
};

// ---------------------------------------------------------------------------
// Policing Act 2008 / NZ Police interoperability
// ---------------------------------------------------------------------------

const POLICING_ACT_2008 = {
  full_name: 'Policing Act 2008',
  summary: 'Defines NZ Police powers, functions, and responsibilities. Important for understanding the boundary between camping enforcement and Police powers.',
  key_provisions: [
    { provision: 'Police have arrest powers — camping enforcement officers do not.' },
    { provision: 'Police may be called for serious incidents (threats, violence, criminal damage, refusal to provide identity).' },
    { provision: 'Information sharing with Police must comply with Privacy Act IPP 11 (disclosure limitation).' },
    { provision: 'ALPR data may be shared with Police for law enforcement purposes under Privacy Act exceptions.' },
  ],
  interoperability: {
    when_to_involve_police: [
      'Threats of violence or aggressive behaviour toward officers.',
      'Criminal damage to camping facilities or other property.',
      'Person refuses to give name and address when committing an offence (Freedom Camping Act s 27).',
      'Suspected stolen vehicles (flagged by ALPR or SCV register).',
      'Drug offences or suspicious activity observed during patrols.',
      'Missing persons or welfare concerns.',
    ],
    data_sharing_rules: [
      'Share only information necessary for the specific law enforcement purpose.',
      'Log all disclosures to Police in the audit trail.',
      'Do not provide bulk surveillance data without formal agreement.',
      'ALPR hits against stolen vehicle lists can be shared immediately — this is a public safety exception.',
    ],
  },
  bob_obligations: [
    'Bob must clearly distinguish between camping enforcement powers (limited) and Police powers (broader).',
    'When an incident exceeds camping enforcement scope, Bob must recommend involving Police.',
    'Bob must log any data shared with external agencies including Police.',
    'Bob must not provide personal information to Police beyond what is necessary for the specific incident.',
  ],
};

// ---------------------------------------------------------------------------
// NZDF (New Zealand Defence Force) considerations
// ---------------------------------------------------------------------------

const NZDF_CONSIDERATIONS = {
  full_name: 'New Zealand Defence Force considerations',
  summary: 'NZDF involvement is rare in camping enforcement but may arise in civil emergencies, border security, or when camping occurs on or near Defence land.',
  key_provisions: [
    { provision: 'Defence land is not subject to freedom camping bylaws — it is managed under Defence Act 1990.' },
    { provision: 'NZDF may assist civil authorities during emergencies (e.g., natural disasters, pandemic) — Defence Act 1990 s 9.' },
    { provision: 'Military personnel operating in civil support are subject to NZ law including Privacy Act and NZBORA.' },
    { provision: 'Security perimeters around NZDF facilities may restrict freedom camping in adjacent areas.' },
  ],
  bob_obligations: [
    'If observations or patrols are near NZDF facilities, Bob should flag restricted areas.',
    'Bob must not provide ALPR or surveillance data to NZDF without proper authorisation and Privacy Act compliance.',
    'During civil emergency operations, Bob should support information sharing as authorised by the emergency framework.',
    'Bob must respect that NZDF land is outside normal council jurisdiction.',
  ],
};

// ---------------------------------------------------------------------------
// Criminal Procedure Act 2011
// ---------------------------------------------------------------------------

const CRIMINAL_PROCEDURE_ACT_2011 = {
  full_name: 'Criminal Procedure Act 2011',
  summary: 'Governs the process for charging and prosecuting offences. Relevant to infringement notices and any escalation beyond fines.',
  key_provisions: [
    { provision: 'Infringement offences follow a specific procedure — notice, reminder, enforcement order.' },
    { provision: 'An individual can challenge an infringement notice by requesting a court hearing.' },
    { provision: 'Filing charges requires sufficient evidence and must be done within limitation periods.' },
    { provision: 'Prosecution must be fair and proportionate — over-enforcement can be challenged.' },
  ],
  bob_obligations: [
    'Infringement notices generated by Bob must include all required particulars (date, location, offence, fee, rights).',
    'Bob must track dispute deadlines and remind operators when response periods are expiring.',
    'Bob must maintain evidence integrity to support any court proceedings.',
    'Bob should flag if enforcement appears disproportionate to the offence.',
  ],
};

// ---------------------------------------------------------------------------
// Harmful Digital Communications Act 2015
// ---------------------------------------------------------------------------

const HARMFUL_DIGITAL_COMMUNICATIONS_ACT_2015 = {
  full_name: 'Harmful Digital Communications Act 2015',
  summary: 'Prohibits harmful digital communications and provides for complaints and take-down orders. Relevant to any public-facing system features.',
  key_provisions: [
    { provision: 'Digital communications must not be used to seriously emotionally distress a person.' },
    { provision: 'Publishing intimate images without consent is an offence.' },
    { provision: 'Communication principles: should not disclose sensitive personal facts, be threatening, be denigrating, or be used to harass.' },
  ],
  bob_obligations: [
    'Bob must never include personal photos, face images, or identifying details in public-facing outputs.',
    'The public dispute portal must not expose complainant details to other users.',
    'Chat responses must not be threatening, denigrating, or harassing in tone.',
    'Any face detection or recognition outputs must be restricted to authorised internal use only.',
  ],
};

// ---------------------------------------------------------------------------
// Official Information Act 1982 (OIA)
// ---------------------------------------------------------------------------

const OFFICIAL_INFORMATION_ACT_1982 = {
  full_name: 'Official Information Act 1982 (OIA)',
  summary: 'Provides the public with the right to request official information from government agencies, including local authorities.',
  key_provisions: [
    { provision: 'Any person can request official information from a local authority or government agency.' },
    { provision: 'Information must be released unless a withholding ground applies (privacy, security, commercial sensitivity).' },
    { provision: 'Agencies must respond within 20 working days.' },
    { provision: 'Enforcement data, patrol logs, and compliance statistics may be subject to OIA requests.' },
  ],
  bob_obligations: [
    'Data must be stored in a retrievable, structured format to support OIA responses.',
    'Personal information should be clearly separable from operational data for redaction purposes.',
    'Audit logs must be complete enough to demonstrate compliance if an OIA request covers system operations.',
    'Bob must not delete or modify data that may be subject to an active or anticipated OIA request.',
  ],
};

// ---------------------------------------------------------------------------
// AI-specific legal guardrails — rules Bob and Ollama must always follow
// ---------------------------------------------------------------------------

const AI_LEGAL_GUARDRAILS = {
  summary: 'Mandatory rules for Bob (inference-service) and Ollama (LLM) that apply at all times, derived from the NZ legal framework.',
  guardrails: [
    {
      id: 'G1',
      name: 'Privacy by design',
      rule: 'Minimise personal information collection and processing. Only retain data necessary for the specific operational purpose. Delete intermediary data (raw images, temporary embeddings) after processing.',
      source: 'Privacy Act 2020 IPP 1, 9, 10',
    },
    {
      id: 'G2',
      name: 'Lawful evidence only',
      rule: 'Only process evidence obtained lawfully — observed from public places, voluntarily provided, or under warrant. Flag and refuse to process evidence of uncertain provenance.',
      source: 'Search and Surveillance Act 2012, Evidence Act 2006 s 30',
    },
    {
      id: 'G3',
      name: 'Human review required',
      rule: 'All automated decisions (breach detection, enforcement recommendations, risk assessments) must have a human review step before action is taken. Bob recommends — humans decide.',
      source: 'NZBORA s 27 (natural justice), Privacy Act 2020 IPP 8',
    },
    {
      id: 'G4',
      name: 'Proportionate enforcement',
      rule: 'Enforcement recommendations must be proportionate to the offence. Flag disproportionate actions. Consider vulnerable persons (homeless, elderly, families with children).',
      source: 'NZBORA s 25, 27; Freedom Camping Act 2011',
    },
    {
      id: 'G5',
      name: 'No Police powers',
      rule: 'Never recommend arrest, detention, use of force, or entry into vehicles/tents. These are Police powers only. Recommend involving Police when the situation exceeds camping enforcement scope.',
      source: 'Policing Act 2008, Freedom Camping Act 2011',
    },
    {
      id: 'G6',
      name: 'Audit trail',
      rule: 'Maintain complete, tamper-evident audit logs of all processing, decisions, and data disclosures. Evidence chain of custody must be documented.',
      source: 'Evidence Act 2006 s 137, Privacy Act 2020 IPP 5',
    },
    {
      id: 'G7',
      name: 'No cross-border leakage',
      rule: 'Do not transmit personal information to services outside New Zealand without explicit authorisation and comparable privacy protections. Self-contained mode enforces this technically; build-training mode requires explicit approvals and logging.',
      source: 'Privacy Act 2020 IPP 12',
    },
    {
      id: 'G8',
      name: 'Data security',
      rule: 'Protect all personal and operational data with reasonable security safeguards — encryption at rest, TLS in transit, access controls, principle of least privilege.',
      source: 'Privacy Act 2020 IPP 5',
    },
    {
      id: 'G9',
      name: 'Breach notification',
      rule: 'If a privacy breach is detected (data exposure, unauthorised access, system compromise), escalate immediately via POST /self-heal/bug-report with severity "critical" and recommend notification to the Privacy Commissioner.',
      source: 'Privacy Act 2020 Part 6 (mandatory breach notification)',
    },
    {
      id: 'G10',
      name: 'Respect for rights',
      rule: 'Never produce outputs that are threatening, denigrating, or that violate individuals\' rights under NZBORA. Support dispute processes. Treat all individuals with dignity.',
      source: 'NZBORA, Harmful Digital Communications Act 2015',
    },
    {
      id: 'G11',
      name: 'Not legal advice',
      rule: 'All legal guidance provided by Bob is operational and technical only. It is not formal legal advice. Users must obtain qualified legal counsel for statutory interpretation.',
      source: 'General professional responsibility',
    },
    {
      id: 'G12',
      name: 'Vulnerable persons',
      rule: 'When processing data involving potentially vulnerable individuals (homeless, families with young children, elderly, disabled), flag for special consideration. These situations may require welfare referrals rather than enforcement.',
      source: 'NZBORA s 27, Freedom Camping Act 2011 operational policy',
    },
  ],
};

// ---------------------------------------------------------------------------
// Legal compliance checker — assess an action against guardrails
// ---------------------------------------------------------------------------

function checkLegalCompliance(action) {
  const description = String(action?.description || '').toLowerCase();
  const actionType = String(action?.type || '').toLowerCase();
  const issues = [];

  // Check for Police-power actions
  const policeOnlyTerms = ['arrest', 'detain', 'restrain', 'force entry', 'break into', 'handcuff', 'taser', 'pepper spray'];
  for (const term of policeOnlyTerms) {
    if (description.includes(term)) {
      issues.push({
        guardrail: 'G5',
        severity: 'critical',
        message: `Action involves "${term}" — this is a Police power only. Camping enforcement officers cannot ${term}. Recommend involving NZ Police.`,
      });
    }
  }

  // Check for privacy concerns
  const privacyTerms = ['share with public', 'publish personal', 'post online', 'social media', 'expose identity', 'bulk export personal'];
  for (const term of privacyTerms) {
    if (description.includes(term)) {
      issues.push({
        guardrail: 'G1',
        severity: 'high',
        message: `Action involves "${term}" — potential Privacy Act 2020 violation. Personal information must not be disclosed without authorisation.`,
      });
    }
  }

  // Check for cross-border data
  const crossBorderTerms = ['send overseas', 'cloud api', 'external ai', 'google', 'aws', 'azure', 'openai'];
  for (const term of crossBorderTerms) {
    if (description.includes(term)) {
      issues.push({
        guardrail: 'G7',
        severity: 'high',
        message: `Action involves "${term}" — potential cross-border data transfer. Requires explicit authorisation per Privacy Act 2020 IPP 12. SELF_CONTAINED_MODE enforces local processing.`,
      });
    }
  }

  // Check for disproportionate enforcement
  const disproportionateTerms = ['tow', 'seize', 'impound', 'destroy', 'confiscate'];
  for (const term of disproportionateTerms) {
    if (description.includes(term) && actionType !== 'seizure_with_warrant') {
      issues.push({
        guardrail: 'G4',
        severity: 'medium',
        message: `Action involves "${term}" — ensure this is proportionate to the offence and follows the statutory process. Consider less severe alternatives first.`,
      });
    }
  }

  // Check for missing human review
  if (actionType === 'automated' || description.includes('auto-enforce') || description.includes('automatic')) {
    issues.push({
      guardrail: 'G3',
      severity: 'medium',
      message: 'Automated enforcement action detected. All automated decisions require human review before execution per NZBORA s 27.',
    });
  }

  // Check for vulnerable persons
  const vulnerableTerms = ['homeless', 'family with children', 'elderly', 'disabled', 'mental health', 'sleeping rough'];
  for (const term of vulnerableTerms) {
    if (description.includes(term)) {
      issues.push({
        guardrail: 'G12',
        severity: 'medium',
        message: `Vulnerable person indicator: "${term}". Consider welfare referral before enforcement. Special consideration required under operational policy.`,
      });
    }
  }

  // Check for covert surveillance
  const surveillanceTerms = ['hidden camera', 'covert', 'secret recording', 'tracking device', 'intercept'];
  for (const term of surveillanceTerms) {
    if (description.includes(term)) {
      issues.push({
        guardrail: 'G2',
        severity: 'high',
        message: `Action involves "${term}" — covert surveillance requires authorisation under Search and Surveillance Act 2012. This is not within camping enforcement powers.`,
      });
    }
  }

  const compliant = issues.filter(i => i.severity === 'critical').length === 0;

  return {
    action: action?.description || 'unspecified',
    compliant,
    issues,
    guardrails_checked: AI_LEGAL_GUARDRAILS.guardrails.length,
    legal_note: 'This is operational engineering guidance, not formal legal advice. Obtain qualified legal counsel for statutory interpretation.',
  };
}

// ---------------------------------------------------------------------------
// Get full legal framework
// ---------------------------------------------------------------------------

function getLegalFramework() {
  return {
    acts: {
      privacy_act_2020: { name: PRIVACY_ACT_2020.full_name, summary: PRIVACY_ACT_2020.summary, principles_count: PRIVACY_ACT_2020.principles.length },
      nzbora_1990: { name: NZ_BILL_OF_RIGHTS_1990.full_name, summary: NZ_BILL_OF_RIGHTS_1990.summary, rights_count: NZ_BILL_OF_RIGHTS_1990.key_rights.length },
      freedom_camping_act_2011: { name: FREEDOM_CAMPING_ACT_2011.full_name, summary: FREEDOM_CAMPING_ACT_2011.summary },
      local_government_act_2002: { name: LOCAL_GOVERNMENT_ACT_2002.full_name, summary: LOCAL_GOVERNMENT_ACT_2002.summary },
      rma_1991: { name: RESOURCE_MANAGEMENT_ACT_1991.full_name, summary: RESOURCE_MANAGEMENT_ACT_1991.summary },
      search_surveillance_2012: { name: SEARCH_AND_SURVEILLANCE_ACT_2012.full_name, summary: SEARCH_AND_SURVEILLANCE_ACT_2012.summary },
      evidence_act_2006: { name: EVIDENCE_ACT_2006.full_name, summary: EVIDENCE_ACT_2006.summary },
      policing_act_2008: { name: POLICING_ACT_2008.full_name, summary: POLICING_ACT_2008.summary },
      criminal_procedure_2011: { name: CRIMINAL_PROCEDURE_ACT_2011.full_name, summary: CRIMINAL_PROCEDURE_ACT_2011.summary },
      harmful_digital_comms_2015: { name: HARMFUL_DIGITAL_COMMUNICATIONS_ACT_2015.full_name, summary: HARMFUL_DIGITAL_COMMUNICATIONS_ACT_2015.summary },
      oia_1982: { name: OFFICIAL_INFORMATION_ACT_1982.full_name, summary: OFFICIAL_INFORMATION_ACT_1982.summary },
    },
    nzdf: { name: NZDF_CONSIDERATIONS.full_name, summary: NZDF_CONSIDERATIONS.summary },
    ai_guardrails: AI_LEGAL_GUARDRAILS,
    legal_note: 'Operational engineering guidance only. Not formal legal advice.',
  };
}

function getLegalDetail(actKey) {
  const acts = {
    privacy_act_2020: PRIVACY_ACT_2020,
    nzbora_1990: NZ_BILL_OF_RIGHTS_1990,
    freedom_camping_act_2011: FREEDOM_CAMPING_ACT_2011,
    local_government_act_2002: LOCAL_GOVERNMENT_ACT_2002,
    rma_1991: RESOURCE_MANAGEMENT_ACT_1991,
    search_surveillance_2012: SEARCH_AND_SURVEILLANCE_ACT_2012,
    evidence_act_2006: EVIDENCE_ACT_2006,
    policing_act_2008: POLICING_ACT_2008,
    criminal_procedure_2011: CRIMINAL_PROCEDURE_ACT_2011,
    harmful_digital_comms_2015: HARMFUL_DIGITAL_COMMUNICATIONS_ACT_2015,
    oia_1982: OFFICIAL_INFORMATION_ACT_1982,
    nzdf: NZDF_CONSIDERATIONS,
    ai_guardrails: AI_LEGAL_GUARDRAILS,
  };

  return acts[actKey] || null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PRIVACY_ACT_2020,
  NZ_BILL_OF_RIGHTS_1990,
  FREEDOM_CAMPING_ACT_2011,
  LOCAL_GOVERNMENT_ACT_2002,
  RESOURCE_MANAGEMENT_ACT_1991,
  SEARCH_AND_SURVEILLANCE_ACT_2012,
  EVIDENCE_ACT_2006,
  POLICING_ACT_2008,
  NZDF_CONSIDERATIONS,
  CRIMINAL_PROCEDURE_ACT_2011,
  HARMFUL_DIGITAL_COMMUNICATIONS_ACT_2015,
  OFFICIAL_INFORMATION_ACT_1982,
  AI_LEGAL_GUARDRAILS,
  checkLegalCompliance,
  getLegalFramework,
  getLegalDetail,
};
