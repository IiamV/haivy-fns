import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Image processing settings
const IMAGE_CONFIG = {
  maxWidth: 512,             // Maximum width in pixels
  maxHeight: 512,            // Maximum height in pixels
  quality: 80,               // Compression quality (1-100)
  cropMode: 'at_max',        // ImageKit crop mode: 'at_max', 'at_max_enlarge', 'at_least', 'force', 'maintain_ratio'
  format: 'auto',            // Output format: 'auto', 'jpg', 'png', 'webp'
  optimizationSizeLimit: 1048576, // Size limit in bytes (1MB) - files above this will be optimized, set to null to disable
  allowedTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  allowedExtensions: ['jpg', 'jpeg', 'png', 'webp']
}

// Storage settings
const STORAGE_CONFIG = {
  bucketName: 'profile-images',
  filePrefix: 'profile_',    // Prefix for auto-generated filenames
  folderPath: '',            // Folder path in bucket (e.g., 'avatars/', 'users/profiles/')
  deleteOldImage: true,      // Whether to delete old profile image when uploading new one
  cleanupTempFiles: true     // Whether to delete temp files from ImageKit
}

// Database settings
const DATABASE_CONFIG = {
  tableName: 'user_details',
  profileImageColumn: 'profile_image_url'
}

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Standardized error response
function createErrorResponse(message: string, status: number = 500) {
  return new Response(
    JSON.stringify({ error: message }),
    { 
      status, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  )
}

// Standardized success response
function createSuccessResponse(data: any) {
  return new Response(
    JSON.stringify(data),
    { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    }
  )
}

// Validates if the uploaded file type is allowed
function validateFileType(file: File): boolean {
  return IMAGE_CONFIG.allowedTypes.includes(file.type)
}

// Generates a unique filename for the profile image
function generateFileName(userId: string, originalName: string): string {
  const extension = originalName.split('.').pop()?.toLowerCase() || 'jpg'

  return `${STORAGE_CONFIG.filePrefix}${userId}.${extension}`
}

// Fetches user details from database for getting current profile image
async function fetchUserDetails(supabaseClient: any, userId: string): Promise<any> {
  const { data, error } = await supabaseClient
    .from(DATABASE_CONFIG.tableName)
    .select(DATABASE_CONFIG.profileImageColumn)
    .eq('user_id', userId)
    .single()

  if (error) {
    console.error('Error fetching user details:', error)
  }
  
  return data || {}
}

// Gets ImageKit configuration
function getImageKitConfig() {
  const privateKey = Deno.env.get('IMAGEKIT_PRIVATE_KEY')
  const publicKey = Deno.env.get('IMAGEKIT_PUBLIC_KEY')
  const urlEndpoint = Deno.env.get('IMAGEKIT_URL_ENDPOINT')

  if (!privateKey || !publicKey || !urlEndpoint) {
    return null
  }
  
  return { privateKey, publicKey, urlEndpoint }
}

// Creates ImageKit transformation URL for resizing
function createResizeTransformationUrl(originalUrl: string, urlEndpoint: string): string {
  const transformations = [
    `w-${IMAGE_CONFIG.maxWidth}`,
    `h-${IMAGE_CONFIG.maxHeight}`,
    `c-${IMAGE_CONFIG.cropMode}`
  ]
  
  const transformation = `tr:${transformations.join(',')}`
  return originalUrl.replace(
    `${urlEndpoint}/`,
    `${urlEndpoint}/${transformation}/`
  )
}

// Creates ImageKit transformation URL
function createOptimizedTransformationUrl(originalUrl: string, urlEndpoint: string): string {
  const transformations = [
    `w-${IMAGE_CONFIG.maxWidth}`,
    `h-${IMAGE_CONFIG.maxHeight}`,
    `c-${IMAGE_CONFIG.cropMode}`,
    `q-${IMAGE_CONFIG.quality}`
  ]
  
  // Add format if not auto
  if (IMAGE_CONFIG.format !== 'auto') {
    transformations.push(`f-${IMAGE_CONFIG.format}`)
  }
  
  const transformation = `tr:${transformations.join(',')}`
  return originalUrl.replace(
    `${urlEndpoint}/`,
    `${urlEndpoint}/${transformation}/`
  )
}

// Uploads image to ImageKit temporarily for processing
async function uploadToImageKit(fileBuffer: ArrayBuffer, fileName: string, imageKitConfig: any) {
  const auth = btoa(`${imageKitConfig.privateKey}:`)
  
  const formData = new FormData()
  // Create blob from ArrayBuffer
  const blob = new Blob([fileBuffer])
  formData.append('file', blob, fileName)
  formData.append('fileName', `temp_${fileName}`)
  formData.append('useUniqueFileName', 'true')

  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}` },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('ImageKit upload error:', errorText)
    throw new Error('ImageKit upload failed')
  }

  return await response.json()
}

// Fetches processed image from ImageKit
async function fetchProcessedImage(transformedUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(transformedUrl)
  
  if (!response.ok) {
    throw new Error('Failed to fetch processed image from ImageKit')
  }
  
  return await response.arrayBuffer()
}

// Extracts filename from Supabase Storage URL
function extractFilenameFromUrl(url: string): string | null {
  try {
    const urlParts = url.split('/')
    return urlParts[urlParts.length - 1] || null
  } catch {
    return null
  }
}

// Deletes old profile image from Supabase Storage with better error handling
async function deleteOldProfileImage(supabaseClient: any, oldImageUrl: string | null, newFileName: string) {
  if (!STORAGE_CONFIG.deleteOldImage || !oldImageUrl) return
  
  try {
    const oldFilename = extractFilenameFromUrl(oldImageUrl)
    if (!oldFilename || oldFilename === newFileName) {
      console.log('Skipping deletion: same filename or invalid old filename')
      return
    }
    
    const { data: existingFile, error: listError } = await supabaseClient.storage
      .from(STORAGE_CONFIG.bucketName)
      .list('', { search: oldFilename })
    
    if (listError) {
      console.log('Note: Could not check if old file exists:', listError)
      return
    }
    
    const fileExists = existingFile && existingFile.some((file: any) => file.name === oldFilename)
    
    if (!fileExists) {
      console.log('Old profile image does not exist, skipping deletion')
      return
    }
    
    const { error } = await supabaseClient.storage
      .from(STORAGE_CONFIG.bucketName)
      .remove([oldFilename])
    
    if (error) {
      console.log('Note: Could not delete old profile image:', error)
    } else {
      console.log('Successfully deleted old profile image:', oldFilename)
    }
  } catch (error) {
    console.log('Note: Error while deleting old profile image:', error)
  }
}

// Cleans up temporary file from ImageKit
async function cleanupImageKitFile(fileId: string, imageKitConfig: any) {
  if (!STORAGE_CONFIG.cleanupTempFiles) return
  
  try {
    const auth = btoa(`${imageKitConfig.privateKey}:`)
    await fetch(`https://api.imagekit.io/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${auth}` },
    })
  } catch (error) {
    console.log('Note: Could not clean up temporary ImageKit file:', error)
  }
}

