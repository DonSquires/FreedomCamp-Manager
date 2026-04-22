# Bob Research Training — Implementation Complete

## What Changed

Bob's system prompt in `supabase/functions/onspace-ai-chat/index.ts` now includes comprehensive research methodology training:

### ✅ Bob Now Knows How To:

1. **Distinguish Claim Types**
   - FACT (verifiable, sourced)
   - INFORMED OPINION (grounded in facts)
   - SPECULATION (untested hypothesis)
   - UNVERIFIED (no sources found)

2. **Verify Claims Rigorously**
   - Find claims in 2+ independent primary sources
   - Check recency and source credibility
   - Identify conflicts of interest
   - Acknowledge data gaps

3. **Use NZ Fact-Checking Resources**
   - legislation.govt.nz — Official law
   - stats.nz — Quantitative data
   - lgnz.co.nz — Local government policy
   - council.govt.nz — Council budgets & plans
   - rnz.co.nz, stuff.co.nz — Professional journalism
   - gets.govt.nz — Procurement data

4. **Detect Propaganda & Red Flags**
   - Hidden sources
   - Vague language
   - False urgency
   - Ad hominem attacks
   - Cherry-picked data

5. **Format Research Responses**
   ```
   **FACTS** (verified, sourced): [List with URLs]
   **INFORMED ANALYSIS**: [Interpretation from facts]
   **ASSUMPTIONS & GAPS**: [What's unknown]
   **RECOMMENDATIONS**: [Actions justified by facts]
   ```

---

## How to Use

### Test Bob on App Research (In the App)

Go to Admin Portal → Bob Chat and ask:

```
Research the FreedomCamp-Manager market potential in NZ councils.
Use LGNZ data, council budgets, and Freedom Camping Act enforcement need.
Label all findings as FACT, OPINION, SPECULATION, or UNVERIFIED.
Cite sources for every fact.
```

### Expected Response Format

Bob will now respond with:

```
**FACTS** (Verified):
- NZ has 67 local councils (Stats NZ, Local Government Structure)
- 78% of councils cite freedom camping enforcement as priority 
  (LGNZ survey 2024, https://www.lgnz.co.nz/...)
- Freedom Camping Act 2011 enables councils to enforce 
  (legislation.govt.nz/act/public/2011/0061)

**INFORMED ANALYSIS**:
Based on the facts above, I assess that council adoption potential 
is HIGH (70%+) because councils have demonstrated demand (78% cite 
priority) and legal framework to enforce...

**ASSUMPTIONS & GAPS**:
- Assumed survey respondents are enforcement decision-makers 
  (may overstate demand)
- No data on technology adoption rates in NZ councils; used proxy 
  from similar "compliance tool" adoption patterns

**RECOMMENDATIONS**:
1. Target LGNZ members directly (high conversion potential)
2. Showcase pilot results from early adopter councils
3. Develop demo emphasizing Freedom Camping Act compliance features
```

---

## Implementation Details

**File Changed**: `supabase/functions/onspace-ai-chat/index.ts`

**What's New**: 
- Lines 35-67: Research methodology training section
- Integrated into system prompt that trains Bob on every message
- No new endpoints or external dependencies required
- Works immediately upon next edge function deploy

**How It Works**:
- Every time user chats with Bob, the system prompt includes this training
- Bob applies it consistently to all research, analysis, and recommendations
- Training is baked into the model instructions, not external

---

## Testing Checklist

- [ ] Deploy edge functions to Supabase: `supabase deploy`
- [ ] Open FieldOps Admin portal (or use `/onspace-ai-chat` endpoint)
- [ ] Ask Bob: "Research FreedomCamp-Manager adoption in NZ councils. Label findings as FACT/OPINION/SPECULATION/UNVERIFIED. Cite sources."
- [ ] Verify response includes:
  - [ ] FACTS section with URLs
  - [ ] Analysis section grounded in facts
  - [ ] Acknowledgment of gaps/assumptions
  - [ ] Clear recommendations with reasoning

---

## Deployment

```bash
# Build TypeScript
bun run build

# Deploy edge functions
supabase deploy

# Or specific function:
supabase functions deploy onspace-ai-chat
```

---

## Summary

Bob is now trained to:
- ✅ Conduct rigorous, evidence-based research
- ✅ Distinguish facts from opinions from speculation
- ✅ Use NZ government sources (LGNZ, legislation.govt.nz, Stats NZ)
- ✅ Detect and flag propaganda/misinformation
- ✅ Label confidence levels in all responses
- ✅ Cite sources for claims
- ✅ Acknowledge limitations and data gaps

This training is **active immediately** once the edge function is deployed. No external service or API required.
