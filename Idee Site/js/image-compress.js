/* Shrinks a photo in the browser before upload, so visitors do not download
   multi-megabyte camera files. The original is kept whenever shrinking is not
   possible or would not make the file smaller. GIFs are never changed
   (they may be animated). Server-side type and size checks stay unchanged. */
(() => {
    'use strict';
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };

    function blobFrom(canvas, type, quality) {
        return new Promise(resolve => {
            try { canvas.toBlob(blob => resolve(blob || null), type, quality); } catch { resolve(null); }
        });
    }

    async function decode(file) {
        if (typeof createImageBitmap === 'function') {
            try { return await createImageBitmap(file); } catch { /* fall back to <img> below */ }
        }
        const url = URL.createObjectURL(file);
        try {
            const image = new Image();
            image.src = url;
            await image.decode();
            return image;
        } finally { URL.revokeObjectURL(url); }
    }

    window.spotivityShrinkImage = async function(file, { maxSide = 1920, quality = 0.85, keepBelow = 400 * 1024 } = {}) {
        try {
            if (!(file instanceof Blob) || !extensions[file.type] || file.type === 'image/gif') return file;
            const image = await decode(file);
            const width = image.width || image.naturalWidth, height = image.height || image.naturalHeight;
            if (!width || !height) return file;
            const scale = Math.min(1, maxSide / Math.max(width, height));
            // Small files that are already within the size limit stay exactly as chosen.
            if (scale === 1 && file.size <= keepBelow) return file;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext('2d');
            if (!context) return file;
            context.imageSmoothingQuality = 'high';
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            image.close?.();
            // WebP keeps transparency (PNG logos) and is much lighter. Browsers that
            // cannot encode WebP return PNG instead; JPEG photos may stay JPEG then.
            let blob = await blobFrom(canvas, 'image/webp', quality);
            if (!blob || blob.type !== 'image/webp') {
                blob = file.type === 'image/jpeg' ? await blobFrom(canvas, 'image/jpeg', quality) : null;
            }
            if (!blob || !extensions[blob.type] || blob.size >= file.size) return file;
            const name = `${String(file.name || 'fotografie').replace(/\.[^.]*$/, '') || 'fotografie'}.${extensions[blob.type]}`;
            return new File([blob], name, { type: blob.type, lastModified: Date.now() });
        } catch {
            return file;
        }
    };
})();
