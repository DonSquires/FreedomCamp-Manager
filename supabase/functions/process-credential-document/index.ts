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

Extract the following information in JSON format:
{
  "license_number": "string (COA number/license ID)",
  "expiry_date": "YYYY-MM-DD format",
  "license_type": "string (e.g., 'Certificate of Approval - Security Guard')",
  "license_holder_name": "string (full name on license)",
  "issuing_authority": "string (who issued it, e.g., 'Private Security Personnel Licensing Authority')",
  "authorized_activities": ["array of activities this COA authorizes, e.g., 'security_guard', 'crowd_controller', 'private_investigator'"],
  "restrictions": "string (any restrictions or conditions)",
  "confidence": 0.95 (your confidence in the extraction, 0-1)
}

If you cannot find a field, set it to null. Be precise with dates (DD/MM/YYYY or MM/DD/YYYY format → convert to YYYY-MM-DD).`
      : `You are analyzing a New Zealand Freedom Camping Enforcement Warrant or Noise Control Warrant document.

Extract the following information in JSON format:
{
  "warrant_number": "string (warrant ID/reference number)",
  "expiry_date": "YYYY-MM-DD format",
  "issuing_authority": "string (e.g., 'Nelson City Council', 'Auckland Council')",
  "authorized_acts": ["array of Acts officer is authorized under, e.g., 'Freedom Camping Act 2011', 'Resource Management Act 1991', 'Noise Control Act'"],
  "authorized_activities": ["array of what they can enforce, e.g., 'freedom_camping', 'noise_control', 'trespass', 'bylaw_enforcement'"],
  "officer_name": "string (name of authorized officer)",
  "restrictions": "string (any territorial or time restrictions)",
  "confidence": 0.95 (your confidence in the extraction, 0-1)
}

Common NZ warrant types:
- Freedom Camping Act 2011 → authorized_activities: ["freedom_camping"]
- Resource Management (Noise Control) → authorized_activities: ["noise_control"]
- Trespass Act 1980 → authorized_activities: ["trespass"]
- Local Government Act (Bylaw Enforcement) → authorized_activities: ["bylaw_enforcement"]

If you cannot find a field, set it to null.`;

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
