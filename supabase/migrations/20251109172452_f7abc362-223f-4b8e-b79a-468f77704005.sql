-- Add new images column as JSONB array
ALTER TABLE tasks ADD COLUMN images JSONB DEFAULT '[]'::jsonb;

-- Migrate existing image_url data to images array
UPDATE tasks 
SET images = CASE 
  WHEN image_url IS NOT NULL AND image_url != '' THEN jsonb_build_array(image_url)
  ELSE '[]'::jsonb
END;

-- Drop old image_url column
ALTER TABLE tasks DROP COLUMN image_url;