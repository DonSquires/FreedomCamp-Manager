import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface DocumentProcessRequest {
  fileUrl: string;
  fileName: string;
  fileType: string;
}

interface ExtractedJobData {
  reference_number: string | null;
  job_type: string;
  location_address: string | null;
  property_details: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  briefing_notes: string | null;
  instructions: string | null;
  client_name: string | null;
  client_reference: string | null;
  priority: string;
  due_date: string | null;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Verify user
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { fileUrl, fileName, fileType }: DocumentProcessRequest = await req.json();

    console.log('Processing document:', fileName, 'Type:', fileType);

    // Prepare content for AI processing based on file type
    let aiMessageContent: any;

    if (fileType.startsWith('image/')) {
      // For images, download and convert to base64
      const imageResponse = await fetch(fileUrl);
      if (!imageResponse.ok) {
        throw new Error('Failed to download image file');
      }
      
      const arrayBuffer = await imageResponse.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      aiMessageContent = [
        {
          type: 'text',
          text: `Extract job information from this document image (${fileName}). Return ONLY valid JSON with the specified fields.`,
        },
        {
          type: 'image_url',
          image_url: { url: `data:${fileType};base64,${base64}` },
        },
      ];
    } else if (fileType === 'text/plain') {
      // For text files, fetch content
      const textResponse = await fetch(fileUrl);
      if (!textResponse.ok) {
        throw new Error('Failed to download text file');
      }
      
      const textContent = await textResponse.text();
      aiMessageContent = `Extract job information from this text document (${fileName}):\n\n${textContent.substring(0, 15000)}`;
    } else if (fileType === 'application/pdf' || 
               fileType === 'application/msword' || 
               fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // For PDF and Word documents: inform AI we have a document URL
      // Note: Gemini API doesn't support direct PDF/Word URL processing in chat mode
      // We'll provide the URL and let AI know the filename/type
      aiMessageContent = `I have a ${fileType === 'application/pdf' ? 'PDF' : 'Word'} document named "${fileName}" related to investigation jobs. Based on the filename and typical investigation job documents, please extract likely job information and return JSON. If the filename contains reference numbers (like MSD numbers, CL numbers, or similar), include those. For location, look for place names in the filename. Return your best inference as JSON with the specified fields, using null for uncertain values.`;
    } else {
      throw new Error(`Unsupported file type: ${fileType}. Please upload PDF, Word (.doc/.docx), images (.jpg/.png), or text files.`);
    }

    // Call AI to extract job information
    const aiApiKey = Deno.env.get('OPENAI_API_KEY');
    const aiBaseUrl = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';

    if (!aiApiKey || !aiBaseUrl) {
      throw new Error('AI credentials not configured');
    }

    console.log('Calling AI for document extraction...');

    const systemPrompt = `You are a document processing assistant that extracts job information from investigation briefing documents, work orders, and emails.

Extract the following information if present in the document:
- **reference_number**: Look for job numbers starting with "MSD" or other reference numbers (e.g., "MSD00029173", "fA807848", "CL-xxxxx"). This is often in email subjects or document headers.
- **job_type**: Determine if it's "homeless_occupation", "abandoned_vehicle", "unauthorized_structure", or "other" based on the document content
- **location_address**: Full address or location description (e.g., "Second Street, Kumara", "Part bed of Waipara River (near SH1)")
- **property_details**: Property/asset/section details (e.g., "Section 566 Town of Kumara SO 88979")
- **gps_latitude** and **gps_longitude**: Extract GPS coordinates if mentioned in format like "-42.123456, 171.123456" or from map coordinates
- **briefing_notes**: Background information, context about the site, why the job was created
- **instructions**: Specific instructions for the field officer (what to do, what to collect, safety notes)
- **client_name**: Who requested the job (e.g., "LINZ", "MSD", "Downer", council names)
- **client_reference**: Client's internal reference number if different from main reference
- **priority**: Assess urgency from document tone/content - "low", "medium", "high", or "urgent"
- **due_date**: Extract any due dates or deadlines mentioned (format: YYYY-MM-DD)

Return ONLY a valid JSON object with these exact field names. Use null for missing values. Do not include any explanation text.`;

    const aiMessages = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: aiMessageContent,
      },
    ];

    const aiResponse = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: aiMessages,
        temperature: 0.1, // Low temperature for consistent extraction
        max_tokens: 2000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      throw new Error(`AI processing failed: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    console.log('AI response:', JSON.stringify(aiResult));

    const extractedText = aiResult.choices[0]?.message?.content || '';
    console.log('Extracted text:', extractedText);

    // Parse the JSON response from AI
    let extractedData: ExtractedJobData;
    try {
      // Clean up the response - remove markdown code blocks if present
      const jsonText = extractedText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      extractedData = JSON.parse(jsonText);
      console.log('Parsed extracted data:', extractedData);
    } catch (parseError) {
      console.error('Failed to parse AI response:', extractedText);
      console.error('Parse error:', parseError);
      
      // Return minimal data if parsing fails
      extractedData = {
        reference_number: null,
        job_type: 'other',
        location_address: null,
        property_details: null,
        gps_latitude: null,
        gps_longitude: null,
        briefing_notes: `Original document: ${fileName}\n\nFailed to fully parse document. Please review manually.`,
        instructions: null,
        client_name: null,
        client_reference: null,
        priority: 'medium',
        due_date: null,
      };
    }

    // Validate and clean up the extracted data
    const cleanedData: ExtractedJobData = {
      reference_number: extractedData.reference_number || `DOC-${Date.now()}`,
      job_type: ['homeless_occupation', 'abandoned_vehicle', 'unauthorized_structure', 'other'].includes(
        extractedData.job_type
      )
        ? extractedData.job_type
        : 'other',
      location_address: extractedData.location_address || null,
      property_details: extractedData.property_details || null,
      gps_latitude:
        typeof extractedData.gps_latitude === 'number' ? extractedData.gps_latitude : null,
      gps_longitude:
        typeof extractedData.gps_longitude === 'number' ? extractedData.gps_longitude : null,
      briefing_notes: extractedData.briefing_notes || null,
      instructions: extractedData.instructions || null,
      client_name: extractedData.client_name || null,
      client_reference: extractedData.client_reference || null,
      priority: ['low', 'medium', 'high', 'urgent'].includes(extractedData.priority)
        ? extractedData.priority
        : 'medium',
      due_date: extractedData.due_date || null,
    };

    console.log('Cleaned extracted data:', cleanedData);

    return new Response(
      JSON.stringify({
        success: true,
        data: cleanedData,
        originalFileName: fileName,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error processing document:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to process document',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
