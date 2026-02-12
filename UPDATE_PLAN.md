# Plate Recognition System Rebuild - Update Plan

## ✅ Completed
1. Created new `recognize-plate` Edge Function using Plate Recognizer API
2. Updated CORS headers to include `x-client-timezone`

## 🔄 Next Steps

### Frontend Updates
Need to update `src/components/features/PlateCapture.tsx`:

**Replace the `processImageUnified` function (lines 847-1000+)** with:

```typescript
  // 🔄 UNIFIED PROCESSING FUNCTION - Single Plate Recognizer API call
  const processImageUnified = async (
    imageDataUrl: string, 
    queueId: string,
    sourceType: 'camera' | 'file_upload' = 'camera'
  ) => {
    console.log(`📸 [${sourceType.toUpperCase()}] Starting unified plate recognition...`);

    try {
      // STEP 1: Upload photo IMMEDIATELY (before any processing)
      console.log('📤 Step 1: Uploading photo to storage...');
      const fullImageUrl = await uploadToStorage(imageDataUrl);
      console.log('✅ Photo uploaded:', fullImageUrl);

      // STEP 2: Call Plate Recognizer API (single unified call)
      console.log('🔍 Step 2: Calling Plate Recognizer API...');
      const { data: recognitionData, error: recognitionError } = await supabase.functions.invoke('recognize-plate', {
        body: { 
          image: imageDataUrl,
          regions: ['nz'], // New Zealand plates
          enableMMC: true, // Enable Make/Model/Color detection
        },
      });

      if (recognitionError) {
        console.error('❌ Plate Recognizer API error:', recognitionError);
        throw recognitionError;
      }

      // Check if recognition was successful
      if (!recognitionData?.success) {
        console.error('❌ Plate recognition failed:', recognitionData?.error || 'Unknown error');
        playSounds.error();
        
        setFeedbackType('error');
        setFeedbackMessage(`No Plate Read${sourceType === 'file_upload' ? ' from File' : ''}`);
        setShowFeedbackBubble(true);
        setTimeout(() => setShowFeedbackBubble(false), 3000);
        
        setFailedDetectionData({
          image: imageDataUrl,
          photoUrl: fullImageUrl,
          gpsLocation,
        });
        setShowManualEntryModal(true);
        
        setLastErrorMessage('Detection failed - manual entry required');
        setButtonFeedback('error');
        
        setProcessingQueue(prev => 
          prev.map(item => 
            item.id === queueId 
              ? { ...item, status: 'error' as const } 
              : item
          )
        );
        
        toast.info('Automatic detection failed - please enter details manually');
        return;
      }

      // SUCCESS PATH
      console.log('✅ PLATE RECOGNIZED:', recognitionData.plate_number, `(${Math.round(recognitionData.confidence * 100)}%)`);
      console.log('📊 Vehicle details:', {
        make: recognitionData.vehicle_make,
        model: recognitionData.vehicle_model,
        color: recognitionData.vehicle_color,
        year: recognitionData.vehicle_year,
        type: recognitionData.vehicle_type,
      });
      
      setProcessingQueue(prev => 
        prev.map(item => 
          item.id === queueId 
            ? { ...item, plateNumber: recognitionData.plate_number, status: 'complete' as const } 
            : item
        )
      );
      
      setFeedbackType('success');
      setFeedbackMessage('Plate Read');
      setShowFeedbackBubble(true);
      setTimeout(() => setShowFeedbackBubble(false), 2000);
      
      setButtonFeedback('success');
      setTimeout(() => setButtonFeedback('idle'), 3000);
      
      // Add source metadata to notes
      const sourceNote = sourceType === 'file_upload' 
        ? '📁 PHOTO UPLOADED FROM FILE • Processed with Plate Recognizer API'
        : undefined;
      
      // Process field scan with all extracted data
      await processFieldScan({
        plateNumber: recognitionData.plate_number,
        confidence: recognitionData.confidence,
        vehicleMake: recognitionData.vehicle_make,
        vehicleModel: recognitionData.vehicle_model,
        vehicleColor: recognitionData.vehicle_color,
        vehicleYear: recognitionData.vehicle_year?.toString(),
        croppedImageUrl: null,
        fullImageUrl,
        gpsLocation,
        detectionMethod: 'alpr',
        isSelfContained: recognitionData.has_green_sticker || recognitionData.has_blue_sticker,
        hasGreenSticker: recognitionData.has_green_sticker,
        hasBlueSticker: recognitionData.has_blue_sticker,
        officerNotes: sourceNote,
      });
      
    } catch (error: any) {
      console.error('❌ Image processing failed:', error);
      playSounds.error();
      
      setFeedbackType('error');
      setFeedbackMessage('Scan Failed');
      setShowFeedbackBubble(true);
      setTimeout(() => setShowFeedbackBubble(false), 3000);
      
      setLastErrorMessage('Processing error');
      setButtonFeedback('error');
      
      setProcessingQueue(prev => 
        prev.map(item => 
          item.id === queueId 
            ? { ...item, status: 'error' as const } 
            : item
        )
      );
      
      toast.error('Failed to process image: ' + error.message);
    } finally {
      setProcessingQueue(prev => {
        const allComplete = prev.every(item => item.status !== 'processing');
        if (allComplete) {
          setIsBackgroundProcessing(false);
        }
        return prev;
      });
    }
  };
```

### Version Update
Update `src/constants/version.ts`:

```typescript
export const APP_VERSION = '2.3.0009';

// Add to VERSION_HISTORY at the top:
  {
    version: '2.3.0009',
    date: '2025-02-12',
    changes: [
      '🔄 Complete rebuild using Plate Recognizer API exclusively',
      '✅ Single unified Edge Function for all plate recognition',
      '📸 Direct integration with Plate Recognizer Cloud API',
      '🚗 Automatic Make/Model/Color detection enabled by default',
      '🇳🇿 Optimized for New Zealand license plates',
      '⚡ Faster processing with single API call (no fallback chain)',
    ],
  },
```

## Summary
- **Before**: Complex 3-step process (ALPR → OCR fallback → Manual entry)
- **After**: Single Plate Recognizer API call with automatic Make/Model/Color
- **Benefits**: Faster, simpler, more reliable, includes vehicle details automatically
