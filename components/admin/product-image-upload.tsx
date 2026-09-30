"use client";

import { useEffect, useRef, useState } from "react";
import { CldUploadWidget } from "next-cloudinary";
import { Button } from "@/components/ui/Button";
import { cloudinaryImageUrl } from "@/lib/product-upload";

interface Props {
  onUpload: (url: string) => void;
  disabled?: boolean;
  label?: string;
}

export function ProductImageUpload({ onUpload, disabled, label = "Upload" }: Props) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  // The provider retains its initial callback when creating its widget.
  const onUploadRef = useRef(onUpload);
  onUploadRef.current = onUpload;
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim();

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, []);

  if (!cloudName || !uploadPreset) return (
    <p role="status" className="text-sm text-amber-700">
      Upload is not configured. Set NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME and
      NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET to an image-only unsigned preset, then restart/redeploy.
      You can still paste an image URL.
    </p>
  );

  return (
    <div>
      <CldUploadWidget
        config={{ cloud: { cloudName } }}
        uploadPreset={uploadPreset}
        options={{ multiple: false, maxFiles: 1, resourceType: "image", clientAllowedFormats: ["png", "jpg", "jpeg", "webp", "gif", "avif"], sources: ["local", "url"] }}
        onQueuesStart={() => { setError(""); setStatus("Uploading image..."); }}
        onClose={() => setStatus(previous => previous === "Uploading image..." ? "Upload closed. Retry if no image was added." : previous)}
        onError={() => { setStatus(""); setError("Upload failed. Check your connection and Cloudinary cloud name / unsigned image preset, then retry."); }}
        onSuccess={(result) => {
          const url = cloudinaryImageUrl(result);
          if (!url) {
            setStatus("");
            setError("Upload returned no valid image URL. Please upload an image again.");
            return;
          }
          onUploadRef.current(url);
          setError("");
          setStatus("Image added to the form. Save the product to keep it.");
        }}
      >
        {({ open, isLoading }) => (
          <div>
            <Button type="button" variant="outline" disabled={disabled || isLoading} onClick={() => {
              setError("");
              try { open(); } catch { setError("Could not open the upload widget. Reload the page and try again."); }
            }}>{isLoading ? "Loading uploader..." : label}</Button>
            {isLoading && timedOut && <p role="alert" className="text-sm text-red-600">Uploader did not load. Check network/content blockers or paste an image URL.</p>}
          </div>
        )}
      </CldUploadWidget>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {status && <p role="status" className="text-sm">{status}</p>}
    </div>
  );
}
