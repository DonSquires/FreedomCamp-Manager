/**
 * Test ALPR Credentials - Diagnostic Tool
 * Tests if PLATE_RECOGNIZER_API_KEY is working
 */

import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Check if API key is configured
    const apiKey = Deno.env.get('PLATE_RECOGNIZER_API_KEY');
    
    if (!apiKey || apiKey.trim() === '') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'PLATE_RECOGNIZER_API_KEY is NOT configured in Supabase Secrets',
          fix: 'Go to Supabase Dashboard → Project Settings → Edge Functions → Secrets and add PLATE_RECOGNIZER_API_KEY',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Test the API key by calling the API info endpoint
    const testUrl = 'https://api.platerecognizer.com/v1/statistics/';
    
    console.log('🔍 Testing ALPR API key...');
    console.log('API URL:', testUrl);
    console.log('API Key (first 10 chars):', apiKey.substring(0, 10) + '...');

    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${apiKey}`,
      },
    });

    const responseText = await response.text();
    
    if (!response.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `API key test failed with status ${response.status}`,
          statusCode: response.status,
          statusText: response.statusText,
          response: responseText,
          fix: response.status === 401 
            ? 'API key is INVALID. Get a new key from platerecognizer.com and update Supabase Secrets'
            : response.status === 403
            ? 'API key does not have access. Make sure you are using a ParkPow token, not Snapshot Cloud API token'
            : 'Check Plate Recognizer API status at status.platerecognizer.com',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let apiStats: any;
    try {
      apiStats = JSON.parse(responseText);
    } catch {
      apiStats = { raw: responseText };
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: '✅ API key is VALID and working!',
        keyPreview: apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 4),
        apiStats: {
          totalCalls: apiStats.total_calls,
          usage: apiStats.usage,
          plan: apiStats.plan,
        },
        fullResponse: apiStats,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Test failed:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Test failed with exception',
        message: error.message,
        stack: error.stack,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
