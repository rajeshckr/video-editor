const path = require('path');
require('dotenv').config();

const ROOT = path.resolve(__dirname, '..');

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  toolsPath: process.env.TOOLS_PATH || path.resolve(ROOT, 'Tools'),
  tmpPath:   process.env.TMP_PATH   || path.resolve(ROOT, 'TMP'),
  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB || '2048', 10),
  cleanupRetentionHours: parseInt(process.env.CLEANUP_RETENTION_HOURS || '48', 10),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowedExtensions: ['mp4','mov','mkv','webm','mp3','wav','aac','jpg','jpeg','png','webp'],
  allowedMimeTypes: [
    'video/mp4','video/quicktime','video/x-matroska','video/webm',
    'audio/mpeg','audio/wav','audio/aac','audio/x-aac',
    'image/jpeg','image/png','image/webp'
  ],
  get ffmpegPath()  { return path.join(this.toolsPath, process.platform === 'win32' ? 'ffmpeg.exe'  : 'ffmpeg');  },
  get ffprobePath() { return path.join(this.toolsPath, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'); },
  get uploadsPath()      { return path.join(this.tmpPath, 'uploads');      },
  get thumbnailsPath()   { return path.join(this.tmpPath, 'thumbnails');   },
  get intermediatePath() { return path.join(this.tmpPath, 'intermediate'); },
  get rendersPath()      { return path.join(this.tmpPath, 'renders');      },
  get audioPath()        { return path.join(this.tmpPath, 'audio');        },
  get cachePath()        { return path.join(this.tmpPath, 'cache');        },
};

module.exports = config;