// Background processing function
async function processImageInBackground(
  supabaseClient: any,
  user: any,
  userDetails: any,
  imageFile: File,
  fullName: string,
  birthDate: string,
  fileName: string
) {
  try {
    console.log(`[Background] Starting image processing for user ${user.id}`)
    
    const currentImageUrl = userDetails[DATABASE_CONFIG.profileImageColumn] || null
    
    // Get ImageKit configuration
    const imageKitConfig = getImageKitConfig()
    if (!imageKitConfig) {
      console.error('[Background] ImageKit configuration missing')
      return
    }

    // Process image through ImageKit
    const fileBuffer = await imageFile.arrayBuffer()
    const originalFileSize = fileBuffer.byteLength
    
    // Upload to ImageKit temporarily
    const imageKitResult = await uploadToImageKit(fileBuffer, fileName, imageKitConfig)
    console.log(`[Background] Image uploaded to ImageKit: ${imageKitResult.fileId}`)
    
    // Determine if optimization should be applied
    const shouldOptimize = IMAGE_CONFIG.optimizationSizeLimit && originalFileSize > IMAGE_CONFIG.optimizationSizeLimit
    
    let finalImageBuffer: ArrayBuffer
    let wasOptimized = false
    
    if (shouldOptimize) {
      // Try optimized version first
      const optimizedUrl = createOptimizedTransformationUrl(imageKitResult.url, imageKitConfig.urlEndpoint)
      const optimizedBuffer = await fetchProcessedImage(optimizedUrl)
      
      // Only use optimized version if it's smaller than original
      if (optimizedBuffer.byteLength < originalFileSize) {
        finalImageBuffer = optimizedBuffer
        wasOptimized = true
        console.log(`[Background] Image optimized: ${originalFileSize} -> ${optimizedBuffer.byteLength} bytes`)
      } else {
        // Fall back to resize-only version
        const resizedUrl = createResizeTransformationUrl(imageKitResult.url, imageKitConfig.urlEndpoint)
        finalImageBuffer = await fetchProcessedImage(resizedUrl)
        console.log(`[Background] Optimization skipped: would increase size. Using resize-only version.`)
      }
    } else {
      // Just resize without optimization
      const resizedUrl = createResizeTransformationUrl(imageKitResult.url, imageKitConfig.urlEndpoint)
      finalImageBuffer = await fetchProcessedImage(resizedUrl)
      console.log(`[Background] Image resized without optimization`)
    }
    
    // Delete old profile image before uploading new one (with improved logic)
    await deleteOldProfileImage(supabaseClient, currentImageUrl, fileName)
    
    // Upload processed image to Supabase Storage
    const { error: uploadError } = await supabaseClient.storage
      .from(STORAGE_CONFIG.bucketName)
      .upload(fileName, finalImageBuffer, {
        contentType: imageFile.type,
        upsert: true
      })

    if (uploadError) {
      console.error('[Background] Supabase storage error:', uploadError)
      return
    }
    
    console.log(`[Background] Image uploaded to Supabase Storage: ${fileName}`)

    // Clean up temporary file from ImageKit
    await cleanupImageKitFile(imageKitResult.fileId, imageKitConfig)

    // Get public URL from Supabase Storage
    const { data: urlData } = supabaseClient.storage
      .from(STORAGE_CONFIG.bucketName)
      .getPublicUrl(fileName)
    
    const processedImageUrl = urlData.publicUrl

    // Prepare database update
    const updateData: any = { [DATABASE_CONFIG.profileImageColumn]: processedImageUrl }
    
    if (fullName !== null && fullName !== undefined && fullName.trim() !== '') {
      updateData.full_name = fullName.trim()
    }
    
    if (birthDate !== null && birthDate !== undefined && birthDate.trim() !== '') {
      updateData.birth_date = birthDate.trim()
    }

    // Update user details in database
    const { error: updateError } = await supabaseClient
      .from(DATABASE_CONFIG.tableName)
      .upsert({
        user_id: user.id,
        ...updateData
      })

    if (updateError) {
      console.error('[Background] Database update error:', updateError)
      return
    }

    console.log(`[Background] Profile updated successfully for user ${user.id}`)
    console.log(`[Background] Final stats - Original: ${originalFileSize}b, Final: ${finalImageBuffer.byteLength}b, Optimized: ${wasOptimized}`)

  } catch (error) {
    console.error('[Background] Image processing error:', error)
  }
}

