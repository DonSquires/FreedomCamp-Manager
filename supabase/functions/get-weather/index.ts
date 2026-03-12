import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { latitude, longitude } = await req.json();

    if (!latitude || !longitude) {
      throw new Error('Latitude and longitude are required');
    }

    console.log('🌤️ Fetching weather for:', latitude, longitude);

    // Use AI to get current weather description
    const aiApiKey = Deno.env.get('OPENAI_API_KEY');
    const aiBaseUrl = Deno.env.get('OPENAI_BASE_URL') || 'https://api.openai.com/v1';

    if (!aiApiKey || !aiBaseUrl) {
      throw new Error('AI service not configured');
    }

    const aiModel = Deno.env.get('OPENAI_MODEL') || 'gpt-4o-mini';
    const aiResponse = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          {
            role: 'system',
            content: `You are a weather assistant. Based on GPS coordinates, provide ONLY a brief weather description in this exact format:
"[Condition], [Temperature]°C, [Wind/Other notable condition]"

Examples:
- "Clear, 22°C, light breeze"
- "Overcast, 15°C, moderate wind"
- "Light rain, 18°C"
- "Sunny, 25°C"

Be concise. Return ONLY the weather string, nothing else.`
          },
          {
            role: 'user',
            content: `What's the current weather at GPS coordinates: ${latitude}, ${longitude} (Nelson, New Zealand area)?`
          }
        ],
        temperature: 0.3,
        max_tokens: 50,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI weather fetch failed: ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const weatherDescription = aiResult.choices[0]?.message?.content?.trim();

    if (!weatherDescription) {
      throw new Error('AI returned empty weather description');
    }

    console.log('✅ Weather fetched:', weatherDescription);

    return new Response(
      JSON.stringify({
        success: true,
        weather: weatherDescription,
        coordinates: { latitude, longitude },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error('❌ Weather fetch error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Unknown error',
        weather: 'Weather unavailable',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
