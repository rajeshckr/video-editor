export async function extractLocalMetadata(file: File): Promise<{
  duration: number;
  width: number;
  height: number;
  fps: number;
  type: 'video' | 'audio' | 'image';
  thumbnailUrl?: string;
}> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const type = 
      ['mp4', 'mov', 'mkv', 'webm'].includes(ext || '') ? 'video' :
      ['mp3', 'wav', 'aac'].includes(ext || '') ? 'audio' :
      ['jpg', 'jpeg', 'png', 'webp'].includes(ext || '') ? 'image' : null;

    if (!type) {
      return reject(new Error('Unsupported file type'));
    }

    const localUrl = URL.createObjectURL(file);

    if (type === 'video') {
      const video = document.createElement('video');
      video.playsInline = true;
      video.muted = true;
      
      const onSeeked = () => {
        let thumbnailUrl;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 90; // Approx 16:9
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
          }
        } catch (e) {
          console.warn('Failed to generate video thumbnail LOCALLY', e);
        }

        const width = video.videoWidth || 1920;
        const height = video.videoHeight || 1080;
        const duration = video.duration || 0;
        cleanup();
        resolve({ duration, width, height, fps: 30, type, thumbnailUrl });
      };

      const onMetadataLoaded = () => {
        video.currentTime = Math.min(1, video.duration / 2); // Seek to 1s or midway
      };

      const onError = () => {
        cleanup();
        reject(new Error('Failed to load video metadata'));
      };

      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onMetadataLoaded);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
        URL.revokeObjectURL(localUrl);
        video.src = '';
      };

      video.addEventListener('loadedmetadata', onMetadataLoaded);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      video.src = localUrl;
    } else if (type === 'audio') {
      const audio = document.createElement('audio');
      
      const onMetadataLoaded = () => {
        const duration = audio.duration || 0;
        cleanup();
        resolve({ duration, width: 0, height: 0, fps: 0, type });
      };

      const onError = () => {
        cleanup();
        reject(new Error('Failed to load audio metadata'));
      };

      const cleanup = () => {
        audio.removeEventListener('loadedmetadata', onMetadataLoaded);
        audio.removeEventListener('error', onError);
        URL.revokeObjectURL(localUrl);
        audio.src = '';
      };

      audio.addEventListener('loadedmetadata', onMetadataLoaded);
      audio.addEventListener('error', onError);
      audio.src = localUrl;
    } else if (type === 'image') {
      const img = new Image();
      
      const onLoad = () => {
        const width = img.naturalWidth || 0;
        const height = img.naturalHeight || 0;

        let thumbnailUrl;
        try {
          const canvas = document.createElement('canvas');
          const aspect = width / height || 1;
          canvas.width = 160;
          canvas.height = 160 / aspect;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            thumbnailUrl = canvas.toDataURL('image/jpeg', 0.7);
          }
        } catch (e) {
           console.warn('Failed to generate image thumbnail LOCALLY', e);
        }

        cleanup();
        resolve({ duration: 5, width, height, fps: 0, type, thumbnailUrl }); // Default 5s duration for images
      };

      const onError = () => {
        cleanup();
        reject(new Error('Failed to load image metadata'));
      };

      const cleanup = () => {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onError);
        URL.revokeObjectURL(localUrl);
        img.src = '';
      };

      img.addEventListener('load', onLoad);
      img.addEventListener('error', onError);
      img.src = localUrl;
    }
  });
}