// MAIN HANDLER
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    )

    // Authenticate user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    
    if (userError || !user) {
      return createErrorResponse('Unauthorized', 401)
    }

    // Parse form data
    const formData = await req.formData()
    const fullName = formData.get('full_name') as string
    const birthDate = formData.get('birth_date') as string
    const imageFile = formData.get('image_file') as File

    // Validate image file exists
    if (!imageFile || imageFile.size === 0) {
      return createErrorResponse('Image file is required', 400)
    }

    // Validate file type
    if (!validateFileType(imageFile)) {
      return createErrorResponse(`Invalid file type. Only ${IMAGE_CONFIG.allowedTypes.join(', ')} are allowed.`, 400)
    }

    // Get ImageKit configuration early to validate it
    const imageKitConfig = getImageKitConfig()
    if (!imageKitConfig) {
      return createErrorResponse('ImageKit configuration missing', 500)
    }

    // Fetch existing user details for processing
    const userDetails = await fetchUserDetails(supabaseClient, user.id)

    // Generate filename
    const fileName = generateFileName(user.id, imageFile.name)

    // Return success response immediately - processing will continue in background
    const response = createSuccessResponse({
      message: 'Image received and processing started',
      filename: fileName,
      processing: true,
      user_id: user.id
    })

    // Start background processing (don't await)
    processImageInBackground(
      supabaseClient,
      user,
      userDetails,
      imageFile,
      fullName,
      birthDate,
      fileName
    ).catch(error => {
      console.error('[Background] Unhandled error in background processing:', error)
    })

    return response

  } catch (error) {
    console.error('Function error:', error)
    return createErrorResponse('Internal server error', 500)
  }
})