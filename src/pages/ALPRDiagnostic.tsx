
/**
 * ALPR Diagnostic Tool - DEPRECATED
 * ⚠️ ALPR has been removed from the system
 * This page is kept for historical reference only
 * TODO: Remove this entire file after ORC/AI system is deployed
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, XCircle, AlertTriangle, Camera } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

export default function ALPRDiagnostic() {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testingImage, setTestingImage] = useState(false);
  const [imageTestResult, setImageTestResult] = useState<any>(null);

  // Test 1: Check if API key is configured and valid
  const testCredentials = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('test-alpr-credentials');

      if (error) {
        throw new Error(`Function call failed: ${error.message}`);
      }

      setTestResult(data);
      
      if (data.success) {
        toast.success('✅ API key is valid!');
      } else {
        toast.error('❌ API key test failed');
      }
    } catch (error: any) {
      console.error('Test failed:', error);
      setTestResult({
        success: false,
        error: 'Test failed',
        message: error.message,
      });
      toast.error('Test failed');
    } finally {
      setTesting(false);
    }
  };

  // Test 2: Test with sample plate image
  const testWithSampleImage = async () => {
    setTestingImage(true);
    setImageTestResult(null);

    try {
      // Use a known good test image (NZ plate)
      const testImageBase64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCABAAGQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWFlhZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlbaWmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1NXW19jZ2uLi5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxAPwD9/KKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//Z'; // Truncated - in real use would be full base64

      // REMOVED: ALPR function call - system no longer uses plate recognition
      // TODO: Replace with ORC/AI vehicle fingerprinting test
      const data = null;
      const error = new Error('ALPR removed - ORC/AI system under development');
      
      /*const { data, error } = await supabase.functions.invoke('plate-scanner-photo-first', {
        body: {
          image: testImageBase64,
          gpsLatitude: -41.2865,
          gpsLongitude: 174.7762,
          recordedAt: new Date().toISOString(),
          officerId: 'diagnostic-test',
          organizationId: 'diagnostic-test',
          idempotencyKey: `diagnostic:${Date.now()}`,
        },
      });*/

      if (error) {
        let errorMessage = error.message;
        if (error.name === 'FunctionsHttpError' && error.context) {
          try {
            const statusCode = error.context?.status ?? 500;
            const textContent = await error.context?.text();
            errorMessage = `[Code: ${statusCode}] ${textContent || error.message || 'Unknown error'}`;
          } catch {
            errorMessage = `${error.message || 'Failed to read response'}`;
          }
        }
        throw new Error(errorMessage);
      }

      setImageTestResult(data);
      
      if (data.success && data.plate_number && data.plate_number !== 'PENDING_ALPR') {
        toast.success(`✅ Plate detected: ${data.plate_number}`);
      } else {
        toast.error('❌ No plate detected');
      }
    } catch (error: any) {
      console.error('Image test failed:', error);
      setImageTestResult({
        success: false,
        error: error.message,
      });
      toast.error('Image test failed');
    } finally {
      setTestingImage(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">ALPR Diagnostic Tool</h1>
          <p className="text-muted-foreground">
            Test your Plate Recognizer API configuration and troubleshoot ALPR issues
          </p>
        </div>

        {/* Test 1: Credentials Check */}
        <Card>
          <CardHeader>
            <CardTitle>Test 1: API Key Configuration</CardTitle>
            <CardDescription>
              Verify that PLATE_RECOGNIZER_API_KEY is configured in Supabase Secrets and is valid
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={testCredentials} disabled={testing}>
              {testing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Testing...
                </>
              ) : (
                'Test API Key'
              )}
            </Button>

            {testResult && (
              <Alert variant={testResult.success ? 'default' : 'destructive'}>
                <div className="flex items-start gap-3">
                  {testResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 space-y-2">
                    <AlertDescription>
                      <strong>{testResult.message || testResult.error}</strong>
                    </AlertDescription>
                    
                    {testResult.success && testResult.apiStats && (
                      <div className="mt-3 space-y-2 text-sm">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <span className="text-muted-foreground">Plan:</span>
                            <Badge variant="outline" className="ml-2">{testResult.apiStats.plan || 'Unknown'}</Badge>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Total Calls:</span>
                            <Badge variant="outline" className="ml-2">{testResult.apiStats.totalCalls || 0}</Badge>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Monthly Usage:</span>
                            <Badge variant="outline" className="ml-2">{testResult.apiStats.usage?.calls || 0}</Badge>
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          Key Preview: <code className="bg-muted px-1 rounded">{testResult.keyPreview}</code>
                        </p>
                      </div>
                    )}

                    {testResult.fix && (
                      <Alert variant="default" className="mt-3">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          <strong>Fix:</strong> {testResult.fix}
                        </AlertDescription>
                      </Alert>
                    )}

                    {testResult.response && (
                      <details className="mt-3">
                        <summary className="text-sm text-muted-foreground cursor-pointer">
                          Show raw response
                        </summary>
                        <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-40">
                          {JSON.stringify(testResult, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Test 2: Image Recognition */}
        <Card>
          <CardHeader>
            <CardTitle>Test 2: Plate Recognition</CardTitle>
            <CardDescription>
              Test the unified ALPR system (plate-scanner-photo-first) with a sample image
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button onClick={testWithSampleImage} disabled={testingImage}>
                {testingImage ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    Test with Sample Image
                  </>
                )}
              </Button>
            </div>

            {imageTestResult && (
              <Alert variant={imageTestResult.success ? 'default' : 'destructive'}>
                <div className="flex items-start gap-3">
                  {imageTestResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 space-y-2">
                    {imageTestResult.success ? (
                      <>
                        <AlertDescription>
                          <strong>✅ Plate Detected Successfully!</strong>
                        </AlertDescription>
                        <div className="space-y-2 text-sm mt-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <span className="text-muted-foreground">Plate Number:</span>
                              <Badge className="ml-2">{imageTestResult.plate_number}</Badge>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Confidence:</span>
                              <Badge variant="outline" className="ml-2">
                                {imageTestResult.confidence ? `${Math.round(imageTestResult.confidence * 100)}%` : 'N/A'}
                              </Badge>
                            </div>
                          </div>
                          {(imageTestResult.vehicle_make || imageTestResult.vehicle_model) && (
                            <div>
                              <span className="text-muted-foreground">Vehicle:</span>
                              <Badge variant="outline" className="ml-2">
                                {imageTestResult.vehicle_color} {imageTestResult.vehicle_make} {imageTestResult.vehicle_model}
                              </Badge>
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">
                            Processing Time: {imageTestResult.processing_time}ms
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <AlertDescription>
                          <strong>❌ {imageTestResult.error}</strong>
                        </AlertDescription>
                        <p className="text-sm text-muted-foreground mt-2">
                          This could indicate an issue with the API key, API endpoint, or image processing.
                        </p>
                      </>
                    )}

                    <details className="mt-3">
                      <summary className="text-sm text-muted-foreground cursor-pointer">
                        Show raw response
                      </summary>
                      <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-40">
                        {JSON.stringify(imageTestResult, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Common Issues & Fixes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <strong>❌ "API key is NOT configured"</strong>
              <p className="text-muted-foreground mt-1">
                Go to Supabase Dashboard → Project Settings → Edge Functions → Secrets → Add PLATE_RECOGNIZER_API_KEY
              </p>
            </div>
            
            <div>
              <strong>❌ "API key is INVALID" (401 error)</strong>
              <p className="text-muted-foreground mt-1">
                Your Plate Recognizer API key has expired or is incorrect. Get a new key from{' '}
                <a href="https://app.platerecognizer.com/accounts/plan/" target="_blank" className="text-blue-500 underline">
                  platerecognizer.com
                </a>
              </p>
            </div>
            
            <div>
              <strong>❌ "Does not have access" (403 error)</strong>
              <p className="text-muted-foreground mt-1">
                Make sure you are using a <strong>ParkPow Token</strong>, not a Snapshot Cloud API Token.
                You can find your ParkPow token in your Plate Recognizer account under "API Token for Apps".
              </p>
            </div>
            
            <div>
              <strong>❌ "No license plates detected"</strong>
              <p className="text-muted-foreground mt-1">
                This could be due to poor image quality, angle, lighting, or the plate being obscured.
                Try adjusting the zoom level, ensuring good lighting, and capturing the plate straight-on.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
