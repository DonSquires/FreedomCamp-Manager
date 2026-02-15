
// AI-Powered Credential Document Processing
// Extracts COA/Warrant details from uploaded documents using OnSpace AI

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { documentUrl, documentType, userId } = await req.json();

    if (!documentUrl || !documentType || !userId) {
      throw new Error('Missing required fields: documentUrl, documentType, userId');
    }

    if (!['coa', 'warrant'].includes(documentType)) {
      throw new Error('Invalid documentType. Must be "coa" or "warrant"');
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Processing ${documentType} document for user ${userId}`);
    console.log(`Document URL: ${documentUrl}`);

    // Step 1: Download document from storage (if PDF, convert to image)
    let imageUrl = documentUrl;
    
    // If PDF, we'll need to process it (for now, assume images or use first page)
    // In production, you might use pdf2image converter
    
    // Step 2: Call OnSpace AI with vision model to extract text
    const onspaceAIUrl = Deno.env.get('ONSPACE_AI_BASE_URL') || 'https://api.onspace.ai/v1';
    const onspaceAIKey = Deno.env.get('ONSPACE_AI_API_KEY');

    if (!onspaceAIKey) {
      throw new Error('OnSpace AI API key not configured');
    }

    // Build extraction prompt based on document type
    const extractionPrompt = documentType === 'coa' 
      ? `You are analyzing a New Zealand Certificate of Approval (COA) - Security License document.

NZ COA cards have abbreviations at the bottom showing authorized license types. Here is the OFFICIAL mapping:

**OFFICIAL NZ COA LICENSE TYPES:**
- RPA = Repossession Agent
- PI = Private Investigator
- MO = Monitoring Officer
- CC = Crowd Controller
- CDDA = Confidential Document Destruction Agent
- PRG = Property Guard
- PSG = Personal Guard (most common for security officers)
- ST = Security Technician
- SC = Security Consultant

**COA CARD FORMAT:**
- Front: Photo, "CERTIFICATE OF APPROVAL" or "TEMPORARY CERTIFICATE OF APPROVAL"
- Expiry date in DD-MM-YYYY format (e.g., 24-07-2022)
- Number next to EXPIRY (e.g., 894)
- Conditions: Yes/No
- Bottom: License type abbreviations (e.g., "PSG CC PRG SC ST RPA")
- Bottom: Badge number (e.g., 17-041302)

**COLOR CODING:**
- Blue card = Temporary COA (new/trainee guard) - limited endorsements
- Green card = Full COA (trained guard) - full endorsements

Extract the following information in JSON format:
{
  "license_number": "string (COA number next to EXPIRY, e.g., 894, 125)",
  "badge_number": "string (large number at bottom, e.g., 17-041302)",
  "expiry_date": "YYYY-MM-DD format (convert from DD-MM-YYYY)",
  "license_type": "string ('Certificate of Approval' or 'Temporary Certificate of Approval')",
  "license_holder_name": "string (full name on license)",
  "issuing_authority": "Private Security Personnel Licensing Authority",
  "authorized_activities": ["array using OFFICIAL abbreviations above, e.g., ['personal_guard', 'crowd_controller', 'property_guard']"],
  "card_color": "string ('blue' for temporary, 'green' for full)",
  "conditions": "string ('Yes' or 'No')",
  "confidence": 0.95 (your confidence in the extraction, 0-1)
}

**IMPORTANT:** 
- Convert DD-MM-YYYY dates to YYYY-MM-DD
- Map abbreviations using the OFFICIAL list above
- Extract both COA number (next to EXPIRY) and badge number (bottom)
- Identify card color (blue vs green)

If you cannot find a field, set it to null.`
      : `You are analyzing a New Zealand Freedom Camping Enforcement Warrant or Noise Control Warrant document.

**WARRANT TYPES & FORMAT:**
NZ warrants are issued by Territorial Authorities (city/district councils) and authorize enforcement officers to:
1. Issue infringement notices
2. Enter property for enforcement purposes
3. Request information from individuals

**NELSON CITY COUNCIL WARRANT FORMAT (COMMON FORMAT):**

**FRONT of Card:**
- "Warrant of Appointment" + Officer name (e.g., "Andrew Hall")
- "Nelson City Council" logo with Māori design
- "The Common Seal of the Nelson City Council was hereunto affixed in the presence of"
- Officer photo
- Signatures (CEO, NCR)
- **Issued: DD/MM/YY** (e.g., "29/08/22")
- **Expires: DD/MM/YY** (e.g., "29/08/25")

**BACK of Card:**
- "WARRANT OF APPOINTMENT" + Officer name
- "is appointed as an ENFORCEMENT/AUTHORISED OFFICER"
- "With powers and functions under"
- **Authorized Acts listed here** (e.g., "s.38 Resource Management Act 1991", "Freedom Camping Act 2011")

**CRITICAL:** The authorized acts are typically on the BACK of the card, NOT the front!

Extract the following information in JSON format:
{
  "warrant_number": "string (if visible - may be internal reference, can be null)",
  "expiry_date": "YYYY-MM-DD format (convert from DD/MM/YY - e.g., '29/08/25' becomes '2025-08-29')",
  "issue_date": "YYYY-MM-DD format (convert from DD/MM/YY - e.g., '29/08/22' becomes '2022-08-29')",
  "issuing_authority": "string (e.g., 'Nelson City Council', 'Auckland Council', 'Wellington City Council')",
  "authorized_acts": ["array of Acts on BACK of card, e.g., ['s.38 Resource Management Act 1991', 'Freedom Camping Act 2011', 'Dog Control Act 1996']"],
  "authorized_activities": ["array mapping acts to activities - use these values: 'freedom_camping', 'noise_control', 'trespass', 'bylaw_enforcement', 'resource_management'"],
  "officer_name": "string (name on warrant, e.g., 'Andrew Hall')",
  "warrant_type": "string (e.g., 'Enforcement/Authorised Officer', 'Noise Control Officer')",
  "territorial_limits": "string (geographic area, e.g., 'Nelson District', may need to infer from issuing authority)",
  "common_seal_present": "boolean (true if Nelson City Council seal visible)",
  "signature_present": "boolean (true if CEO/NCR signatures visible)",
  "confidence": 0.95 (your confidence in the extraction, 0-1)
}

**ACT-TO-ACTIVITY MAPPING (CRITICAL):**
- **"s.38 Resource Management Act 1991"** → authorized_activities: ["noise_control", "resource_management"]
- **"Freedom Camping Act 2011"** → authorized_activities: ["freedom_camping"]
- **"Trespass Act 1980"** → authorized_activities: ["trespass"]
- **"Dog Control Act 1996"** → authorized_activities: ["bylaw_enforcement"]
- **"Local Government Act 2002"** → authorized_activities: ["bylaw_enforcement"]
- **"Summary Offences Act 1981"** → authorized_activities: ["bylaw_enforcement"]

**EXAMPLE EXTRACTION:**
If back of card says "With powers and functions under s.38 Resource Management Act 1991":
- authorized_acts: ["s.38 Resource Management Act 1991"]
- authorized_activities: ["noise_control", "resource_management"]

If back says "Freedom Camping Act 2011":
- authorized_acts: ["Freedom Camping Act 2011"]
- authorized_activities: ["freedom_camping"]

**IMPORTANT:**
- **Check BOTH front and back** of warrant card (back has the authorized acts!)
- Convert **DD/MM/YY** dates to **YYYY-MM-DD** (e.g., 29/08/25 → 2025-08-29)
- Extract officer name from both front AND back (should match)
- Look for Nelson City Council seal on front
- Territorial limits usually match council name (Nelson City Council = Nelson District)

If you cannot find a field, set it to null.`
      ; // The semicolon was missing here
    const aiResponse = await fetch(`${onspaceAIUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${onspaceAIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o', // GPT-4 with vision
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: extractionPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.1, // Low temperature for factual extraction
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`OnSpace AI error: ${aiResponse.status} - ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const extractedText = aiResult.choices[0].message.content;

    console.log('AI Extraction Result:', extractedText);

    // Step 3: Parse JSON from AI response
    let extractedData;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = extractedText.match(/```json\n([\s\S]*?)\n```/) || 
                       extractedText.match(/```\n([\s\S]*?)\n```/) ||
                       [null, extractedText];
      extractedData = JSON.parse(jsonMatch[1] || extractedText);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      extractedData = { raw_text: extractedText, parse_error: parseError.message };
    }

    // Step 4: Save processing log
    const { data: logEntry, error: logError } = await supabase
      .from('credential_processing_log')
      .insert({
        user_id: userId,
        document_type: documentType,
        document_url: documentUrl,
        ai_model: 'gpt-4o',
        extracted_text: extractedText,
        extracted_data: extractedData,
        confidence_score: extractedData.confidence || null,
        license_number: extractedData.license_number || extractedData.warrant_number || null,
        expiry_date: extractedData.expiry_date || null,
        issuing_authority: extractedData.issuing_authority || null,
        authorized_activities: extractedData.authorized_activities || [],
        status: extractedData.confidence >= 0.8 ? 'success' : 'manual_review',
      })
      .select()
      .single();

    if (logError) {
      console.error('Failed to save processing log:', logError);
    }

    // Step 5: Auto-update user profile if confidence is high
    if (extractedData.confidence >= 0.8) {
      const updateData: any = {};

      if (documentType === 'coa') {
        updateData.coa_number = extractedData.license_number;
        updateData.coa_expiry_date = extractedData.expiry_date;
        updateData.coa_license_type = extractedData.license_type;
        updateData.authorized_activities = extractedData.authorized_activities || [];
      } else {
        updateData.has_warrant = true;
        updateData.warrant_number = extractedData.warrant_number;
        updateData.warrant_expiry_date = extractedData.expiry_date;
        updateData.issuing_authority = extractedData.issuing_authority;
        updateData.warrant_acts = extractedData.authorized_acts || [];
        updateData.authorized_activities = extractedData.authorized_activities || [];
      }

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('id', userId);

      if (updateError) {
        console.error('Failed to update user profile:', updateError);
        throw updateError;
      }

      console.log(`✅ Auto-updated user profile with ${documentType} data`);
    } else {
      console.log(`⚠️ Low confidence (${extractedData.confidence}) - manual review required`);
    }

    // Step 6: Return result
    return new Response(
      JSON.stringify({
        success: true,
        extracted_data: extractedData,
        confidence: extractedData.confidence || 0,
        auto_filled: extractedData.confidence >= 0.8,
        manual_review_required: extractedData.confidence < 0.8,
        log_id: logEntry?.id,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('Error processing credential document:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
